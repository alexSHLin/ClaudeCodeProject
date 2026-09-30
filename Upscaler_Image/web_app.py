"""upscale.py 的網頁版：不帶引數執行 `uv run upscale.py` 時啟動。

上傳的圖片先暫存於 cache/，放大結果存在 upscale/ 資料夾。
"""

import re
import tempfile
from pathlib import Path
from urllib.parse import quote

from flask import Flask, jsonify, request, send_from_directory
from PIL import Image, ImageOps, UnidentifiedImageError

from upscale import OUTPUT_DIR, UpscaleError, ensure_models, pick_device, upscale_file

BASE_DIR = Path(__file__).resolve().parent
FRONT_END_DIR = BASE_DIR / "front_end"
CACHE_DIR = BASE_DIR / "cache"
PORT = 5050

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB


def safe_name(name: str) -> str:
    """去除路徑與不合法字元，保留原本檔名（含中文）。"""
    name = Path(name.replace("\\", "/")).name
    name = re.sub(r'[\x00-\x1f<>:"/\\|?*]', "_", name).strip(" .")
    return name or "image"


@app.get("/")
def index():
    return send_from_directory(FRONT_END_DIR, "index.html")


@app.get("/<path:filename>")
def front_end(filename):
    return send_from_directory(FRONT_END_DIR, filename)


@app.get("/upscale/<path:filename>")
def output(filename):
    return send_from_directory(OUTPUT_DIR, filename, as_attachment=request.args.get("download") == "1")


@app.post("/api/upscale")
def api_upscale():
    file = request.files.get("image")
    if not file or not file.filename:
        return jsonify(error="請選擇圖片檔"), 400
    try:
        scale = float(request.form.get("scale", ""))
    except ValueError:
        return jsonify(error="放大倍數必須是數字"), 400

    CACHE_DIR.mkdir(exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=CACHE_DIR, delete=False) as tmp:
        file.save(tmp)
        tmp_path = Path(tmp.name)
    try:
        with Image.open(tmp_path) as img:
            src_size = ImageOps.exif_transpose(img).size  # 與輸出方向一致
        out_path = upscale_file(tmp_path, scale, name=safe_name(file.filename))
    except (UnidentifiedImageError, Image.DecompressionBombError):
        return jsonify(error="無法辨識的圖片格式或圖片過大"), 400
    except UpscaleError as e:
        return jsonify(error=str(e)), 400
    finally:
        tmp_path.unlink(missing_ok=True)

    with Image.open(out_path) as out:
        out_size = out.size
    return jsonify(
        name=out_path.name,
        url=f"/upscale/{quote(out_path.name)}",
        saved_to=str(out_path),
        src_size=src_size,
        out_size=out_size,
    )


@app.errorhandler(413)
def too_large(_):
    return jsonify(error="檔案過大（上限 50 MB）"), 413


def run() -> None:
    ensure_models()  # 第一次執行時先下載權重，避免第一個請求等很久
    print(f"Real-ESRGAN 使用裝置：{pick_device().type}")
    print(f"圖片放大網頁版已啟動： http://127.0.0.1:{PORT}")
    app.run(host="127.0.0.1", port=PORT, debug=False)
