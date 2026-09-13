"""幫 PDF 檔加上浮水印。

用法：
    uv run watermark.py input.pdf [more.pdf ...] [--text Confidential] [--opacity 0.15]

輸出檔名為原檔名加上 "_wm"，例如 report.pdf -> report_wm.pdf（與原檔同資料夾）。
每一頁會依其實際尺寸產生對應的浮水印，因此同一份 PDF 內混合不同尺寸、
橫直向或旋轉的頁面都能正確置中並沿對角線排列。

uv run watermark.py report.pdf                              # 浮水印為 Confidential
uv run watermark.py report.pdf --text "Internal Use Only"   # 自訂文字
uv run watermark.py report.pdf -t "Draft"                   # 簡寫
uv run watermark.py report.pdf --pages 1,3,5-7              # 只加在指定頁（頁碼從 1 起，"5-" 表示第 5 頁到最後）

"""

import argparse
import io
import math
import sys
from functools import lru_cache
from pathlib import Path

from pypdf import PdfReader, PdfWriter, Transformation
from reportlab.lib.colors import Color
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.pdfmetrics import registerFont, stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

DEFAULT_TEXT = "Confidential"
LATIN_FONT = "Helvetica-Bold"
CJK_FONT = "WatermarkCJK"

# 可嵌入的中文 TrueType 字型（reportlab 不支援 PostScript/CFF 外框，如 PingFang、Noto Sans CJK）
CJK_FONT_CANDIDATES = [
    "/System/Library/Fonts/STHeiti Medium.ttc",  # macOS 黑體
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",  # macOS
    "/Library/Fonts/Arial Unicode.ttf",
    "C:/Windows/Fonts/msjhbd.ttc",  # Windows 微軟正黑體 粗體
    "C:/Windows/Fonts/msjh.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",  # Linux 文泉驛正黑
    "/usr/share/fonts/wenquanyi/wqy-zenhei/wqy-zenhei.ttc",
]


@lru_cache(maxsize=None)
def cjk_font() -> str:
    """註冊並回傳中文字型名稱：優先嵌入系統 TrueType 字型，找不到時改用 reportlab 內建 CID 字型。"""
    for path in CJK_FONT_CANDIDATES:
        if Path(path).is_file():
            try:
                registerFont(TTFont(CJK_FONT, path, subfontIndex=0))
                return CJK_FONT
            except Exception:
                continue
    # 內建繁中明體：不嵌入字型，由 PDF 閱讀器提供
    registerFont(UnicodeCIDFont("MSung-Light"))
    return "MSung-Light"


def font_for(text: str) -> str:
    """Helvetica 只支援 Latin-1 字元，其餘（如中文）改用中文字型。"""
    try:
        text.encode("latin-1")
        return LATIN_FONT
    except UnicodeEncodeError:
        return cjk_font()


@lru_cache(maxsize=None)
def make_watermark_page(width: float, height: float, text: str, opacity: float):
    """產生一張與指定尺寸相同、只含浮水印的 PDF 頁面（相同尺寸會重複使用）。"""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))

    # 文字沿頁面對角線，長度約為對角線的 70%
    font = font_for(text)
    diagonal = math.hypot(width, height)
    angle = math.degrees(math.atan2(height, width))
    font_size = diagonal * 0.7 / stringWidth(text, font, 1)

    c.setFillColor(Color(0.5, 0.5, 0.5, alpha=opacity))
    c.setFont(font, font_size)
    c.translate(width / 2, height / 2)
    c.rotate(angle)
    # 垂直方向以字高約 0.35 倍下移，讓文字視覺上置中
    c.drawCentredString(0, -font_size * 0.35, text)
    c.save()

    buf.seek(0)
    return PdfReader(buf).pages[0]


def output_path_for(src: Path) -> Path:
    return src.with_name(f"{src.stem}_wm{src.suffix}")


def parse_pages(spec: str) -> list[tuple[int, int | None]]:
    """解析頁碼字串，如 "1,3,5-7,10-"；回傳 (起, 迄) 範圍清單，迄為 None 表示到最後一頁。"""
    ranges = []
    for part in spec.replace(" ", "").split(","):
        if not part:
            continue
        start, sep, end = part.partition("-")
        try:
            first = int(start)
            last = None if sep and not end else int(end or start)
        except ValueError:
            raise argparse.ArgumentTypeError(f"頁碼格式錯誤：{part}（例：1,3,5-7 或 5-）")
        if first < 1 or (last is not None and last < first):
            raise argparse.ArgumentTypeError(f"頁碼範圍錯誤：{part}")
        ranges.append((first, last))
    if not ranges:
        raise argparse.ArgumentTypeError("請至少指定一個頁碼")
    return ranges


def select_pages(ranges: list[tuple[int, int | None]], total: int) -> set[int]:
    """把頁碼範圍轉成 0 起算的頁面索引；超出總頁數時拋出 ValueError。"""
    indices = set()
    for first, last in ranges:
        last = total if last is None else last
        if last > total:
            raise ValueError(f"指定的頁碼 {last} 超過總頁數 {total}")
        indices.update(range(first - 1, last))
    return indices


def add_watermark(
    src: Path,
    text: str = DEFAULT_TEXT,
    opacity: float = 0.15,
    dst: Path | None = None,
    pages: list[tuple[int, int | None]] | None = None,
) -> Path:
    """加浮水印並寫出檔案；未指定 dst 時輸出為原檔名加上 "_wm"。

    pages 為 parse_pages() 的結果，只為這些頁加浮水印；None 表示全部頁面。
    """
    reader = PdfReader(src)
    writer = PdfWriter(clone_from=reader)
    targets = select_pages(pages, len(writer.pages)) if pages else None

    for i, page in enumerate(writer.pages):
        if targets is not None and i not in targets:
            continue
        # 把 /Rotate 轉換進內容，之後 mediabox 即為使用者實際看到的方向
        page.transfer_rotation_to_content()

        box = page.mediabox
        width, height = float(box.width), float(box.height)
        wm = make_watermark_page(round(width, 2), round(height, 2), text, opacity)

        # mediabox 原點不一定是 (0, 0)，需平移對齊
        page.merge_transformed_page(
            wm, Transformation().translate(float(box.left), float(box.bottom))
        )

    dst = dst or output_path_for(src)
    with open(dst, "wb") as f:
        writer.write(f)
    return dst


def main() -> int:
    # 沒有任何命令列引數時，改以網頁伺服器模式啟動
    if len(sys.argv) == 1:
        from web_app import run_server

        run_server()
        return 0

    parser =argparse.ArgumentParser(description="幫 PDF 檔加上浮水印")
    parser.add_argument("pdfs", nargs="+", type=Path, help="要加浮水印的 PDF 檔")
    parser.add_argument("-t", "--text", default=DEFAULT_TEXT, help=f"浮水印文字（預設 {DEFAULT_TEXT}）")
    parser.add_argument("--opacity", type=float, default=0.15, help="透明度 0~1（預設 0.15）")
    parser.add_argument(
        "--pages",
        type=parse_pages,
        help='只為指定頁碼加浮水印，頁碼從 1 起，例："1,3,5-7" 或 "5-"（預設全部頁面）',
    )
    args = parser.parse_args()

    failed = False
    for src in args.pdfs:
        if not src.is_file():
            print(f"找不到檔案：{src}", file=sys.stderr)
            failed = True
            continue
        try:
            dst = add_watermark(src, args.text, args.opacity, pages=args.pages)
            print(f"{src} -> {dst}")
        except Exception as e:
            print(f"處理 {src} 失敗：{e}", file=sys.stderr)
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
