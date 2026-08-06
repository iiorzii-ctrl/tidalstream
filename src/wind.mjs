// 風の予報を1つ取り出す入口。表示側（HTTP・CLI・Streamlit）はここだけを見る。
//
// 中身は2通りある。
//   * sample … 作り物のデータ（表示側を組むため。明示したときだけ）
//   * umiten … 予報サイトから取り込む
//
// **umiten の取り込みはまだ書けていません。** 上流ページの構造が未確認のため
// （契約者専用サイトで、開発環境から到達できない）。ページの実物が手に入り
// 次第、parseUmitenForecast を埋めればここから先はそのまま動きます。
// 出力の形は src/forecast.mjs の正規形に固定してあるので、表示側と
// Streamlit 側は取り込みの完成を待たずに作れます。

import { HttpError } from './fetcher.mjs';
import { normalizeForecast } from './forecast.mjs';
import { sampleForecast } from './wind-sample.mjs';
import { umitenConfig } from './umiten.mjs';

export function sampleModeEnabled() {
  return (process.env.UMITEN_SAMPLE ?? '') === '1';
}

/**
 * 予報を1つ返す。
 * 使えるものが無ければ 503 で断る（黙って作り物を返さない。
 * 本物のつもりで見られると危ないため）。
 */
export async function getWindForecast(options = {}) {
  if (options.sample || sampleModeEnabled()) return sampleForecast(options);

  const config = umitenConfig();
  if (!config.enabled) {
    throw new HttpError(
      503,
      `${config.reason}（表示側だけ試すなら UMITEN_SAMPLE=1 で作り物のデータを出せます）`,
    );
  }

  return await fetchUmitenForecast({ config, ...options });
}

/**
 * 予報サイトから取り込む。
 *
 * 未実装。埋めるのに要るのは次の3つで、いずれも実ページを見ないと決められない。
 *   1. 入口ページから地点ごとのページへのリンクの見つけ方
 *   2. 地点ページの中の、時刻・風向・風速の並び方
 *   3. 地点名の表記（src/bay-points.mjs の対応表と突き合わせる）
 *
 * scripts/inspect-umiten.mjs を、サイトが見えるネットワークで実行すると
 * 1〜3 の手掛かりが出ます。
 */
export async function fetchUmitenForecast() {
  throw new HttpError(
    501,
    '予報サイトからの取り込みは未実装です（上流ページの構造が未確認のため）。' +
      ' scripts/inspect-umiten.mjs の出力があれば実装できます',
  );
}

/**
 * 取り込んだ地点の配列を正規形にする。取り込み処理が書けたらここに渡す。
 * 座標の対応表との突き合わせもここで行う。
 */
export function buildForecast({ source, issuedAt, fetchedAt, stations }) {
  return normalizeForecast({ source, issuedAt, fetchedAt, stations });
}
