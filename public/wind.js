// 東京湾沿岸の風予報を、地図の上に重ねて時刻で送りながら見る画面。
//
// サーバの /api/wind（src/forecast.mjs の正規形）だけを見て描く。上流サイトの
// 作りも資格情報もこちら側には出てこない。同じデータを Streamlit 側からも
// 使えるようにしてあるので、描き方の決めごと（単位・風向の向き・色分け）は
// 両方で揃えること。

import { BAY_OUTLINE } from './bay-outline.js';

const mapEl = document.getElementById('map');
const sliderEl = document.getElementById('timeSlider');
const timeLabelEl = document.getElementById('timeLabel');
const ticksEl = document.getElementById('timeTicks');
const statusEl = document.getElementById('status');
const sourceNoteEl = document.getElementById('sourceNote');
const footSourceEl = document.getElementById('footSource');
const sampleWarningEl = document.getElementById('sampleWarning');
const tableBodyEl = document.querySelector('#windTable tbody');
const playEl = document.getElementById('play');
const unitMsEl = document.getElementById('unitMs');
const unitKtEl = document.getElementById('unitKt');

const SVG_NS = 'http://www.w3.org/2000/svg';
const UNIT_KEY = 'tidalstream.windUnit';
const MS_TO_KNOTS = 1.94384;
const PLAY_INTERVAL_MS = 700;

const state = {
  forecast: null,
  index: 0,
  unit: localStorage.getItem(UNIT_KEY) === 'kt' ? 'kt' : 'ms',
  timer: null,
};

/** 地図の投影。緯度経度をそのまま置くと東西が間延びするので cos(緯度) で詰める */
const projection = (() => {
  const lats = BAY_OUTLINE.map((p) => p[0]);
  const lons = BAY_OUTLINE.map((p) => p[1]);
  const bounds = {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lons),
    east: Math.max(...lons),
  };
  const scaleX = Math.cos((((bounds.south + bounds.north) / 2) * Math.PI) / 180);
  const pad = 0.02;

  const project = (lat, lon) => ({ x: (lon - bounds.west) * scaleX, y: bounds.north - lat });
  const topLeft = project(bounds.north, bounds.west);
  const bottomRight = project(bounds.south, bounds.east);

  return {
    project,
    viewBox: [
      topLeft.x - pad,
      topLeft.y - pad,
      bottomRight.x - topLeft.x + pad * 2,
      bottomRight.y - topLeft.y + pad * 2,
    ].join(' '),
    // 図の座標系は「度」なので、線の太さや文字の大きさもその尺度で決める
    unit: (bottomRight.y - topLeft.y) / 100,
  };
})();

/** 風速（m/s）の色分け。Streamlit 側と揃えること */
function speedColor(speed) {
  if (speed === null || speed === undefined) return 'var(--muted)';
  if (speed < 5) return '#2a78d6';
  if (speed < 10) return '#d98b17';
  return '#c0392b';
}

function toDisplaySpeed(speed) {
  if (speed === null || speed === undefined) return null;
  return state.unit === 'kt' ? speed * MS_TO_KNOTS : speed;
}

function unitLabel() {
  return state.unit === 'kt' ? 'kt' : 'm/s';
}

function formatSpeed(speed) {
  const value = toDisplaySpeed(speed);
  return value === null ? '—' : value.toFixed(1);
}

/** "2026-08-06T18:00:00+09:00" → "8/6(木) 18:00" */
function formatTime(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso ?? '');
  if (!m) return iso ?? '';
  const [, year, month, day, hour, minute] = m;
  const weekday = '日月火水木金土'[new Date(`${year}-${month}-${day}T00:00:00+09:00`).getDay()];
  return `${Number(month)}/${Number(day)}(${weekday}) ${hour}:${minute}`;
}

async function load() {
  // 画面の ?sample=1 はそのままサーバへ渡す（作り物のデータで見た目を確認する用）
  const sample = new URL(location.href).searchParams.get('sample') === '1';
  statusEl.textContent = '読み込み中…';
  try {
    const response = await fetch(`/api/wind${sample ? '?sample=1' : ''}`, { headers: { accept: 'application/json' } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error ?? `取得に失敗しました (${response.status})`);

    state.forecast = payload;
    state.index = 0;
    statusEl.textContent = '';
    setup();
  } catch (error) {
    statusEl.textContent = error?.message ?? String(error);
    statusEl.classList.add('is-error');
  }
}

function setup() {
  const forecast = state.forecast;
  sampleWarningEl.hidden = forecast.source?.kind !== 'sample';

  const issued = forecast.issuedAt ? `発表 ${formatTime(forecast.issuedAt)}` : '発表時刻は不明';
  sourceNoteEl.textContent = `${issued}／${forecast.stations.length} 地点／${forecast.times.length} 時刻`;
  footSourceEl.textContent = `出典: ${forecast.source?.name ?? '不明'}${
    forecast.source?.note ? `（${forecast.source.note}）` : ''
  }`;

  sliderEl.max = String(Math.max(0, forecast.times.length - 1));
  sliderEl.value = '0';
  renderTicks();
  drawBase();
  render();
}

/** スライダの下に日付の変わり目だけ目盛りを出す */
function renderTicks() {
  const times = state.forecast.times;
  ticksEl.replaceChildren();
  let lastDay = null;
  times.forEach((iso, i) => {
    const day = iso.slice(0, 10);
    if (day === lastDay) return;
    lastDay = day;
    const tick = document.createElement('span');
    tick.className = 'wind-tick';
    tick.style.left = `${times.length > 1 ? (i / (times.length - 1)) * 100 : 0}%`;
    tick.textContent = `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
    ticksEl.append(tick);
  });
}

/** 海岸線は時刻で変わらないので一度だけ描く */
function drawBase() {
  mapEl.setAttribute('viewBox', projection.viewBox);
  mapEl.replaceChildren();

  const points = BAY_OUTLINE.map(([lat, lon]) => {
    const { x, y } = projection.project(lat, lon);
    return `${x.toFixed(5)},${y.toFixed(5)}`;
  }).join(' ');

  const sea = document.createElementNS(SVG_NS, 'polygon');
  sea.setAttribute('points', points);
  sea.setAttribute('class', 'wind-sea');
  sea.setAttribute('stroke-width', String(projection.unit * 0.4));
  mapEl.append(sea);

  const stations = document.createElementNS(SVG_NS, 'g');
  stations.setAttribute('id', 'stations');
  mapEl.append(stations);
}

function render() {
  const forecast = state.forecast;
  const time = forecast.times[state.index];
  timeLabelEl.textContent = formatTime(time);
  sliderEl.value = String(state.index);
  unitMsEl.classList.toggle('is-on', state.unit === 'ms');
  unitKtEl.classList.toggle('is-on', state.unit === 'kt');

  drawStations();
  drawTable();
}

/**
 * 文字が重ならない位置を探す。
 *
 * 浦賀水道のあたりに地点が密集していて、素直に真上へ置くと読めなくなる。
 * 置きたい順に候補を試し、既に置いた文字と当たらない最初の場所を使う。
 * 全部当たる場合は最初の候補に戻す（消すよりは重なっても出す）。
 */
function chooseOffset(x, y, width, height, placed, u) {
  const candidates = [
    [0, -2.4], [0, 5.2],
    [4.5, -1], [-4.5, -1],
    [5, -4.5], [-5, -4.5],
    [5, 4.5], [-5, 4.5],
    [0, -7.5], [0, 9.5],
    [9, -1], [-9, -1],
    [9, -6], [-9, -6],
    [9, 6], [-9, 6],
    [0, -12], [0, 14],
  ].map(([dx, dy]) => [dx * u, dy * u]);

  for (const [dx, dy] of candidates) {
    const box = { left: x + dx - width / 2, right: x + dx + width / 2, top: y + dy - height, bottom: y + dy + height * 0.6 };
    if (!placed.some((other) => overlaps(box, other))) {
      placed.push(box);
      return { dx, dy };
    }
  }
  return { dx: candidates[0][0], dy: candidates[0][1] };
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function drawStations() {
  const group = mapEl.querySelector('#stations');
  group.replaceChildren();
  const u = projection.unit;
  const placed = [];

  // 混んでいるところから先に置き場所を決めたいので、南（湾口側）から並べる。
  // 描く順を変えると重なりの見え方が毎回変わるため、並びは固定する。
  const drawable = state.forecast.stations
    .filter((station) => station.lat !== null && station.lon !== null)
    .map((station) => ({ station, ...projection.project(station.lat, station.lon) }))
    .sort((a, b) => b.y - a.y);

  // 印そのものも避ける場所として登録しておく。他の地点の矢印や丸の上に
  // 文字が乗ると、どの数字がどの地点のものか分からなくなるため。
  for (const { x, y } of drawable) {
    placed.push({ left: x - u * 1.8, right: x + u * 1.8, top: y - u * 2.6, bottom: y + u * 2.6 });
  }

  for (const { station, x, y } of drawable) {
    const point = station.series[state.index];

    // 予報ページがあるものはリンクにする。無ければただの図形にして、
    // 押せそうに見せない。
    const node = document.createElementNS(SVG_NS, station.pageUrl ? 'a' : 'g');
    if (station.pageUrl) {
      node.setAttribute('href', station.pageUrl);
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noreferrer noopener');
    }
    node.setAttribute('class', `wind-station${station.pageUrl ? ' is-link' : ''}`);

    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent =
      `${station.name} ${formatSpeed(point.speed)} ${unitLabel()}` +
      `${point.directionText ? ` ${point.directionText}` : ''}` +
      `${station.pageUrl ? '（押すと予報ページ）' : ''}`;
    node.append(title);

    if (point.direction !== null) {
      // 風向は「吹いてくる方角」。矢印は吹いていく向きに描くので 180 度回す。
      const arrow = document.createElementNS(SVG_NS, 'path');
      const half = u * 3.6;
      const head = u * 1.5;
      arrow.setAttribute(
        'd',
        `M 0 ${half} L 0 ${-half} M ${-head * 0.62} ${-half + head} L 0 ${-half} L ${head * 0.62} ${-half + head}`,
      );
      arrow.setAttribute('transform', `translate(${x} ${y}) rotate(${(point.direction + 180) % 360})`);
      arrow.setAttribute('stroke', speedColor(point.speed));
      arrow.setAttribute('stroke-width', String(u * 0.3));
      arrow.setAttribute('fill', 'none');
      arrow.setAttribute('stroke-linecap', 'round');
      arrow.setAttribute('stroke-linejoin', 'round');
      node.append(arrow);
    }

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.setAttribute('r', String(u * 0.62));
    dot.setAttribute('fill', speedColor(point.speed));
    node.append(dot);

    const speedSize = u * 3.2;
    const nameSize = u * 2.2;
    const text = formatSpeed(point.speed);
    // 文字幅の目安。日本語は全角なので1文字ぶんを広く見ておく
    const width = Math.max(text.length * speedSize * 0.6, station.name.length * nameSize);
    const { dx, dy } = chooseOffset(x, y, width, speedSize + nameSize, placed, u);

    // 遠くへ逃がしたものは、どの印のものか分かるように細い線で結ぶ
    if (Math.hypot(dx, dy) > u * 5.5) {
      const leader = document.createElementNS(SVG_NS, 'line');
      leader.setAttribute('x1', String(x));
      leader.setAttribute('y1', String(y));
      leader.setAttribute('x2', String(x + dx));
      leader.setAttribute('y2', String(y + dy - speedSize * 0.3));
      leader.setAttribute('class', 'wind-leader');
      leader.setAttribute('stroke-width', String(u * 0.15));
      node.append(leader);
    }

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(x + dx));
    label.setAttribute('y', String(y + dy));
    label.setAttribute('class', 'wind-label');
    label.setAttribute('font-size', String(speedSize));
    label.textContent = text;
    node.append(label);

    const name = document.createElementNS(SVG_NS, 'text');
    name.setAttribute('x', String(x + dx));
    name.setAttribute('y', String(y + dy + nameSize * 1.1));
    name.setAttribute('class', 'wind-name');
    name.setAttribute('font-size', String(nameSize));
    name.textContent = station.name;
    node.append(name);

    group.append(node);
  }
}

function drawTable() {
  const rows = state.forecast.stations.map((station) => {
    const point = station.series[state.index];
    const tr = document.createElement('tr');

    const nameCell = document.createElement('th');
    nameCell.scope = 'row';
    if (station.pageUrl) {
      const link = document.createElement('a');
      link.href = station.pageUrl;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.textContent = station.name;
      nameCell.append(link);
    } else {
      nameCell.textContent = station.name;
    }

    const speedCell = document.createElement('td');
    speedCell.textContent = `${formatSpeed(point.speed)} ${unitLabel()}`;
    speedCell.style.color = speedColor(point.speed);

    const gustCell = document.createElement('td');
    gustCell.textContent = point.gust === null ? '—' : `${formatSpeed(point.gust)} ${unitLabel()}`;

    const dirCell = document.createElement('td');
    dirCell.textContent = point.directionText ?? '—';

    tr.append(nameCell, speedCell, gustCell, dirCell);
    return tr;
  });
  tableBodyEl.replaceChildren(...rows);
}

function moveTo(index) {
  const last = state.forecast.times.length - 1;
  state.index = Math.min(last, Math.max(0, index));
  render();
}

function stopPlaying() {
  if (state.timer === null) return;
  clearInterval(state.timer);
  state.timer = null;
  playEl.textContent = '▶';
  playEl.setAttribute('aria-label', '再生');
}

function togglePlay() {
  if (state.timer !== null) {
    stopPlaying();
    return;
  }
  playEl.textContent = '■';
  playEl.setAttribute('aria-label', '停止');
  state.timer = setInterval(() => {
    const last = state.forecast.times.length - 1;
    // 終わりまで行ったら止める（黙って先頭に戻ると今どこを見ているか分からなくなる）
    if (state.index >= last) {
      stopPlaying();
      return;
    }
    moveTo(state.index + 1);
  }, PLAY_INTERVAL_MS);
}

function setUnit(unit) {
  state.unit = unit;
  localStorage.setItem(UNIT_KEY, unit);
  render();
}

sliderEl.addEventListener('input', () => {
  stopPlaying();
  moveTo(Number(sliderEl.value));
});
playEl.addEventListener('click', togglePlay);
unitMsEl.addEventListener('click', () => setUnit('ms'));
unitKtEl.addEventListener('click', () => setUnit('kt'));

// 左右キーでも送れるようにする（スライダに触れていなくても効く）
document.addEventListener('keydown', (event) => {
  if (!state.forecast) return;
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === 'ArrowRight') {
    stopPlaying();
    moveTo(state.index + 1);
  } else if (event.key === 'ArrowLeft') {
    stopPlaying();
    moveTo(state.index - 1);
  }
});

load();
