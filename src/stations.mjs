// 潮流図に重ねられている USEMAP から、各地点の流速を取り出す。
//
// 上流ページの該当箇所:
//   <MAP name=StationMap>
//     <AREA coords=243,149,10 ALT="0.2kn." TITLE="0.2kn." shape=CIRCLE>
//
// coords は画像のピクセル座標 (中心x, 中心y, 半径) で、時刻が変わっても同一。
// そのため座標を地点の識別子として使える。得られるのは流速のみで、流向は無い。

import { decodeEntities, findTags } from './html.mjs';

/** "1.5kn." → 1.5 （読み取れなければ null） */
export function parseKnots(text) {
  const m = /(-?\d+(?:\.\d+)?)\s*kn/i.exec(String(text ?? ''));
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : null;
}

/** 地点の識別子。座標が時刻をまたいで一定なことを利用する */
export function stationId(station) {
  return `${station.x},${station.y}`;
}

export function extractStations(html) {
  const stations = [];
  const seen = new Set();

  for (const area of findTags(html, 'area')) {
    const coords = String(area.attrs.coords ?? '')
      .split(',')
      .map((n) => Number.parseInt(n.trim(), 10));
    if (coords.length < 2 || coords.some((n, i) => i < 2 && !Number.isFinite(n))) continue;

    const label = decodeEntities(area.attrs.title || area.attrs.alt || '');
    const knots = parseKnots(label);
    if (knots === null) continue; // 流速の書かれていない領域は地点ではない

    const station = {
      x: coords[0],
      y: coords[1],
      radius: Number.isFinite(coords[2]) ? coords[2] : 8,
      knots,
      label: label.trim(),
    };
    const id = stationId(station);
    if (seen.has(id)) continue;
    seen.add(id);
    stations.push(station);
  }

  return stations;
}

/** 指定座標にいちばん近い地点を返す（画像をクリックした位置から地点を選ぶのに使う） */
export function nearestStation(stations, x, y) {
  let best = null;
  let bestDistance = Infinity;
  for (const station of stations) {
    const distance = (station.x - x) ** 2 + (station.y - y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = station;
    }
  }
  return best ? { station: best, distance: Math.sqrt(bestDistance) } : null;
}

/** 地点一覧の統計（最速地点の把握用） */
export function summarize(stations) {
  if (stations.length === 0) return null;
  const values = stations.map((s) => s.knots);
  const max = Math.max(...values);
  return {
    count: stations.length,
    max,
    min: Math.min(...values),
    mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)),
    fastest: stations.find((s) => s.knots === max) ?? null,
  };
}
