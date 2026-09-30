"""使用 Real-ESRGAN AI 模型放大圖片。

用法：
    uv run upscale.py                           # 不帶引數：啟動網頁版 (http://127.0.0.1:5050)
    uv run upscale.py photo.jpg --scale 2       # 命令行：放大 2 倍
    uv run upscale.py a.png b.jpg -s 3.5        # 可一次處理多個檔案，倍數可為小數
    uv run upscale.py photo.jpg -s 4 --cpu      # 強制使用 CPU

輸出一律存成 PNG（無損格式），放在 upscale/ 資料夾，檔名為「原檔名_x倍數.png」
（同名檔已存在時自動加上 _1、_2… 不覆蓋）。

放大流程：
- 倍數 <= 2 用 RealESRGAN_x2plus，2 < 倍數 <= 4 用 RealESRGAN_x4plus，
  模型輸出後再以 Lanczos 縮到精確的目標尺寸（縮小不會損失品質）。
- 倍數 > 4 時先以 x4 模型放大，剩下的倍數（最多 2 倍）以 Lanczos 補足。
- 透明圖片的 alpha 通道以 Lanczos 另外放大。
- 大圖切成小塊（含重疊邊）逐塊推論，避免記憶體不足。
- 模型權重第一次使用時自動下載到 models/ 並驗證 SHA-256。
"""

import argparse
import hashlib
import sys
import threading
import urllib.request
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageOps
from spandrel import ImageModelDescriptor, ModelLoader

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "upscale"
MODELS_DIR = BASE_DIR / "models"

MIN_SCALE = 1.0
MAX_SCALE = 8.0
MAX_OUTPUT_PIXELS = 200_000_000  # 約 14000 x 14000，避免記憶體爆掉（也套用在模型的中間輸出）

TILE = 256  # 每塊輸入邊長（像素）；16 GB Mac 上 384 以上反而因記憶體壓力變慢很多
TILE_PAD = 48  # 每塊四周多取的重疊像素，避免拼接處出現接縫（實測 16 會有可見接縫）

# 模型原生倍數 -> (檔名, 下載網址, SHA-256)
MODELS = {
    2: (
        "RealESRGAN_x2plus.pth",
        "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth",
        "49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb",
    ),
    4: (
        "RealESRGAN_x4plus.pth",
        "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
        "4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1",
    ),
}

# 同一個模型不可同時被多個執行緒推論（網頁版為多執行緒）
_infer_lock = threading.Lock()
# 挑選不重複檔名到存檔完成之間不可被其他執行緒插隊
_save_lock = threading.Lock()


class UpscaleError(ValueError):
    """使用者輸入造成的錯誤（倍數不合法、圖片過大等）。"""


def format_scale(scale: float) -> str:
    """2.0 -> "2"，2.50 -> "2.5"。"""
    return f"{scale:g}"


def output_name(src_name: str, scale: float) -> str:
    return f"{Path(src_name).stem}_x{format_scale(scale)}.png"


def unique_path(path: Path) -> Path:
    """檔名已存在時加上 _1、_2…，避免覆蓋先前的輸出。"""
    candidate, n = path, 1
    while candidate.exists():
        candidate = path.with_stem(f"{path.stem}_{n}")
        n += 1
    return candidate


def check_scale(scale: float) -> None:
    if not (MIN_SCALE < scale <= MAX_SCALE):
        raise UpscaleError(f"放大倍數需大於 {format_scale(MIN_SCALE)} 且不超過 {format_scale(MAX_SCALE)}")


def model_scale_for(scale: float) -> int:
    return 2 if scale <= 2 else 4


# ---------- 模型下載與載入 ----------

def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_model_file(native_scale: int) -> Path:
    """確認權重檔存在且雜湊正確，沒有就下載。"""
    name, url, sha = MODELS[native_scale]
    path = MODELS_DIR / name
    if path.exists():
        return path
    MODELS_DIR.mkdir(exist_ok=True)
    tmp = path.with_suffix(".part")
    print(f"下載模型 {name} …", file=sys.stderr, flush=True)
    urllib.request.urlretrieve(url, tmp)
    if sha256_of(tmp) != sha:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"模型 {name} 的 SHA-256 不符，已刪除下載檔")
    tmp.rename(path)
    return path


def ensure_models() -> None:
    for native_scale in MODELS:
        ensure_model_file(native_scale)


def pick_device(force_cpu: bool = False) -> torch.device:
    if not force_cpu:
        if torch.cuda.is_available():
            return torch.device("cuda")
        if torch.backends.mps.is_available():
            return torch.device("mps")
    return torch.device("cpu")


@lru_cache(maxsize=None)
def load_model(native_scale: int, device_type: str) -> ImageModelDescriptor:
    model = ModelLoader().load_from_file(ensure_model_file(native_scale))
    if not isinstance(model, ImageModelDescriptor):
        raise RuntimeError("權重檔不是圖片模型")
    model.to(torch.device(device_type)).eval()
    if device_type == "cuda" and model.supports_half:
        model.half()
    return model


# ---------- 推論 ----------

def run_model(model: ImageModelDescriptor, rgb: np.ndarray) -> np.ndarray:
    """把 HxWx3 uint8 影像逐塊送進模型，回傳放大後的 uint8 影像。"""
    s = model.scale
    req = model.size_requirements
    device = model.device
    dtype = model.dtype
    h, w = rgb.shape[:2]
    src = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0)  # 1x3xHxW uint8（留在 CPU）
    out = np.empty((h * s, w * s, 3), dtype=np.uint8)

    for y0 in range(0, h, TILE):
        for x0 in range(0, w, TILE):
            y1, x1 = min(y0 + TILE, h), min(x0 + TILE, w)
            py0, px0 = max(y0 - TILE_PAD, 0), max(x0 - TILE_PAD, 0)
            py1, px1 = min(y1 + TILE_PAD, h), min(x1 + TILE_PAD, w)

            tile = src[:, :, py0:py1, px0:px1].to(device=device, dtype=dtype) / 255
            th, tw = tile.shape[2:]
            # 補到模型要求的最小尺寸與倍數
            need_h = max(th, req.minimum)
            need_w = max(tw, req.minimum)
            need_h += (-need_h) % req.multiple_of
            need_w += (-need_w) % req.multiple_of
            if (need_h, need_w) != (th, tw):
                tile = F.pad(tile, (0, need_w - tw, 0, need_h - th), mode="replicate")

            with torch.inference_mode():
                result = model(tile)
                # 去掉重疊邊與補的像素，只留 [y0:y1, x0:x1] 對應的區塊
                oy, ox = (y0 - py0) * s, (x0 - px0) * s
                result = result[0, :, oy:oy + (y1 - y0) * s, ox:ox + (x1 - x0) * s]
                out[y0 * s:y1 * s, x0 * s:x1 * s] = (
                    result.float().clamp(0, 1).mul(255).round().byte().permute(1, 2, 0).cpu().numpy()
                )
    return out


def upscale_image(img: Image.Image, scale: float, force_cpu: bool = False) -> Image.Image:
    check_scale(scale)
    img = ImageOps.exif_transpose(img)

    width = max(1, round(img.width * scale))
    height = max(1, round(img.height * scale))
    native = model_scale_for(scale)
    mid_pixels = img.width * native * img.height * native
    if max(width * height, mid_pixels) > MAX_OUTPUT_PIXELS:
        raise UpscaleError(
            f"放大後尺寸 {width}x{height} 過大，請降低倍數或使用較小的圖"
            f"（上限約 {MAX_OUTPUT_PIXELS // 1_000_000} 百萬像素）"
        )

    has_alpha = img.mode in ("RGBA", "LA", "PA", "RGBa", "La") or "transparency" in img.info
    gray = img.mode in ("L", "LA", "1", "I", "I;16", "I;16B", "I;16L", "F")
    if gray and img.mode not in ("L", "LA"):
        img = img.convert("L")
    rgba = img.convert("RGBA") if has_alpha else None
    rgb = (rgba or img).convert("RGB")

    model = load_model(native, pick_device(force_cpu).type)
    with _infer_lock:
        big = Image.fromarray(run_model(model, np.array(rgb)))
    if big.size != (width, height):
        big = big.resize((width, height), Image.Resampling.LANCZOS)

    if gray:
        big = big.convert("L")
    if rgba is not None:
        alpha = rgba.getchannel("A").resize((width, height), Image.Resampling.LANCZOS)
        big.putalpha(alpha)
    return big


def upscale_file(src: Path | str, scale: float, out_dir: Path = OUTPUT_DIR,
                 name: str | None = None, force_cpu: bool = False) -> Path:
    """放大 src 並存成 PNG，回傳輸出路徑。name 為用來產生輸出檔名的原始檔名。"""
    with Image.open(src) as img:
        img.load()
        # CMYK 等模式轉成 RGB 後，原本的 ICC 色彩描述檔已不適用
        icc = img.info.get("icc_profile") if img.mode not in ("CMYK", "YCbCr", "LAB") else None
        result = upscale_image(img, scale, force_cpu=force_cpu)

    out_dir.mkdir(parents=True, exist_ok=True)
    save_kwargs = {"compress_level": 6}
    if icc:
        save_kwargs["icc_profile"] = icc
    with _save_lock:
        out_path = unique_path(out_dir / output_name(name or Path(src).name, scale))
        result.save(out_path, "PNG", **save_kwargs)
    return out_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Real-ESRGAN AI 圖片放大（輸出 PNG 至 upscale/ 資料夾）")
    parser.add_argument("images", nargs="+", type=Path, help="要放大的圖片檔")
    parser.add_argument("-s", "--scale", type=float, required=True,
                        help=f"放大倍數（>{format_scale(MIN_SCALE)} 且 <= {format_scale(MAX_SCALE)}，可為小數）")
    parser.add_argument("-o", "--out-dir", type=Path, default=OUTPUT_DIR, help="輸出資料夾（預設 upscale/）")
    parser.add_argument("--cpu", action="store_true", help="強制使用 CPU（預設自動使用 CUDA / Apple MPS）")
    args = parser.parse_args(argv)

    print(f"使用裝置：{pick_device(args.cpu).type}", file=sys.stderr)
    failed = 0
    for src in args.images:
        try:
            out = upscale_file(src, args.scale, args.out_dir, force_cpu=args.cpu)
            print(f"{src} -> {out}")
        except (OSError, UpscaleError) as e:
            failed += 1
            print(f"{src}: 失敗 - {e}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    if len(sys.argv) == 1:
        from web_app import run

        run()
    else:
        sys.exit(main())
