// 風の予報の「正規形」。取り込み処理と表示側の境目にあたる。
//
// あとで Streamlit（Python）側から同じデータを使えるようにするため、ここを
// 言語に依らない受け渡しの形と決めている。表示側は上流の HTML を知らずに、
// この形だけを見ればよい。
//
//   取り込み（src/umiten.mjs）→ normalizeForecast() → JSON / CSV
//                                                    ├─ ブラウザの地図
//                                                    └─ Streamlit (pandas)
//
// 決めごと:
//   * 時刻は日本標準時のオフセット付き ISO 8601（例 2026-08-06T18:00:00+09:00）。
//     Z に直さないのは、予報が「日本時間の何時」で出ているものだから。
//   * 風速・突風は m/s。ノットが要る表示側で 1.94384 を掛ける。
//     単位は units に持たせてあるので、表示側で決め打ちしないこと。
//   * 風向は「風が吹いてくる方角」の度数（気象の慣習）。0=北, 90=東。
//     矢印を描くときは向きが逆になるので注意。
//   * 位置は緯度経度。画像のピクセル座標にしないのは、地図の実装を
//     取り替えられるようにしておくため。
//   * 欠測は null。時刻の穴は station ごとに null で埋めてあるので、
//     どの地点の series も times と同じ長さ・同じ並びになる（スライダの
//     位置をそのまま添字として使えるようにするため）。

export const SCHEMA_VERSION = 1;

export const UNITS = Object.freeze({
  speed: 'm/s',
  gust: 'm/s',
  direction: 'deg', // 風が吹いてくる方角
});

const COMPASS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

/** 度数を16方位の記号にする。0 と 360 はどちらも N。 */
export function compass16(degrees) {
  if (!Number.isFinite(degrees)) return null;
  const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS_16[index];
}

/** 16方位の記号・日本語表記を度数にする（上流が文字で書いている場合のため） */
export function directionToDegrees(text) {
  // 全角の数字・英字で書かれていることがあるので、先に幅を揃える
  const raw = String(text ?? '').normalize('NFKC').trim();
  if (raw === '') return null;

  const numeric = Number.parseFloat(raw);
  if (Number.isFinite(numeric) && /^[-+]?\d/.test(raw)) return ((numeric % 360) + 360) % 360;

  const roman = raw.toUpperCase().replace(/[^NESW]/g, '');
  const index = COMPASS_16.indexOf(roman);
  if (index >= 0) return index * 22.5;

  const fromJapanese = raw.replace(/[の\s]/g, '').replace(/風$/, '');
  const jp = JAPANESE_DIRECTIONS[fromJapanese];
  return jp === undefined ? null : jp;
}

const JAPANESE_DIRECTIONS = {
  北: 0, 北北東: 22.5, 北東: 45, 東北東: 67.5,
  東: 90, 東南東: 112.5, 南東: 135, 南南東: 157.5,
  南: 180, 南南西: 202.5, 南西: 225, 西南西: 247.5,
  西: 270, 西北西: 292.5, 北西: 315, 北北西: 337.5,
};

export class ForecastError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ForecastError';
  }
}

/**
 * 取り込んだ生の値を正規形にする。
 *
 * ここで通らなかったものは表示側に出さない。上流の作りが変わったときに
 * 「地図に何も出ない」ではなく「取り込みで落ちた」と分かるようにするため。
 */
export function normalizeForecast({ source, issuedAt, fetchedAt, stations } = {}) {
  if (!Array.isArray(stations) || stations.length === 0) {
    throw new ForecastError('地点が1つもありません');
  }

  const normalized = stations.map(normalizeStation);
  // 全地点の時刻を集めて並べ、どの地点も同じ並びになるように穴を埋める
  const times = [...new Set(normalized.flatMap((s) => s.series.map((p) => p.time)))].sort();
  if (times.length === 0) throw new ForecastError('予報の時刻が1つもありません');

  for (const station of normalized) {
    const byTime = new Map(station.series.map((p) => [p.time, p]));
    station.series = times.map((time) => byTime.get(time) ?? emptyPoint(time));
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    source: {
      name: source?.name ?? '不明',
      kind: source?.kind ?? 'unknown',
      // 秘密の URL は入れない。表示側に渡るものなので。
      note: source?.note ?? null,
    },
    timezone: 'Asia/Tokyo',
    units: { ...UNITS },
    issuedAt: issuedAt ? requireIsoJst(issuedAt, 'issuedAt') : null,
    fetchedAt: fetchedAt ? requireIsoJst(fetchedAt, 'fetchedAt') : toIsoJst(new Date()),
    times,
    stations: normalized,
  };
}

function normalizeStation(station, index) {
  const name = String(station?.name ?? '').trim();
  if (!name) throw new ForecastError(`${index + 1} 番目の地点に名前がありません`);

  const id = String(station?.id ?? '').trim() || `p${index + 1}`;
  const lat = Number(station?.lat);
  const lon = Number(station?.lon);
  const located = Number.isFinite(lat) && Number.isFinite(lon);
  if (located && (lat < -90 || lat > 90 || lon < -180 || lon > 180)) {
    throw new ForecastError(`${name} の緯度経度が範囲外です: ${lat}, ${lon}`);
  }

  const series = (Array.isArray(station?.series) ? station.series : []).map((point) =>
    normalizePoint(point, name),
  );
  if (series.length === 0) throw new ForecastError(`${name} に予報の値がありません`);

  return {
    id,
    name,
    // 座標が引けなかった地点も落とさない。地図には出せないが一覧には出せる。
    lat: located ? lat : null,
    lon: located ? lon : null,
    // 上流の秘密 URL ではなく、このサーバ内の経路を入れる（表示側に渡るため）
    pageUrl: station?.pageUrl ?? null,
    series,
  };
}

function normalizePoint(point, stationName) {
  const time = requireIsoJst(point?.time, `${stationName} の時刻`);
  const direction = toNumberOrNull(point?.direction);
  return {
    time,
    speed: toNumberOrNull(point?.speed),
    gust: toNumberOrNull(point?.gust),
    direction: direction === null ? null : ((direction % 360) + 360) % 360,
    directionText:
      (point?.directionText ?? '').toString().trim() || compass16(direction),
  };
}

function emptyPoint(time) {
  return { time, speed: null, gust: null, direction: null, directionText: null };
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Date でも文字列でも受けて、+09:00 付きの ISO 8601 にする */
export function toIsoJst(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // 日本標準時は夏時間が無いので、固定の +9 時間でよい
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}+09:00`;
}

const ISO_JST_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/;

function requireIsoJst(value, label) {
  const iso = ISO_JST_RE.test(String(value ?? '')) ? String(value) : toIsoJst(value);
  if (!iso) throw new ForecastError(`${label} を時刻として読めません: ${value}`);
  return iso;
}

/**
 * 1行 = 1地点 × 1時刻 の平たい形にする。
 * pandas の DataFrame にそのまま載る形（tidy data）にしておくのが目的。
 */
export function forecastToRows(forecast) {
  const rows = [];
  for (const station of forecast.stations) {
    for (const point of station.series) {
      rows.push({
        time: point.time,
        station_id: station.id,
        station_name: station.name,
        lat: station.lat,
        lon: station.lon,
        speed_mps: point.speed,
        gust_mps: point.gust,
        direction_deg: point.direction,
        direction_text: point.directionText,
      });
    }
  }
  return rows;
}

export const ROW_COLUMNS = [
  'time',
  'station_id',
  'station_name',
  'lat',
  'lon',
  'speed_mps',
  'gust_mps',
  'direction_deg',
  'direction_text',
];

/** Excel でも pandas でも読める CSV（BOM の有無は呼び出し側で決める） */
export function forecastToCsv(forecast) {
  const rows = forecastToRows(forecast);
  const lines = [ROW_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(ROW_COLUMNS.map((column) => csvCell(row[column])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** m/s → ノット（表示側で使う。正規形は m/s のまま持つ） */
export function toKnots(metersPerSecond) {
  return metersPerSecond === null || metersPerSecond === undefined
    ? null
    : metersPerSecond * 1.94384;
}
