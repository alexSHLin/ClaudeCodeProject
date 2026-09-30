const $ = (id) => document.getElementById(id);
const form = $("form"), drop = $("drop"), fileInput = $("file"), dropText = $("dropText");
const scaleInput = $("scale"), startBtn = $("start"), statusEl = $("status");
const result = $("result"), info = $("info"), download = $("download");
const viewport = $("viewport"), compare = $("compare"), handle = $("handle");
const before = $("before"), after = $("after"), zoom = $("zoom");

const MIN_SCALE = 1, MAX_SCALE = 8;
let file = null;
let beforeUrl = null;

function validScale() {
  const v = Number(scaleInput.value);
  return scaleInput.value.trim() !== "" && Number.isFinite(v) && v > MIN_SCALE && v <= MAX_SCALE;
}

// 圖片未上傳或放大倍數未輸入時，無法按下 Start
function refresh() {
  startBtn.disabled = !(file && validScale());
}

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function setFile(f) {
  if (!f) return;
  if (!f.type.startsWith("image/")) {
    setStatus("請選擇圖片檔（PNG、JPG、WebP…）", "error");
    return;
  }
  file = f;
  dropText.textContent = `${f.name}（${(f.size / 1024 / 1024).toFixed(2)} MB）`;
  drop.classList.add("has-file");
  setStatus("");
  refresh();
}

// 點擊或鍵盤選擇檔案
drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener("change", () => setFile(fileInput.files[0]));

// 拖放檔案
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => {
  e.preventDefault();
  drop.classList.add("dragover");
}));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => {
  e.preventDefault();
  drop.classList.remove("dragover");
}));
drop.addEventListener("drop", (e) => setFile(e.dataTransfer.files[0]));
// 避免拖到框外時瀏覽器直接開啟圖片
["dragover", "drop"].forEach((t) => window.addEventListener(t, (e) => e.preventDefault()));

scaleInput.addEventListener("input", () => {
  refresh();
  if (scaleInput.value.trim() && !validScale()) {
    setStatus(`放大倍數需大於 ${MIN_SCALE} 且不超過 ${MAX_SCALE}`, "error");
  } else if (statusEl.classList.contains("error")) {
    setStatus("");
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (startBtn.disabled) return;

  const data = new FormData();
  data.append("image", file);
  data.append("scale", scaleInput.value);

  startBtn.disabled = true;
  setStatus("AI 放大處理中，大圖可能需要數十秒", "busy");
  try {
    const res = await fetch("/api/upscale", { method: "POST", body: data });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `伺服器錯誤（${res.status}）`);
    await showResult(json);
    setStatus(`完成！已存到 ${json.saved_to}`);
  } catch (err) {
    setStatus(err.message || "處理失敗", "error");
  } finally {
    refresh();
  }
});

function loadImage(img, src) {
  return new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("圖片載入失敗"));
    img.src = src;
  });
}

async function showResult(json) {
  if (beforeUrl) URL.revokeObjectURL(beforeUrl);
  beforeUrl = URL.createObjectURL(file);
  const outUrl = `${json.url}?t=${Date.now()}`;
  await Promise.all([loadImage(before, beforeUrl), loadImage(after, outUrl)]);

  const [sw, sh] = json.src_size, [ow, oh] = json.out_size;
  info.textContent = `${sw}×${sh} → ${ow}×${oh}　${json.name}`;
  download.href = `${json.url}?download=1`;
  download.setAttribute("download", json.name);
  result.hidden = false;
  setPos(50);
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// 拖拉對比
function setPos(pct) {
  pct = Math.max(0, Math.min(100, pct));
  compare.style.setProperty("--pos", pct + "%");
  handle.setAttribute("aria-valuenow", Math.round(pct));
}

function posFromEvent(e) {
  const rect = compare.getBoundingClientRect();
  return ((e.clientX - rect.left) / rect.width) * 100;
}

let dragging = false;
compare.addEventListener("pointerdown", (e) => {
  dragging = true;
  compare.setPointerCapture(e.pointerId);
  setPos(posFromEvent(e));
});
compare.addEventListener("pointermove", (e) => { if (dragging) setPos(posFromEvent(e)); });
["pointerup", "pointercancel"].forEach((t) => compare.addEventListener(t, () => { dragging = false; }));

handle.addEventListener("keydown", (e) => {
  const cur = parseFloat(compare.style.getPropertyValue("--pos")) || 50;
  const step = e.shiftKey ? 10 : 2;
  if (e.key === "ArrowLeft") { setPos(cur - step); e.preventDefault(); }
  if (e.key === "ArrowRight") { setPos(cur + step); e.preventDefault(); }
});

zoom.addEventListener("change", () => viewport.classList.toggle("zoomed", zoom.checked));
