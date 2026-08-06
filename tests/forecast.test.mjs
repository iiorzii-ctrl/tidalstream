// 風の予報の正規形。取り込み側と表示側（ブラウザ・Streamlit）の境目なので、
// 形が崩れていないことをここで押さえる。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROW_COLUMNS,
  SCHEMA_VERSION,
  compass16,
  directionToDegrees,
  forecastToCsv,
  forecastToRows,
  normalizeForecast,
  toIsoJst,
  toKnots,
} from '../src/forecast.mjs';
import { BAY_BOUNDS, BAY_POINTS, isInBay, lookupPoint } from '../src/bay-points.mjs';
import { sampleForecast } from '../src/wind-sample.mjs';

test('16方位の記号に直せる', () => {
  assert.equal(compass16(0), 'N');
  assert.equal(compass16(360), 'N');
  assert.equal(compass16(90), 'E');
  assert.equal(compass16(225), 'SW');
  assert.equal(compass16(-45), 'NW'); // 負の角度も回り込ませる
  assert.equal(compass16(null), null);
});

test('文字で書かれた風向を度数にできる', () => {
  assert.equal(directionToDegrees('SW'), 225);
  assert.equal(directionToDegrees('南西'), 225);
  assert.equal(directionToDegrees('南西の風'), 225);
  assert.equal(directionToDegrees('２２５'), 225); // 全角の数字
  assert.equal(directionToDegrees(''), null);
  assert.equal(directionToDegrees('よくわからない'), null);
});

test('時刻は日本標準時のオフセット付きで出る', () => {
  assert.equal(toIsoJst('2026-08-06T09:00:00Z'), '2026-08-06T18:00:00+09:00');
  assert.equal(toIsoJst('だめな文字列'), null);
});

test('地点ごとに時刻の穴を埋め、どの地点も同じ並びになる', () => {
  const forecast = normalizeForecast({
    stations: [
      {
        name: '横浜',
        lat: 35.45,
        lon: 139.66,
        series: [
          { time: '2026-08-06T09:00:00+09:00', speed: 5, direction: 225 },
          { time: '2026-08-06T10:00:00+09:00', speed: 6, direction: 230 },
        ],
      },
      {
        // 10時が欠けている地点
        name: '千葉',
        lat: 35.57,
        lon: 140.05,
        series: [{ time: '2026-08-06T09:00:00+09:00', speed: 4, direction: 200 }],
      },
    ],
  });

  assert.equal(forecast.schemaVersion, SCHEMA_VERSION);
  assert.equal(forecast.units.speed, 'm/s');
  assert.deepEqual(forecast.times, ['2026-08-06T09:00:00+09:00', '2026-08-06T10:00:00+09:00']);

  // スライダの位置をそのまま添字に使えるよう、長さと並びが揃っていること
  for (const station of forecast.stations) {
    assert.deepEqual(
      station.series.map((p) => p.time),
      forecast.times,
    );
  }
  const chiba = forecast.stations.find((s) => s.name === '千葉');
  assert.equal(chiba.series[1].speed, null);
  assert.equal(chiba.series[1].direction, null);
});

test('風向の記号は度数から補える', () => {
  const forecast = normalizeForecast({
    stations: [{ name: '横浜', series: [{ time: '2026-08-06T09:00:00+09:00', direction: 225 }] }],
  });
  assert.equal(forecast.stations[0].series[0].directionText, 'SW');
});

test('座標が引けない地点も落とさない', () => {
  const forecast = normalizeForecast({
    stations: [{ name: 'どこか', series: [{ time: '2026-08-06T09:00:00+09:00', speed: 3 }] }],
  });
  assert.equal(forecast.stations[0].lat, null);
  assert.equal(forecast.stations[0].lon, null);
});

test('地点や値が無ければ、黙って空を返さずに落とす', () => {
  assert.throws(() => normalizeForecast({ stations: [] }), /地点が1つも/);
  assert.throws(() => normalizeForecast({ stations: [{ name: '横浜', series: [] }] }), /値がありません/);
  assert.throws(() => normalizeForecast({ stations: [{ series: [] }] }), /名前がありません/);
  assert.throws(
    () =>
      normalizeForecast({
        stations: [{ name: '横浜', lat: 999, lon: 139, series: [{ time: '2026-08-06T09:00:00+09:00' }] }],
      }),
    /範囲外/,
  );
});

test('1行 = 1地点 × 1時刻 の平たい形にできる', () => {
  const forecast = sampleForecast({ start: new Date('2026-08-06T00:00:00Z'), hours: 3 });
  const rows = forecastToRows(forecast);

  assert.equal(rows.length, forecast.stations.length * forecast.times.length);
  assert.deepEqual(Object.keys(rows[0]), ROW_COLUMNS);
});

test('CSV は列名の行から始まり、欠測は空欄になる', () => {
  const forecast = normalizeForecast({
    stations: [
      { name: '横浜', lat: 35.45, lon: 139.66, series: [{ time: '2026-08-06T09:00:00+09:00', speed: 5 }] },
      { name: '千葉', lat: 35.57, lon: 140.05, series: [{ time: '2026-08-06T10:00:00+09:00', speed: 4 }] },
    ],
  });
  const lines = forecastToCsv(forecast).trim().split('\r\n');

  assert.equal(lines[0], ROW_COLUMNS.join(','));
  assert.equal(lines.length, 1 + 2 * 2); // 見出し + 2地点 × 2時刻
  assert.ok(lines.some((line) => line.endsWith(',,,,'))); // 穴埋めされた行
});

test('カンマを含む地点名は CSV で囲まれる', () => {
  const forecast = normalizeForecast({
    stations: [{ name: '横浜, 沖', series: [{ time: '2026-08-06T09:00:00+09:00', speed: 5 }] }],
  });
  assert.match(forecastToCsv(forecast), /"横浜, 沖"/);
});

test('ノットへの換算', () => {
  assert.ok(Math.abs(toKnots(10) - 19.4384) < 1e-6);
  assert.equal(toKnots(null), null);
});

test('作り物のデータは、それと分かる印を持つ', () => {
  const forecast = sampleForecast({ start: new Date('2026-08-06T00:00:00Z'), hours: 6 });
  assert.equal(forecast.source.kind, 'sample');
  assert.equal(forecast.times.length, 6);
  assert.equal(forecast.stations.length, BAY_POINTS.length);
});

test('作り物のデータは、同じ入力なら同じ値になる', () => {
  const options = { start: new Date('2026-08-06T00:00:00Z'), hours: 6 };
  assert.deepEqual(sampleForecast(options).stations, sampleForecast(options).stations);
});

test('地点名の表記ゆれを吸収して座標を引ける', () => {
  assert.equal(lookupPoint('横浜').id, 'yokohama');
  assert.equal(lookupPoint('横浜港').id, 'yokohama');
  assert.equal(lookupPoint('横浜港沖').id, 'yokohama');
  assert.equal(lookupPoint('ヨコハマ'), null); // 別名に無いものは無理に寄せない
  assert.equal(lookupPoint('　千葉 ').id, 'chiba'); // 全角空白と前後の空白
  assert.equal(lookupPoint('浦賀水道航路').id, 'uraga');
  assert.equal(lookupPoint('剣崎').id, 'tsurugisaki'); // 異体字は別名で拾う
  assert.equal(lookupPoint(''), null);
  assert.equal(lookupPoint(null), null);
});

test('対応表の座標は東京湾のおおよその範囲に収まっている', () => {
  for (const point of BAY_POINTS) {
    assert.ok(isInBay(point), `${point.name} が範囲外: ${point.lat}, ${point.lon}`);
  }
  assert.ok(BAY_BOUNDS.south < BAY_BOUNDS.north && BAY_BOUNDS.west < BAY_BOUNDS.east);
});

test('地点の id は重複しない', () => {
  const ids = BAY_POINTS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});
