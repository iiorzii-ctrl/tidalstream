// 表示側を作るための**作り物の**予報データ。
//
// 予報サイトが開発環境から見えないため、地図・スライダ・Streamlit 側を
// 先に組み立てられるように置いている。値に意味は無い。
//
// 本物と取り違えないよう、source.kind は 'sample' にしてある。表示側は
// これを見て「サンプル」と明示すること。有効にするのも明示的な指定
// （--sample / UMITEN_SAMPLE=1）に限っている。

import { BAY_POINTS } from './bay-points.mjs';
import { compass16, normalizeForecast, toIsoJst } from './forecast.mjs';

/** 同じ入力なら同じ値になる擬似乱数（テストを安定させるため） */
function pseudoRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function sampleForecast({ start = new Date(), hours = 24, stepHours = 1 } = {}) {
  const base = new Date(start);
  base.setMinutes(0, 0, 0);

  const stations = BAY_POINTS.map((point, index) => {
    const random = pseudoRandom(index * 7919 + 13);
    // 湾全体でだいたい同じ向きに吹き、地点ごとに少しずらす
    const baseDirection = 200 + index * 3;

    const series = [];
    for (let step = 0; step < hours; step += stepHours) {
      const at = new Date(base.getTime() + step * 3600 * 1000);
      // 半日周期のうねりに雑音を足す
      const swing = Math.sin((step / hours) * Math.PI * 2);
      const speed = Math.max(0.5, 6 + swing * 4 + (random() - 0.5) * 2);
      const direction = (baseDirection + swing * 40 + (random() - 0.5) * 20 + 360) % 360;

      series.push({
        time: toIsoJst(at),
        speed: Number(speed.toFixed(1)),
        gust: Number((speed * (1.3 + random() * 0.3)).toFixed(1)),
        direction: Number(direction.toFixed(0)),
        directionText: compass16(direction),
      });
    }

    return {
      id: point.id,
      name: point.name,
      lat: point.lat,
      lon: point.lon,
      pageUrl: null,
      series,
    };
  });

  return normalizeForecast({
    source: {
      name: 'サンプル（作り物のデータ）',
      kind: 'sample',
      note: '表示側の確認用に生成した値で、実際の予報ではありません',
    },
    issuedAt: toIsoJst(base),
    fetchedAt: toIsoJst(new Date()),
    stations,
  });
}
