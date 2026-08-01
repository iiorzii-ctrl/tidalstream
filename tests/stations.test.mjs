import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { extractStations, nearestStation, parseKnots, stationId, summarize } from '../src/stations.mjs';

const html = await readFile(new URL('./fixtures/real-page.html', import.meta.url), 'utf8');

test('実ページから41地点の流速を取り出せる', () => {
  const stations = extractStations(html);
  assert.equal(stations.length, 41);
  assert.deepEqual(stations[0], { x: 243, y: 149, radius: 10, knots: 0.2, label: '0.2kn.' });
});

test('"1.5kn." のような表記から数値を取り出す', () => {
  assert.equal(parseKnots('1.5kn.'), 1.5);
  assert.equal(parseKnots('0.2kn.'), 0.2);
  assert.equal(parseKnots('2.0 kn'), 2);
  assert.equal(parseKnots('該当なし'), null);
  assert.equal(parseKnots(undefined), null);
});

test('流速の書かれていない領域は地点として拾わない', () => {
  const stations = extractStations(
    '<MAP><AREA coords=10,20,5 ALT="拡大図はこちら" shape=CIRCLE>' +
      '<AREA coords=30,40,5 ALT="0.9kn." shape=CIRCLE></MAP>',
  );
  assert.equal(stations.length, 1);
  assert.equal(stations[0].knots, 0.9);
});

test('同じ座標の地点を重複して数えない', () => {
  const stations = extractStations(
    '<AREA coords=10,20,5 ALT="0.3kn."><AREA coords=10,20,5 ALT="0.3kn.">',
  );
  assert.equal(stations.length, 1);
});

test('座標が地点の識別子になる', () => {
  const stations = extractStations(html);
  const ids = stations.map(stationId);
  assert.equal(new Set(ids).size, ids.length); // 全地点が一意
  assert.ok(ids.includes('190,395'));
});

test('クリック位置から最寄りの地点を選べる', () => {
  const stations = extractStations(html);
  const hit = nearestStation(stations, 192, 398); // 190,395 のすぐ近く
  assert.equal(hit.station.x, 190);
  assert.equal(hit.station.y, 395);
  assert.ok(hit.distance < 5);
});

test('地点が無い場合に最寄り探索が落ちない', () => {
  assert.equal(nearestStation([], 10, 10), null);
});

test('最大・最小・平均と最速地点を出せる', () => {
  const summary = summarize(extractStations(html));
  assert.equal(summary.count, 41);
  assert.equal(summary.max, 1.5); // 実ページ 2026-08-01 09:00 の最大
  assert.equal(summary.min, 0.2);
  assert.equal(summary.fastest.x, 190);
  assert.equal(summary.fastest.y, 395);
});
