const pdfDisplay = document.getElementById("pdf-display");
const pdfFile = document.getElementById("pdf-file");
const outputName = document.getElementById("output-name");
const wmText = document.getElementById("wm-text");
const pages = document.getElementById("pages");
const startBtn = document.getElementById("start");
const statusEl = document.getElementById("status");
const result = document.getElementById("result");
const download = document.getElementById("download");

let jobId = null;

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

async function postJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `伺服器錯誤（${res.status}）`);
  return data;
}

// 1. 按一下欄位即選取 PDF 並上傳
pdfDisplay.addEventListener("click", () => pdfFile.click());

pdfFile.addEventListener("change", async () => {
  const file = pdfFile.files[0];
  if (!file) return;

  jobId = null;
  outputName.disabled = true;
  startBtn.disabled = true;
  result.hidden = true;
  pdfDisplay.value = file.name;
  setStatus("上傳中…");

  const form = new FormData();
  form.append("pdf", file);
  try {
    const data = await postJson("/api/upload", { method: "POST", body: form });
    jobId = data.job_id;
    // 3. 輸出檔名預設為原檔名加上 _wm
    outputName.value = data.output_name;
    outputName.disabled = false;
    startBtn.disabled = false;
    // 頁碼留空即為全部頁面，提示總頁數
    pages.placeholder = `全部 ${data.pages} 頁（例：1,3,5-7 或 5-）`;
    setStatus(`上傳完成，共 ${data.pages} 頁`);
  } catch (err) {
    pdfDisplay.value = "";
    outputName.value = "";
    setStatus(err.message, true);
  } finally {
    pdfFile.value = "";
  }
});

// 5. 按「開始」加浮水印，完成後顯示下載連結
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!jobId) return;

  startBtn.disabled = true;
  result.hidden = true;
  setStatus("處理中…");
  try {
    const data = await postJson("/api/watermark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        output_name: outputName.value,
        text: wmText.value,
        pages: pages.value,
      }),
    });
    download.href = data.download_url;
    download.textContent = `下載 ${data.filename}`;
    result.hidden = false;
    setStatus("完成");
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    startBtn.disabled = false;
  }
});
