'use strict';

const STORAGE_KEY = 'quiz_app.v1';
const app = document.getElementById('app');

// ---------- utils ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalize(s) {
  return s.toLowerCase().replace(/[.,!?;:"']/g, '').replace(/\s+/g, ' ').trim();
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

function speakBtn(text, cls = '') {
  return `<button type="button" class="icon-btn ${cls}" data-speak="${esc(text)}" title="發音">🔊</button>`;
}

// 漫畫狀聲詞特效
function sfx(text, kind = 'good') {
  document.querySelectorAll('.sfx').forEach(el => el.remove());
  const el = document.createElement('div');
  el.className = `sfx ${kind}`;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// 任何帶 data-speak 的按鈕都能發音
document.addEventListener('click', e => {
  const b = e.target.closest('[data-speak]');
  if (b) speak(b.dataset.speak);
});

// ---------- data ----------

function sampleDeck() {
  const words = [
    ['abandon', '放棄；拋棄'],
    ['accurate', '準確的'],
    ['benefit', '好處；利益'],
    ['brief', '簡短的'],
    ['capable', '有能力的'],
    ['consequence', '後果'],
    ['curious', '好奇的'],
    ['decline', '下降；婉拒'],
    ['efficient', '有效率的'],
    ['emerge', '出現；浮現'],
    ['familiar', '熟悉的'],
    ['generous', '慷慨的'],
    ['ignore', '忽視'],
    ['maintain', '維持；保養'],
    ['opportunity', '機會'],
    ['persuade', '說服'],
    ['reluctant', '不情願的'],
    ['significant', '重要的；顯著的'],
  ];
  return {
    id: uid(),
    name: '範例：常用英文單字',
    cards: words.map(([term, def]) => ({ id: uid(), term, def })),
  };
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (d && Array.isArray(d.decks)) return { best: {}, ...d };
  } catch { /* 讀不到就用預設資料 */ }
  return { decks: [sampleDeck()], best: {} };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* 無痕模式等情況可能無法儲存 */ }
}

const state = load();

// ---------- router ----------

let cleanups = [];
function onCleanup(fn) { cleanups.push(fn); }
function listen(target, type, fn) {
  target.addEventListener(type, fn);
  onCleanup(() => target.removeEventListener(type, fn));
}

function runCleanups() {
  cleanups.forEach(fn => fn());
  cleanups = [];
}

// 在同一頁重新開始（例如「再學一次」），先清掉舊的事件監聽與計時器
function restart(render, deck) {
  runCleanups();
  render(deck);
  window.scrollTo(0, 0);
}

function route() {
  runCleanups();
  if ('speechSynthesis' in window) speechSynthesis.cancel();

  const [, view, id] = location.hash.replace(/^#/, '').split('/');
  const deck = id ? state.decks.find(d => d.id === id) : null;
  const views = { deck: renderDeck, edit: renderEdit, flash: renderFlash, learn: renderLearn, test: renderTest, match: renderMatch };

  if (view === 'new') renderEdit(null);
  else if (views[view] && deck) views[view](deck);
  else renderHome();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

function backLink(deck) {
  return `<a class="back" href="#/deck/${deck.id}">← ${esc(deck.name)}</a>`;
}

function needMore(deck, n) {
  app.innerHTML = `${backLink(deck)}
    <div class="q-card center">
      <p>這個模式至少需要 ${n} 個詞彙，目前只有 ${deck.cards.length} 個。</p>
      <a class="btn primary" href="#/edit/${deck.id}">新增詞彙</a>
    </div>`;
}

// ---------- home ----------

function renderHome() {
  app.innerHTML = `
    <div class="page-head">
      <h1>我的字卡組</h1>
      <a class="btn primary" href="#/new">＋ 新增字卡組</a>
    </div>
    ${state.decks.length ? `
      <div class="deck-grid">
        ${state.decks.map(d => `
          <a class="deck-tile" href="#/deck/${d.id}">
            <h3>${esc(d.name)}</h3>
            <span class="muted">${d.cards.length} 個詞彙</span>
          </a>`).join('')}
      </div>` : `<div class="empty">還沒有字卡組，按「新增字卡組」開始吧。</div>`}`;
}

// ---------- deck ----------

function renderDeck(deck) {
  const mode = (view, ico, title, sub) => `
    <a class="mode" href="#/${view}/${deck.id}">
      <span class="ico">${ico}</span><b>${title}</b><small>${sub}</small>
    </a>`;

  app.innerHTML = `
    <a class="back" href="#/">← 所有字卡組</a>
    <div class="page-head">
      <h1>${esc(deck.name)}</h1>
      <div class="actions">
        <a class="btn small" href="#/edit/${deck.id}">✏️ 編輯</a>
        <button class="btn small danger" id="del">🗑 刪除</button>
      </div>
    </div>
    <div class="mode-grid">
      ${mode('flash', '🃏', '單字卡', '翻卡片記憶')}
      ${mode('learn', '🧠', '學習', '選擇 + 拼寫直到熟悉')}
      ${mode('test', '📝', '測驗', '混合題型打分數')}
      ${mode('match', '🧩', '配對', '計時配對遊戲')}
    </div>
    <h2>詞彙（${deck.cards.length}）</h2>
    <ul class="term-list">
      ${deck.cards.map(c => `
        <li>${speakBtn(c.term)}<span class="term">${esc(c.term)}</span><span class="def">${esc(c.def)}</span></li>`).join('')}
    </ul>`;

  $('#del').onclick = () => {
    if (!confirm(`確定要刪除「${deck.name}」嗎？`)) return;
    state.decks = state.decks.filter(d => d !== deck);
    delete state.best[deck.id];
    save();
    location.hash = '#/';
  };
}

// ---------- edit ----------

function parseBulk(text) {
  return text.split(/\r?\n/)
    .map(line => line.match(/^\s*(.+?)\s*(?:\t|,|，| - |：|:)\s*(.+?)\s*$/))
    .filter(Boolean)
    .map(m => ({ id: uid(), term: m[1], def: m[2] }));
}

function renderEdit(deck) {
  const isNew = !deck;
  const blank = () => ({ id: uid(), term: '', def: '' });
  let cards = deck ? deck.cards.map(c => ({ ...c })) : [blank(), blank(), blank()];

  app.innerHTML = `
    <a class="back" href="${isNew ? '#/' : `#/deck/${deck.id}`}">← 返回</a>
    <h1>${isNew ? '新增字卡組' : '編輯字卡組'}</h1>
    <label class="field">
      <span>名稱</span>
      <input id="name" value="${esc(deck ? deck.name : '')}" placeholder="例如：多益單字 Day 1">
    </label>
    <details class="import">
      <summary>批次匯入（從 Excel 或文字貼上）</summary>
      <p class="muted">每行一個詞彙，英文和中文之間用 Tab、逗號、冒號或「 - 」分隔。</p>
      <textarea id="bulk" rows="6" placeholder="apple, 蘋果&#10;banana	香蕉&#10;cherry - 櫻桃"></textarea>
      <button type="button" class="btn small" id="importBtn">匯入</button>
    </details>
    <div id="rows"></div>
    <button type="button" class="btn" id="addRow">＋ 新增詞彙</button>
    <div class="save-bar"><button type="button" class="btn primary big" id="saveBtn">儲存</button></div>`;

  const rows = $('#rows');

  function sync() {
    $$('.edit-row', rows).forEach((row, i) => {
      cards[i].term = $('.t', row).value;
      cards[i].def = $('.d', row).value;
    });
  }

  function renderRows() {
    rows.innerHTML = cards.map((c, i) => `
      <div class="edit-row">
        <span class="num">${i + 1}</span>
        <input class="t" value="${esc(c.term)}" placeholder="英文單字" autocapitalize="off" spellcheck="false">
        <input class="d" value="${esc(c.def)}" placeholder="中文意思">
        <button type="button" class="icon-btn rm" title="刪除">✕</button>
      </div>`).join('');
  }

  function addRow() {
    sync();
    cards.push(blank());
    renderRows();
    $$('.t', rows).at(-1).focus();
  }

  rows.addEventListener('click', e => {
    if (!e.target.classList.contains('rm')) return;
    sync();
    const i = $$('.edit-row', rows).indexOf(e.target.closest('.edit-row'));
    cards.splice(i, 1);
    renderRows();
  });

  // 在最後一列的中文欄按 Enter 自動新增一列
  rows.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (e.target.classList.contains('d') && e.target.closest('.edit-row') === $$('.edit-row', rows).at(-1)) addRow();
  });

  $('#addRow').onclick = addRow;

  $('#importBtn').onclick = () => {
    const added = parseBulk($('#bulk').value);
    if (!added.length) return alert('沒有讀到任何詞彙，請確認格式。');
    sync();
    cards = cards.filter(c => c.term.trim() || c.def.trim()).concat(added);
    renderRows();
    $('#bulk').value = '';
    $('.import').open = false;
  };

  $('#saveBtn').onclick = () => {
    sync();
    const name = $('#name').value.trim();
    const valid = cards
      .map(c => ({ ...c, term: c.term.trim(), def: c.def.trim() }))
      .filter(c => c.term && c.def);
    if (!name) return alert('請輸入字卡組名稱。');
    if (!valid.length) return alert('請至少輸入一個完整的詞彙（英文和中文都要填）。');

    let target = deck;
    if (isNew) {
      target = { id: uid(), name, cards: valid };
      state.decks.push(target);
    } else {
      target.name = name;
      target.cards = valid;
    }
    save();
    location.hash = `#/deck/${target.id}`;
  };

  renderRows();
  if (isNew) $('#name').focus();
}

// ---------- flashcards ----------

function renderFlash(deck) {
  let order = deck.cards.slice();
  let i = 0;
  let flipped = false;
  let defFirst = false;
  let shuffled = false;

  app.innerHTML = `
    ${backLink(deck)}
    <h1>單字卡</h1>
    <div class="progress"><div class="bar" id="bar"></div></div>
    <div class="flash-stage">
      <div class="flashcard" id="card" tabindex="0">
        <div class="face front"></div>
        <div class="face back"></div>
      </div>
    </div>
    <div class="flash-nav">
      <button class="btn round" id="prev" title="上一張">←</button>
      <span id="pos"></span>
      <button class="btn round" id="next" title="下一張">→</button>
    </div>
    <div class="flash-opts">
      <button class="btn small" id="shuffle">🔀 洗牌</button>
      <button class="btn small" id="side"></button>
    </div>
    <p class="hint">點卡片或按空白鍵翻面・← → 切換卡片</p>`;

  const card = $('#card');

  function face(label, text, en) {
    return `<span class="face-label">${label}</span><div>${esc(text)}</div>${en ? speakBtn(text, 'speak') : ''}`;
  }

  function show(animate = false) {
    const c = order[i];
    if (!animate) card.classList.add('no-anim');
    card.classList.toggle('flipped', flipped);
    $('.front', card).innerHTML = defFirst ? face('中文', c.def, false) : face('英文', c.term, true);
    $('.back', card).innerHTML = defFirst ? face('英文', c.term, true) : face('中文', c.def, false);
    void card.offsetWidth; // 強制重排，讓換卡時不會播放翻面動畫
    card.classList.remove('no-anim');
    $('#pos').textContent = `${i + 1} / ${order.length}`;
    $('#bar').style.width = `${((i + 1) / order.length) * 100}%`;
    $('#side').textContent = `先顯示：${defFirst ? '中文' : '英文'}`;
    $('#shuffle').classList.toggle('active', shuffled);
  }

  function flip() {
    flipped = !flipped;
    show(true);
  }

  function go(delta) {
    i = (i + delta + order.length) % order.length;
    flipped = false;
    show();
  }

  card.onclick = e => {
    if (!e.target.closest('[data-speak]')) flip();
  };
  $('#prev').onclick = () => go(-1);
  $('#next').onclick = () => go(1);
  $('#shuffle').onclick = () => {
    shuffled = !shuffled;
    order = shuffled ? shuffle(deck.cards) : deck.cards.slice();
    i = 0;
    flipped = false;
    show();
  };
  $('#side').onclick = () => {
    defFirst = !defFirst;
    flipped = false;
    show();
  };

  listen(document, 'keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); flip(); }
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  });

  show();
}

// ---------- learn ----------
// 每個詞彙要先答對一次選擇題（level 0→1），再答對一次拼寫題（level 1→2）才算熟悉；
// 答錯就退回 level 0，並在幾題之後重新出現。

function renderLearn(deck) {
  if (deck.cards.length < 2) return needMore(deck, 2);

  const items = shuffle(deck.cards).map(card => ({ card, level: 0 }));
  let queue = items.slice();
  let current = null;
  let answered = false;
  let timer = null;
  onCleanup(() => clearTimeout(timer));

  app.innerHTML = `
    ${backLink(deck)}
    <div class="learn-head"><h1>學習</h1><span id="stat"></span></div>
    <div class="progress"><div class="bar" id="bar"></div></div>
    <div id="q"></div>`;
  const qEl = $('#q');

  function updateProgress() {
    const mastered = items.filter(x => x.level >= 2).length;
    const points = items.reduce((s, x) => s + x.level, 0);
    $('#bar').style.width = `${(points / (items.length * 2)) * 100}%`;
    $('#stat').textContent = `已熟悉 ${mastered} / ${items.length}`;
  }

  function requeue(item) {
    if (item.level >= 2) return;
    const pos = Math.min(queue.length, 2 + Math.floor(Math.random() * 3));
    queue.splice(pos, 0, item);
  }

  function next() {
    clearTimeout(timer);
    updateProgress();
    answered = false;
    if (!queue.length) return finish();
    current = queue.shift();
    if (current.level === 0) askChoice();
    else askWritten();
  }

  function askChoice() {
    const c = current.card;
    const others = shuffle(deck.cards.filter(x => x.id !== c.id && x.def !== c.def)).slice(0, 3);
    const opts = shuffle([c, ...others]);
    qEl.innerHTML = `
      <div class="q-card">
        <div class="q-label">選出正確的中文意思</div>
        <div class="q-prompt">${esc(c.term)} ${speakBtn(c.term)}</div>
        <div class="options">
          ${opts.map((o, k) => `<button class="option" data-id="${o.id}"><span class="key">${k + 1}</span>${esc(o.def)}</button>`).join('')}
        </div>
        <div class="feedback" id="fb"></div>
      </div>`;
    $$('.option', qEl).forEach(btn => { btn.onclick = () => choose(btn); });
  }

  function choose(btn) {
    if (answered) return;
    answered = true;
    const ok = btn.dataset.id === current.card.id;
    $$('.option', qEl).forEach(b => {
      b.disabled = true;
      if (b.dataset.id === current.card.id) b.classList.add('correct');
    });
    if (!ok) btn.classList.add('wrong');
    grade(ok, false);
  }

  function askWritten() {
    const c = current.card;
    qEl.innerHTML = `
      <div class="q-card">
        <div class="q-label">寫出英文單字</div>
        <div class="q-prompt">${esc(c.def)}</div>
        <form class="write-form" id="wf">
          <input id="ans" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="輸入英文">
          <button class="btn primary">確認</button>
        </form>
        <button type="button" class="link-btn" id="dunno">不知道</button>
        <div class="feedback" id="fb"></div>
      </div>`;
    $('#ans').focus();
    $('#wf').onsubmit = e => {
      e.preventDefault();
      if (!answered) checkWritten($('#ans').value);
    };
    $('#dunno').onclick = () => { if (!answered) checkWritten(''); };
  }

  function checkWritten(value) {
    answered = true;
    $('#ans').disabled = true;
    const ok = normalize(value) === normalize(current.card.term);
    speak(current.card.term);
    grade(ok, value.trim() !== '');
  }

  function grade(ok, allowOverride) {
    const item = current;
    const prev = item.level;
    item.level = ok ? prev + 1 : 0;
    requeue(item);
    updateProgress();

    const fb = $('#fb');
    if (ok) {
      sfx('正解!!');
      fb.innerHTML = `<span class="good">✔ 答對了！</span>`;
      timer = setTimeout(next, 900);
      return;
    }
    sfx('ガーン!!', 'bad');
    fb.innerHTML = `
      <div class="bad">✘ 答錯了，再接再厲</div>
      <div class="answer">正確答案：<b>${esc(item.card.term)}</b> = ${esc(item.card.def)}</div>
      <div class="fb-actions">
        ${allowOverride ? '<button type="button" class="link-btn" id="override">其實我答對了</button>' : ''}
        <button type="button" class="btn primary" id="cont">繼續（Enter）</button>
      </div>`;
    $('#cont').onclick = next;
    if (allowOverride) {
      $('#override').onclick = () => {
        const idx = queue.indexOf(item);
        if (idx >= 0) queue.splice(idx, 1);
        item.level = prev + 1;
        requeue(item);
        next();
      };
    }
  }

  function finish() {
    sfx('クリア!!');
    qEl.innerHTML = `
      <div class="q-card center">
        <div class="score-num">🎉</div>
        <h2>太棒了！${items.length} 個詞彙全部熟悉了</h2>
        <div class="row-btns">
          <button class="btn primary" id="again">再學一次</button>
          <a class="btn" href="#/test/${deck.id}">去測驗</a>
          <a class="btn" href="#/deck/${deck.id}">返回</a>
        </div>
      </div>`;
    $('#again').onclick = () => restart(renderLearn, deck);
  }

  listen(document, 'keydown', e => {
    if (!current || e.isComposing) return;
    if (!answered) {
      if (current.level === 0 && /^[1-4]$/.test(e.key)) {
        const btn = $$('.option', qEl)[Number(e.key) - 1];
        if (btn) choose(btn);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      next();
    }
  });

  next();
}

// ---------- test ----------

function renderTest(deck) {
  if (deck.cards.length < 2) return needMore(deck, 2);
  const n = deck.cards.length;

  app.innerHTML = `
    ${backLink(deck)}
    <h1>測驗</h1>
    <form id="setup" class="q-card setup">
      <label class="field">
        <span>題數（最多 ${n} 題）</span>
        <input type="number" id="count" min="1" max="${n}" value="${Math.min(n, 10)}">
      </label>
      <fieldset>
        <legend>題型</legend>
        <label><input type="checkbox" name="type" value="mc" checked> 選擇題（英 → 中）</label>
        <label><input type="checkbox" name="type" value="tf" checked> 是非題</label>
        <label><input type="checkbox" name="type" value="write" checked> 填空題（中 → 英）</label>
      </fieldset>
      <button class="btn primary big">開始測驗</button>
    </form>`;

  $('#setup').onsubmit = e => {
    e.preventDefault();
    const types = $$('input[name=type]:checked').map(x => x.value);
    if (!types.length) return alert('請至少選一種題型。');
    const count = Math.max(1, Math.min(n, parseInt($('#count').value, 10) || n));
    start(count, types);
  };

  function makeQuestion(card, type) {
    const others = deck.cards.filter(x => x.id !== card.id && x.def !== card.def);
    if (type === 'mc') return { type, card, opts: shuffle([card, ...shuffle(others).slice(0, 3)]) };
    if (type === 'tf') {
      const truth = Math.random() < 0.5 || !others.length;
      return { type, card, truth, shown: truth ? card : shuffle(others)[0] };
    }
    return { type, card };
  }

  function start(count, types) {
    const qs = shuffle(deck.cards).slice(0, count).map((c, k) => makeQuestion(c, types[k % types.length]));
    const labels = { mc: '選擇題', tf: '是非題', write: '填空題' };

    app.innerHTML = `
      ${backLink(deck)}
      <h1>測驗</h1>
      <div id="score"></div>
      <form id="test">
        ${qs.map((q, k) => `
          <div class="q-card test-q" data-k="${k}">
            <div class="q-num">${k + 1} / ${qs.length}・${labels[q.type]}</div>
            ${questionBody(q, k)}
          </div>`).join('')}
        <div class="row-btns"><button class="btn primary big" id="submit">交卷</button></div>
      </form>`;

    // 填空題按 Enter 跳到下一個填空，而不是直接交卷
    $('#test').addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.isComposing || e.target.tagName !== 'INPUT') return;
      e.preventDefault();
      const inputs = $$('input:not([type])', $('#test'));
      const nextInput = inputs[inputs.indexOf(e.target) + 1];
      if (nextInput) nextInput.focus();
    });

    $('#test').onsubmit = e => {
      e.preventDefault();
      const form = e.target;
      const answers = qs.map((q, k) => {
        if (q.type === 'write') return form.elements[`q${k}`].value.trim();
        const checked = $(`input[name=q${k}]:checked`, form);
        return checked ? checked.value : '';
      });
      const blanks = answers.filter(a => a === '').length;
      if (blanks && !confirm(`還有 ${blanks} 題沒作答，確定要交卷嗎？`)) return;
      grade(qs, answers);
    };
  }

  function questionBody(q, k) {
    const c = q.card;
    if (q.type === 'mc') {
      return `
        <div class="q-prompt">${esc(c.term)} ${speakBtn(c.term)}</div>
        <div class="choice-list">
          ${q.opts.map(o => `<label class="choice" data-v="${o.id}"><input type="radio" name="q${k}" value="${o.id}"> ${esc(o.def)}</label>`).join('')}
        </div>`;
    }
    if (q.type === 'tf') {
      return `
        <div class="q-prompt">${esc(c.term)} ${speakBtn(c.term)}<br><span class="muted">的意思是</span> ${esc(q.shown.def)}</div>
        <div class="tf-row">
          <label class="choice" data-v="true"><input type="radio" name="q${k}" value="true"> ⭕ 對</label>
          <label class="choice" data-v="false"><input type="radio" name="q${k}" value="false"> ❌ 錯</label>
        </div>`;
    }
    return `
      <div class="q-prompt">${esc(c.def)}</div>
      <input name="q${k}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="輸入英文">`;
  }

  function grade(qs, answers) {
    let correct = 0;
    qs.forEach((q, k) => {
      const box = $(`.test-q[data-k="${k}"]`);
      const a = answers[k];
      let ok;
      let rightValue;
      if (q.type === 'mc') { rightValue = q.card.id; ok = a === rightValue; }
      else if (q.type === 'tf') { rightValue = String(q.truth); ok = a === rightValue; }
      else ok = normalize(a) === normalize(q.card.term);

      if (ok) correct++;
      box.classList.add(ok ? 'correct' : 'wrong');
      $$('input', box).forEach(inp => { inp.disabled = true; });

      if (q.type !== 'write') {
        $$('.choice', box).forEach(lab => {
          if (lab.dataset.v === rightValue) lab.classList.add('correct');
          else if (lab.dataset.v === a) lab.classList.add('wrong');
        });
      }
      if (!ok) {
        const extra = q.type === 'tf' && !q.truth ? `（${esc(q.shown.def)} 是 ${esc(q.shown.term)}）` : '';
        box.insertAdjacentHTML('beforeend',
          `<div class="answer">正確答案：${esc(q.card.term)} = ${esc(q.card.def)} ${extra}</div>`);
      }
    });

    const pct = Math.round((correct / qs.length) * 100);
    if (pct === 100) sfx('パーフェクト!!');
    else if (pct >= 60) sfx('合格!!');
    else sfx('ガーン!!', 'bad');
    const msg = pct === 100 ? '完美！🎉' : pct >= 80 ? '表現很好！' : pct >= 60 ? '不錯，再複習一下錯的題目' : '多練習幾次「學習」模式吧';
    $('#score').innerHTML = `
      <div class="q-card score">
        <div class="score-num">${pct}%</div>
        <div>答對 ${correct} / ${qs.length} 題・${msg}</div>
        <div class="row-btns">
          <button class="btn primary" id="retry">再測一次</button>
          <a class="btn" href="#/learn/${deck.id}">去學習</a>
          <a class="btn" href="#/deck/${deck.id}">返回</a>
        </div>
      </div>`;
    $('#submit').remove();
    $('#retry').onclick = () => restart(renderTest, deck);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ---------- match ----------

function renderMatch(deck) {
  if (deck.cards.length < 2) return needMore(deck, 2);
  const PAIRS = 6;
  let interval = null;
  onCleanup(() => clearInterval(interval));

  app.innerHTML = `
    ${backLink(deck)}
    <div class="match-head"><h1>配對</h1><div class="timer" id="timer">0.0 秒</div></div>
    <div id="board"></div>`;

  const best = () => state.best[deck.id];

  function intro() {
    $('#board').innerHTML = `
      <div class="q-card center">
        <p>把英文單字和中文意思配對起來，越快越好！<br>配錯會加罰 1 秒。</p>
        ${best() ? `<p class="muted">最佳紀錄：${best().toFixed(1)} 秒</p>` : ''}
        <button class="btn primary big" id="go">開始遊戲</button>
      </div>`;
    $('#go').onclick = play;
  }

  function play() {
    const cards = shuffle(deck.cards).slice(0, PAIRS);
    const tiles = shuffle(cards.flatMap(c => [
      { id: c.id, text: c.term, en: true },
      { id: c.id, text: c.def, en: false },
    ]));
    $('#board').innerHTML = `
      <div class="match-grid">
        ${tiles.map(t => `<button class="tile ${t.en ? 'en' : ''}" data-id="${t.id}">${esc(t.text)}</button>`).join('')}
      </div>`;

    const startedAt = performance.now();
    let penalty = 0;
    let selected = null;
    let left = cards.length;
    const elapsed = () => (performance.now() - startedAt) / 1000 + penalty;

    clearInterval(interval);
    interval = setInterval(() => { $('#timer').textContent = `${elapsed().toFixed(1)} 秒`; }, 100);

    $$('.tile', $('#board')).forEach(btn => {
      btn.onclick = () => {
        if (!selected) {
          selected = btn;
          btn.classList.add('selected');
          return;
        }
        if (selected === btn) {
          btn.classList.remove('selected');
          selected = null;
          return;
        }
        const a = selected;
        selected = null;
        a.classList.remove('selected');
        if (a.dataset.id === btn.dataset.id) {
          [a, btn].forEach(b => { b.classList.add('matched'); b.disabled = true; });
          if (--left === 0) done(elapsed());
        } else {
          penalty += 1;
          [a, btn].forEach(b => {
            b.classList.add('wrong');
            setTimeout(() => b.classList.remove('wrong'), 400);
          });
        }
      };
    });
  }

  function done(time) {
    clearInterval(interval);
    sfx('クリア!!');
    $('#timer').textContent = `${time.toFixed(1)} 秒`;
    const prev = best();
    const isBest = !prev || time < prev;
    if (isBest) {
      state.best[deck.id] = time;
      save();
    }
    setTimeout(() => {
      const board = $('#board');
      if (!board) return;
      board.innerHTML = `
        <div class="q-card center">
          <div class="score-num">${time.toFixed(1)} 秒</div>
          ${isBest ? '<p class="good">🏆 新紀錄！</p>' : `<p class="muted">最佳紀錄：${prev.toFixed(1)} 秒</p>`}
          <div class="row-btns">
            <button class="btn primary" id="again">再玩一次</button>
            <a class="btn" href="#/deck/${deck.id}">返回</a>
          </div>
        </div>`;
      $('#again').onclick = play;
    }, 450);
  }

  intro();
}

route();
