const form = document.getElementById('controls');
const framesEl = document.getElementById('frames');
const statusEl = document.getElementById('status');
const areaEl = document.getElementById('area');
const dateEl = document.getElementById('date');
const hourEl = document.getElementById('hour');
const stepEl = document.getElementById('step');
const countEl = document.getElementById('count');
const autoRefreshEl = document.getElementById('autoRefresh');

const CANDIDATE_KEY = 'tidalstream.candidateIndex';
let candidateIndex = Number(localStorage.getItem(CANDIDATE_KEY) ?? 0) || 0;
let autoRefreshTimer = null;
let inFlight = null;

function tokyoNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  const hour = Number(get('hour'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: hour === 24 ? 0 : hour,
  };
}

async function initAreas() {
  try {
    const { areas } = await (await fetch('/api/areas')).json();
    for (const area of areas) {
      const option = document.createElement('option');
      option.value = area.code;
      option.textContent = `${area.code} ${area.name}`;
      areaEl.append(option);
    }
  } catch {
    // 一覧が取れなくても既定の海域だけは選べるようにする
    areaEl.innerHTML = '<option value="01">01 東京湾</option>';
  }
}

function initControls() {
  for (let h = 0; h < 24; h += 1) {
    const option = document.createElement('option');
    option.value = String(h);
    option.textContent = `${String(h).padStart(2, '0')}:00`;
    hourEl.append(option);
  }
  setToNow();

  // 前回の指定を復元する
  const saved = new URLSearchParams(location.hash.slice(1));
  if (saved.get('area')) areaEl.value = saved.get('area');
  if (saved.get('date')) dateEl.value = saved.get('date');
  if (saved.get('hour')) hourEl.value = saved.get('hour');
  if (saved.get('step')) stepEl.value = saved.get('step');
  if (saved.get('count')) countEl.value = saved.get('count');
}

function setToNow() {
  const now = tokyoNow();
  dateEl.value = now.date;
  hourEl.value = String(now.hour);
}

function currentQuery() {
  return new URLSearchParams({
    area: areaEl.value || '01',
    date: dateEl.value,
    hour: hourEl.value,
    step: stepEl.value,
    count: countEl.value,
  });
}

async function load() {
  const query = currentQuery();
  location.hash = query.toString();

  if (inFlight) inFlight.abort();
  const controller = new AbortController();
  inFlight = controller;

  setStatus('読み込み中…', 'busy');
  renderSkeleton(Number(countEl.value));

  try {
    const response = await fetch(`/api/frames?${query}`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    render(data);
    const failed = data.frames.filter((f) => !f.imageUrl).length;
    const where = data.areaLabel ? `${data.areaLabel}／` : '';
    setStatus(
      failed === 0
        ? `${where}${data.frames.length}枚を表示しました（${data.stepHours}時間間隔・日本時間）`
        : `${where}${data.frames.length}枚中 ${failed}枚を取得できませんでした`,
      failed === 0 ? 'ok' : 'warn',
    );
  } catch (error) {
    if (error.name === 'AbortError') return;
    framesEl.innerHTML = '';
    setStatus(`取得に失敗しました: ${error.message}`, 'error');
  } finally {
    if (inFlight === controller) inFlight = null;
  }
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind ?? '';
}

function renderSkeleton(count) {
  framesEl.style.setProperty('--columns', String(count));
  framesEl.innerHTML = '';
  for (let i = 0; i < count; i += 1) {
    const panel = document.createElement('section');
    panel.className = 'panel skeleton';
    panel.innerHTML = '<div class="panel-head">&nbsp;</div><div class="panel-body"></div>';
    framesEl.append(panel);
  }
}

function render(data) {
  framesEl.style.setProperty('--columns', String(data.frames.length));
  framesEl.innerHTML = '';

  for (const frame of data.frames) {
    const panel = document.createElement('section');
    panel.className = 'panel';

    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = `<time>${frame.label}</time>`;
    panel.append(head);

    const body = document.createElement('div');
    body.className = 'panel-body';

    const chosen = frame.candidates[candidateIndex] ?? frame.candidates[0];
    if (chosen) {
      const link = document.createElement('a');
      link.href = frame.pageUrl;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.title = '元ページを開く';

      const img = document.createElement('img');
      img.src = chosen.proxiedUrl;
      img.alt = chosen.alt || `${frame.label} の潮流図`;
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        body.innerHTML = `<p class="error">画像を読み込めませんでした</p>`;
      });

      link.append(img);
      body.append(link);
    } else {
      const message = document.createElement('p');
      message.className = 'error';
      message.textContent = frame.error ?? '画像が見つかりませんでした';
      body.append(message);
    }

    panel.append(body);

    if (frame.candidates.length > 1) {
      panel.append(buildCandidatePicker(frame));
    }

    framesEl.append(panel);
  }
}

function buildCandidatePicker(frame) {
  const wrap = document.createElement('div');
  wrap.className = 'candidates';

  const label = document.createElement('label');
  label.textContent = '候補 ';

  const select = document.createElement('select');
  frame.candidates.forEach((candidate, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    const name = decodeURIComponent(candidate.url.split('/').pop()).slice(0, 40);
    option.textContent = `${index + 1}. ${candidate.alt || name}`;
    option.selected = index === candidateIndex;
    select.append(option);
  });

  select.addEventListener('change', () => {
    candidateIndex = Number(select.value);
    localStorage.setItem(CANDIDATE_KEY, String(candidateIndex));
    load();
  });

  label.append(select);
  wrap.append(label);
  return wrap;
}

/** 毎正時の少し後に自動で読み直す */
function scheduleAutoRefresh() {
  clearTimeout(autoRefreshTimer);
  if (!autoRefreshEl.checked) return;
  const now = new Date();
  const msToNextHour =
    (60 - now.getMinutes()) * 60_000 - now.getSeconds() * 1000 + 30_000;
  autoRefreshTimer = setTimeout(() => {
    setToNow();
    load();
    scheduleAutoRefresh();
  }, msToNextHour);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  load();
});

document.getElementById('now').addEventListener('click', () => {
  setToNow();
  load();
});

autoRefreshEl.addEventListener('change', scheduleAutoRefresh);

await initAreas();
initControls();
load();
