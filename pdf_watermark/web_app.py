"""watermark.py 的網頁版：不帶引數執行 `uv run watermark.py` 時啟動。

上傳檔與輸出檔都放在 cache/<job_id>/ 之下。
"""

import argparse
import re
import uuid
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory
from pypdf import PdfReader

from watermark import DEFAULT_TEXT, add_watermark, parse_pages

BASE_DIR = Path(__file__).resolve().parent
FRONT_END_DIR = BASE_DIR / "front_end"
CACHE_DIR = BASE_DIR / "cache"
PORT = 5050
UPLOAD_NAME = "upload.pdf"
JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100 MB


def safe_pdf_name(name: str) -> str:
    """去除路徑與不合法字元，並確保副檔名為 .pdf。"""
    name = Path(name.replace("\\", "/")).name
    name = re.sub(r'[\x00-\x1f<>:"/\\|?*]', "_", name).strip(" .")
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return name if name != ".pdf" else "output.pdf"


def job_dir(job_id: str) -> Path:
    if not JOB_ID_RE.fullmatch(job_id):
        abort(404)
    path = CACHE_DIR / job_id
    if not path.is_dir():
        abort(404)
    return path


@app.get("/")
def index():
    return send_from_directory(FRONT_END_DIR, "index.html")


@app.get("/<path:filename>")
def front_end(filename):
    return send_from_directory(FRONT_END_DIR, filename)


@app.post("/api/upload")
def upload():
    file = request.files.get("pdf")
    if not file or not file.filename:
        return jsonify(error="請選擇 PDF 檔"), 400

    job_id = uuid.uuid4().hex
    folder = CACHE_DIR / job_id
    folder.mkdir(parents=True)
    src = folder / UPLOAD_NAME
    file.save(src)

    try:
        total_pages = len(PdfReader(src).pages)
    except Exception:
        src.unlink()
        folder.rmdir()
        return jsonify(error="這不是有效的 PDF 檔"), 400

    stem = Path(safe_pdf_name(file.filename)).stem
    return jsonify(
        job_id=job_id, filename=file.filename, output_name=f"{stem}_wm", pages=total_pages
    )


@app.post("/api/watermark")
def watermark():
    data = request.get_json(silent=True) or {}
    folder = job_dir(str(data.get("job_id", "")))
    text = str(data.get("text", "")).strip() or DEFAULT_TEXT
    out_name = safe_pdf_name(str(data.get("output_name", "")).strip())
    if out_name == UPLOAD_NAME:
        out_name = "upload_wm.pdf"

    pages_spec = str(data.get("pages", "")).strip()
    try:
        pages = parse_pages(pages_spec) if pages_spec else None
    except argparse.ArgumentTypeError as e:
        return jsonify(error=str(e)), 400

    try:
        add_watermark(folder / UPLOAD_NAME, text=text, dst=folder / out_name, pages=pages)
    except ValueError as e:  # 頁碼超過總頁數
        return jsonify(error=str(e)), 400
    except Exception as e:
        return jsonify(error=f"處理失敗：{e}"), 500

    return jsonify(download_url=f"/download/{folder.name}/{out_name}", filename=out_name)


@app.get("/download/<job_id>/<path:filename>")
def download(job_id, filename):
    return send_from_directory(job_dir(job_id), filename, as_attachment=True)


@app.errorhandler(413)
def too_large(_):
    return jsonify(error="檔案太大（上限 100 MB）"), 413


def run_server() -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    print(f"PDF 浮水印網頁版已啟動：http://127.0.0.1:{PORT}")
    print("按 Ctrl+C 結束")
    app.run(host="127.0.0.1", port=PORT)
