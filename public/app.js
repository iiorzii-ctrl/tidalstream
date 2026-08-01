import { renderSeriesChart, renderSeriesTable } from './chart.js';
import { applyStatic, lang, t, toggleLang } from './i18n.js';

const form = document.getElementById('controls');
const framesEl = document.getElementById('frames');
const statusEl = document.getElementById('status');
const areaEl = document.getElementById('area');
const dateEl = document.getElementById('date');
const hourEl = document.getElementById('hour');
const stepEl = document.getElementById('step');
const countEl = document.getElementById('count');
const autoRefreshEl = document.getElementById('autoRefresh');

const pointSection = document.getElementById('point');
const pointTitle = document.getElementById('pointTitle');
const pointStats = document.getElementById('pointStats');
const pointTable = document.getElementById('pointTable');
const chartEl = document.getElementById('chart');
const arrowStrip = document.getElementById('arrowStrip');
const seriesHoursEl = document.getElementById('seriesHours');
const csvLink = document.getElementById('csvLink');

const CANDIDATE_KEY = 'tidalstream.candidateIndex';
const POINT_KEY = 'tidalstream.point';
let candidateIndex = Number(localStorage.getItem(CANDIDATE_KEY) ?? 0) || 0;
let availableAreas = [];
let lastData = null; // 言語切り替え時に再描画するために保持する
let selectedPoint = readSelectedPoint();
// 推移を表示している海域。座標は海域ごとの画像に紐づくので、海域が変われば選択は無効になる
let pointArea = selectedPoint?.area ?? null;
// 直近に表示した各時刻のコマ（画像 URL 込み）と、元画像の実寸。
// 選んだ地点の矢印を切り出して拡大表示するのに使う。
let lastFrames = [];
let frameNaturalSize = null;
let autoRefreshTimer = null;
let inFlight = null;
let seriesInFlight = null;

function readSelectedPoint() {
  try {
    const saved = JSON.parse(localStorage.getItem(POINT_KEY) ?? 'null');
    return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null;
  } catch {
    return null;
  }
}

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
    availableAreas = areas;
    renderAreaOptions();
  } catch {
    // 一覧が取れなくても既定の海域だけは選べるようにする
    availableAreas = [{ code: '01', name: '東京湾', nameEn: 'Tokyo Bay' }];
    renderAreaOptions();
  }
}

/** 海域の選択肢を、いまの言語の名前で作り直す */
function renderAreaOptions() {
  const current = areaEl.value;
  areaEl.replaceChildren();
  for (const area of availableAreas) {
    const option = document.createElement('option');
    option.value = area.code;
    option.textContent = `${area.code} ${lang === 'en' ? (area.nameEn ?? area.name) : area.name}`;
    areaEl.append(option);
  }
  if (current) areaEl.value = current;
}

/** 表示中の海域名を、いまの言語で返す */
function areaLabelFor(code, fallback) {
  const area = availableAreas.find((a) => a.code === code);
  if (!area) return fallback ?? '';
  return lang === 'en' ? (area.nameEn ?? area.name) : area.name;
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

  setStatus(t('status.loading'), 'busy');
  renderSkeleton(Number(countEl.value));

  try {
    const response = await fetch(`/api/frames?${query}`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    lastData = data;
    render(data);

    // 地点の座標は海域ごとの画像に紐づくので、海域が変わったら選択を持ち越さない。
    // 同じ海域で日時だけ変えた場合は、推移も新しい日時で取り直す。
    if (selectedPoint && pointArea && pointArea !== data.area) clearPoint();
    else if (selectedPoint) loadSeries();

    const failed = data.frames.filter((f) => !f.imageUrl).length;
    const name = areaLabelFor(data.area, data.areaLabel);
    const where = name ? `${name}${lang === 'en' ? ': ' : '／'}` : '';
    const params = { area: where, count: data.frames.length, step: data.stepHours, failed };
    setStatus(t(failed === 0 ? 'status.shown' : 'status.partial', params), failed === 0 ? 'ok' : 'warn');
  } catch (error) {
    if (error.name === 'AbortError') return;
    framesEl.innerHTML = '';
    setStatus(t('status.failed', { message: error.message }), 'error');
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
  lastFrames = data.frames;

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
      const stage = document.createElement('div');
      stage.className = 'stage';

      const img = document.createElement('img');
      img.src = chosen.proxiedUrl;
      img.alt = t('frame.chartAlt', { time: frame.label });
      img.addEventListener('error', () => {
        body.replaceChildren(Object.assign(document.createElement('p'), { className: 'error', textContent: t('frame.imageError') }));
      });
      // 地点の座標は元画像のピクセル基準なので、読み込み後の実寸を使って重ねる
      img.addEventListener('load', () => renderStations(stage, img, frame));

      stage.append(img);
      body.append(stage);
    } else {
      const message = document.createElement('p');
      message.className = 'error';
      message.textContent = frame.error ?? t('frame.noImage');
      body.append(message);
    }

    panel.append(body);

    if (frame.candidates.length > 1) {
      panel.append(buildCandidatePicker(frame));
    }

    framesEl.append(panel);
  }
}

/**
 * 潮流図の上に流速の観測地点を重ねる。
 * 丸そのものは控えめにして、選択のための当たり判定を広く取る。
 */
function renderStations(stage, img, frame) {
  stage.querySelectorAll('.station').forEach((n) => n.remove());
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h || !frame.stations?.length) return;
  // 矢印の切り出しに使うので、元画像の実寸を覚えておく
  frameNaturalSize = { width: w, height: h };
  if (selectedPoint) renderArrowStrip();

  for (const station of frame.stations) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'station';
    dot.style.left = `${(station.x / w) * 100}%`;
    dot.style.top = `${(station.y / h) * 100}%`;
    dot.dataset.id = `${station.x},${station.y}`;
    dot.title = t('frame.stationTitle', { knots: station.knots.toFixed(1), time: frame.label });
    dot.setAttribute(
      'aria-label',
      t('frame.stationAria', { x: station.x, y: station.y, knots: station.knots.toFixed(1) }),
    );
    if (selectedPoint && selectedPoint.x === station.x && selectedPoint.y === station.y) {
      dot.classList.add('is-selected');
    }

    const value = document.createElement('span');
    value.className = 'station-value';
    value.textContent = station.knots.toFixed(1);
    dot.append(value);

    dot.addEventListener('click', () => selectPoint({ x: station.x, y: station.y }));
    stage.append(dot);
  }
}

function selectPoint(point) {
  selectedPoint = { ...point, area: areaEl.value };
  pointArea = areaEl.value;
  localStorage.setItem(POINT_KEY, JSON.stringify(selectedPoint));
  document.querySelectorAll('.station').forEach((dot) => {
    dot.classList.toggle('is-selected', dot.dataset.id === `${point.x},${point.y}`);
  });
  loadSeries();
}

function clearPoint() {
  selectedPoint = null;
  pointArea = null;
  localStorage.removeItem(POINT_KEY);
  document.querySelectorAll('.station.is-selected').forEach((d) => d.classList.remove('is-selected'));
  arrowStrip.hidden = true;
  pointSection.hidden = true;
}

/**
 * 選んだ地点の矢印を、表示中の各時刻ぶん切り出して拡大表示する。
 * 元画像そのものを CSS で拡大するだけなので、向きも速度も正確に伝わる
 * （矢印の色が速度、矢の向きが流れの向き）。追加の解析はしない。
 */
function renderArrowStrip() {
  const crops = document.getElementById('arrowCrops');
  if (!selectedPoint || !frameNaturalSize || lastFrames.length === 0) {
    arrowStrip.hidden = true;
    return;
  }

  const { width: natW, height: natH } = frameNaturalSize;
  const zoom = 2; // 拡大率。上げすぎると矢印だけで埋まり、周りとの関係が見えなくなる
  const { x, y } = selectedPoint;

  crops.replaceChildren();
  for (const frame of lastFrames) {
    const url = frame.candidates[candidateIndex]?.proxiedUrl ?? frame.candidates[0]?.proxiedUrl;
    const cell = document.createElement('figure');
    cell.className = 'arrow-crop';

    const view = document.createElement('div');
    view.className = 'arrow-crop-view';
    if (url) {
      view.style.backgroundImage = `url("${url}")`;
      view.style.backgroundSize = `${natW * zoom}px ${natH * zoom}px`;
      // 地点(x,y)を枠の中央に置く。background-position の % は「画像とコンテナの
      // 中心合わせ」なので、渡すのは画像中心からのズレ。こうすると枠の大きさ
      // （画面では px、印刷では mm）が変わっても中央にそろう。
      view.style.setProperty('--point-x', `${(x - natW / 2) * zoom}px`);
      view.style.setProperty('--point-y', `${(y - natH / 2) * zoom}px`);
    } else {
      view.textContent = '—';
    }

    const caption = document.createElement('figcaption');
    caption.textContent = frame.label.slice(11); // 時:分 だけ
    cell.append(view, caption);
    crops.append(cell);
  }
  arrowStrip.hidden = false;
}

async function loadSeries() {
  if (!selectedPoint) return;
  const query = currentQuery();
  query.set('x', String(selectedPoint.x));
  query.set('y', String(selectedPoint.y));
  query.set('hours', seriesHoursEl.value);
  query.delete('count');

  csvLink.href = `/api/series.csv?${query}`;
  pointSection.hidden = false;
  pointStats.textContent = t('status.loading');
  chartEl.classList.add('is-loading'); // 再取得中も前の描画を保つ

  if (seriesInFlight) seriesInFlight.abort();
  const controller = new AbortController();
  seriesInFlight = controller;

  try {
    const response = await fetch(`/api/series?${query}`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);

    pointTitle.textContent = t('point.titleAt', { x: data.station.x, y: data.station.y });
    pointStats.textContent = data.stats
      ? t('point.stats', {
          max: data.stats.max.toFixed(1),
          peakAt: data.stats.peakAt,
          min: data.stats.min.toFixed(1),
          mean: data.stats.mean.toFixed(2),
        })
      : t('point.statsNone');
    pointArea = data.area;
    renderArrowStrip();
    renderSeriesChart(chartEl, data);
    renderSeriesTable(pointTable, data);
  } catch (error) {
    if (error.name === 'AbortError') return;
    pointStats.textContent = t('point.seriesFailed', { message: error.message });
    chartEl.replaceChildren();
  } finally {
    chartEl.classList.remove('is-loading');
    if (seriesInFlight === controller) seriesInFlight = null;
  }
}

function buildCandidatePicker(frame) {
  const wrap = document.createElement('div');
  wrap.className = 'candidates';

  const label = document.createElement('label');
  label.textContent = `${t('frame.candidates')} `;

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

document.getElementById('print').addEventListener('click', () => window.print());

document.getElementById('now').addEventListener('click', () => {
  setToNow();
  load();
});

autoRefreshEl.addEventListener('change', scheduleAutoRefresh);
seriesHoursEl.addEventListener('change', loadSeries);
document.getElementById('clearPoint').addEventListener('click', clearPoint);

document.getElementById('toggleTable').addEventListener('click', (event) => {
  const open = pointTable.hidden;
  pointTable.hidden = !open;
  event.currentTarget.setAttribute('aria-expanded', String(open));
  event.currentTarget.textContent = t(open ? 'point.hideTable' : 'point.showTable');
});

// 言語切り替え。取得済みのデータを使い直すので、上流には取りに行かない。
document.getElementById('langToggle').addEventListener('click', () => {
  toggleLang();
  applyStatic();
  renderAreaOptions();
  if (lastData) {
    render(lastData);
    const name = areaLabelFor(lastData.area, lastData.areaLabel);
    const where = name ? `${name}${lang === 'en' ? ': ' : '／'}` : '';
    const failed = lastData.frames.filter((f) => !f.imageUrl).length;
    setStatus(
      t(failed === 0 ? 'status.shown' : 'status.partial', {
        area: where,
        count: lastData.frames.length,
        step: lastData.stepHours,
        failed,
      }),
      failed === 0 ? 'ok' : 'warn',
    );
  }
  // 表の開閉状態に合わせてボタンの文言を戻す
  document.getElementById('toggleTable').textContent = t(
    pointTable.hidden ? 'point.showTable' : 'point.hideTable',
  );
  if (selectedPoint) loadSeries();
});

applyStatic();
await initAreas();
initControls();
// 前回選んだ地点があれば、load() の中で推移も復元される
await load();
