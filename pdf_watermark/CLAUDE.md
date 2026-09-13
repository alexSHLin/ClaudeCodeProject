# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 使用 Python 環境管理

使用 uv 管理 Python 執行環境：

- 必要時使用 uv init 初始化資料夾
- 使用 uv add 加入套件，不要使用 pip（開發用套件用 `uv add --dev`）
- 使用 uv run 執行 Python 腳本檔

## 常用指令

```bash
uv run watermark.py                                # 不帶任何引數 → 啟動網頁版 http://127.0.0.1:5050
uv run watermark.py PDF/report.pdf                 # 輸出 PDF/report_wm.pdf（與原檔同資料夾）
uv run watermark.py a.pdf b.pdf -t "Draft"         # 多檔、自訂文字（預設 Confidential）
uv run watermark.py a.pdf --pages 1,3,5-7          # 只加在指定頁（頁碼從 1 起，"5-" = 第 5 頁到最後；超出總頁數會報錯）
uv run watermark.py a.pdf --opacity 0.25           # 透明度，預設 0.15
uv run make_test_pdf.py                            # 在「目前工作目錄」產生 sample.pdf（8 種頁面尺寸／旋轉／偏移 MediaBox）
```

專案沒有測試框架與 linter。驗證方式：用 `make_test_pdf.py` 產生測試檔 → 加浮水印 → 以 pypdf `extract_text()` 確認每頁含浮水印文字，並用 dev 依賴 `pypdfium2` 把頁面渲染成圖片目視檢查位置。

## 架構重點

- 需求規格見 `web_prd.md`（網頁版）。
- `watermark.py` 是核心與 CLI 進入點；`sys.argv` 沒有引數時才延遲 import `web_app.run_server()`。網頁版（`web_app.py`，Flask）直接呼叫 `add_watermark(src, text, dst=...)`，不要在網頁端重寫浮水印邏輯。
- 網頁流程分兩步：`POST /api/upload`（選檔即上傳，存成 `cache/<job_id>/upload.pdf`，回傳預設輸出檔名與總頁數）→ `POST /api/watermark`（`pages` 字串與 CLI `--pages` 共用 `parse_pages()`，留空為全部頁面；輸出到 `cache/<job_id>/<輸出檔名>.pdf`）→ `GET /download/<job_id>/<檔名>`。`job_id` 為 uuid hex 並經正規式驗證，輸出檔名經 `safe_pdf_name` 清理，避免路徑穿越。`cache/` 已列入 `.gitignore`，目前不會自動清除。
- 前端為純 HTML/CSS/JS，放在 `front_end/`（背景圖 `bg.svg` 為手寫 SVG），由 Flask 直接提供靜態檔。
- 浮水印做法：用 reportlab 產生「只含浮水印」的單頁 PDF，再以 pypdf 的 `merge_transformed_page` 疊到原頁面上方。
- 支援混合頁面尺寸的關鍵：每頁先呼叫 `page.transfer_rotation_to_content()`，把 `/Rotate` 轉進內容，使 MediaBox 等於使用者看到的方向；再依該頁 MediaBox 尺寸產生浮水印，並平移到 MediaBox 原點（原點不一定是 0,0）。
- `make_watermark_page` 以 `lru_cache` 依（寬、高、文字、透明度）快取，同尺寸頁面共用同一張浮水印頁。
- 文字沿頁面對角線、長度約對角線 70%，字型由 `font_for()` 決定：純 Latin-1 文字用 `Helvetica-Bold`；含中文等字元時用 `cjk_font()`，依 `CJK_FONT_CANDIDATES` 嵌入第一個可用的系統 TrueType 字型（reportlab 不支援 CFF 外框，所以 PingFang、Hiragino、Noto Sans CJK 不能用），都找不到時改用不嵌入的 CID 字型 `MSung-Light`。
- `PDF/` 放實際要處理的 PDF 與輸出的 `*_wm.pdf`。
