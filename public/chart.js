// 特定地点の流速の推移を描く折れ線グラフ（単一系列・依存なしのインライン SVG）。
//
// 設計の要点:
// - 単一系列なので凡例は置かず、見出しが何のグラフかを示す
// - 直接ラベルは最大値の1点だけに付ける（全点に数値を振らない）
// - 縦のクロスヘアがポインタに追従し、最も近い時刻に吸着する
// - ホバーで見える値は表示・CSV でも取れる（ツールチップだけの情報にしない）

const NS = 'http://www.w3.org/2000/svg';

const PAD = { top: 18, right: 16, bottom: 30, left: 42 };

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** 目盛りは 0.5 刻みなどのきりの良い数に丸める */
function niceTicks(max) {
  const step = max <= 1 ? 0.25 : max <= 2.5 ? 0.5 : 1;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Number(v.toFixed(2)));
  return { ticks, top: top || step };
}

export function renderSeriesChart(container, series) {
  container.innerHTML = '';

  const points = series.points.filter((p) => p.knots !== null);
  if (points.length === 0) {
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = 'この地点の流速を取得できませんでした';
    container.append(p);
    return;
  }

  const width = 900;
  const height = 260;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const maxKnots = Math.max(...points.map((p) => p.knots));
  const { ticks, top } = niceTicks(maxKnots);

  const xAt = (i) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yAt = (v) => PAD.top + plotH - (v / top) * plotH;

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'chart-svg',
    role: 'img',
    'aria-label': `${series.station.x},${series.station.y} 地点の流速の推移`,
  });

  // --- 目盛り（ヘアライン・実線・控えめ）
  for (const t of ticks) {
    const y = yAt(t);
    svg.append(el('line', { x1: PAD.left, y1: y, x2: width - PAD.right, y2: y, class: 'chart-grid' }));
    const label = el('text', { x: PAD.left - 8, y: y + 4, class: 'chart-tick', 'text-anchor': 'end' });
    label.textContent = t.toFixed(t % 1 === 0 ? 0 : 1);
    svg.append(label);
  }

  // --- 横軸（3時間おきに時刻を出す）
  points.forEach((p, i) => {
    if (p.hour % 3 !== 0) return;
    const label = el('text', { x: xAt(i), y: height - 10, class: 'chart-tick', 'text-anchor': 'middle' });
    label.textContent = String(p.hour).padStart(2, '0');
    svg.append(label);
  });
  const axisNote = el('text', { x: width - PAD.right, y: height - 10, class: 'chart-tick', 'text-anchor': 'end' });
  axisNote.textContent = '時（JST）';
  svg.append(axisNote);

  svg.append(
    el('line', {
      x1: PAD.left,
      y1: PAD.top + plotH,
      x2: width - PAD.right,
      y2: PAD.top + plotH,
      class: 'chart-axis',
    }),
  );

  // --- データ（単一系列なので面の淡い塗り＋2px の線）
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(p.knots)}`).join(' ');
  const areaPath = `${linePath} L${xAt(points.length - 1)},${yAt(0)} L${xAt(0)},${yAt(0)} Z`;
  svg.append(el('path', { d: areaPath, class: 'chart-area' }));
  svg.append(el('path', { d: linePath, class: 'chart-line' }));

  // --- 直接ラベルは最大値の1点だけ
  const peakIndex = points.findIndex((p) => p.knots === maxKnots);
  const peakX = xAt(peakIndex);
  const peakY = yAt(maxKnots);
  svg.append(el('circle', { cx: peakX, cy: peakY, r: 4, class: 'chart-peak' }));
  const peakLabel = el('text', {
    x: Math.min(peakX, width - PAD.right - 30),
    y: peakY - 12,
    class: 'chart-peak-label',
    'text-anchor': peakIndex > points.length - 4 ? 'end' : 'middle',
  });
  peakLabel.textContent = `${maxKnots.toFixed(1)}kn`;
  svg.append(peakLabel);

  // --- ホバー層（クロスヘア＋ツールチップ。キーボードでも同じ情報を出す）
  const crosshair = el('line', { y1: PAD.top, y2: PAD.top + plotH, class: 'chart-crosshair', opacity: 0 });
  const cursor = el('circle', { r: 4, class: 'chart-cursor', opacity: 0 });
  svg.append(crosshair, cursor);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.hidden = true;

  const focusLayer = el('rect', {
    x: PAD.left,
    y: PAD.top,
    width: plotW,
    height: plotH,
    fill: 'transparent',
    tabindex: 0,
    role: 'application',
    'aria-label': '流速の推移。左右キーで時刻を移動できます',
  });
  svg.append(focusLayer);

  let active = -1;
  const show = (index) => {
    if (index < 0 || index >= points.length) return;
    active = index;
    const p = points[index];
    const x = xAt(index);
    const y = yAt(p.knots);
    crosshair.setAttribute('x1', x);
    crosshair.setAttribute('x2', x);
    crosshair.setAttribute('opacity', 1);
    cursor.setAttribute('cx', x);
    cursor.setAttribute('cy', y);
    cursor.setAttribute('opacity', 1);

    tooltip.replaceChildren();
    const value = document.createElement('strong');
    value.textContent = `${p.knots.toFixed(1)} kn`;
    const when = document.createElement('span');
    when.textContent = p.label; // 外部由来の文字列は textContent で入れる
    tooltip.append(value, when);
    tooltip.hidden = false;

    const rect = container.getBoundingClientRect();
    const scale = rect.width / width;
    tooltip.style.left = `${Math.min(Math.max(x * scale, 60), rect.width - 60)}px`;
    tooltip.style.top = `${y * scale}px`;
  };
  const hide = () => {
    active = -1;
    crosshair.setAttribute('opacity', 0);
    cursor.setAttribute('opacity', 0);
    tooltip.hidden = true;
  };

  const indexFromEvent = (event) => {
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = (x - PAD.left) / plotW;
    return Math.round(Math.min(1, Math.max(0, ratio)) * (points.length - 1));
  };

  svg.addEventListener('pointermove', (e) => show(indexFromEvent(e)));
  svg.addEventListener('pointerleave', hide);
  focusLayer.addEventListener('focus', () => show(active >= 0 ? active : 0));
  focusLayer.addEventListener('blur', hide);
  focusLayer.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') show(Math.min(points.length - 1, active + 1));
    else if (e.key === 'ArrowLeft') show(Math.max(0, active - 1));
    else return;
    e.preventDefault();
  });

  container.append(svg, tooltip);
}

/** ツールチップに頼らずに値へ到達できるようにするための表 */
export function renderSeriesTable(container, series) {
  container.replaceChildren();
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const text of ['日時（JST）', '流速']) {
    const th = document.createElement('th');
    th.textContent = text;
    head.append(th);
  }
  const body = table.createTBody();
  for (const p of series.points) {
    const row = body.insertRow();
    row.insertCell().textContent = p.label;
    row.insertCell().textContent = p.knots === null ? '—' : `${p.knots.toFixed(1)} kn`;
  }
  container.append(table);
}
