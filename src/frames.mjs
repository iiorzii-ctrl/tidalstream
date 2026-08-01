import { DEFAULTS, PAGE_URL } from './config.mjs';
import { fetchPage } from './fetcher.mjs';
import { buildPageUrl, discoverForm, extractAreaLabel, extractImageCandidates } from './scraper.mjs';
import { extractStations, nearestStation, stationId, summarize } from './stations.mjs';

const TOKYO_TZ = 'Asia/Tokyo';

/** 日本標準時の「今」を年月日時で返す */
export function nowInTokyo(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOKYO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Intl は 24 時を返すことがあるので 0 に丸める
    hour: hour === 24 ? 0 : hour,
  };
}

/** 暦としての時刻加算（日本には夏時間がないので UTC 上の演算で等価） */
export function addHours(time, hours) {
  const base = Date.UTC(time.year, time.month - 1, time.day, time.hour);
  const shifted = new Date(base + hours * 3_600_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
  };
}

export function formatTime(time) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${time.year}-${pad(time.month)}-${pad(time.day)} ${pad(time.hour)}:00`;
}

/**
 * 起点時刻から stepHours 間隔で count 個ぶんのページを取得し、
 * それぞれの潮流図の URL を取り出す。
 */
export async function collectFrames({
  area = DEFAULTS.area,
  start,
  count = DEFAULTS.count,
  stepHours = DEFAULTS.stepHours,
} = {}) {
  const origin = start ?? nowInTokyo();

  // まず基準ページを取得してフォーム構成を把握する
  const basePageUrl = buildPageUrl({ form: null, area, baseUrl: PAGE_URL });
  const basePage = await fetchPage(basePageUrl);
  const form = discoverForm(basePage.html);

  const times = Array.from({ length: count }, (_, i) => addHours(origin, i * stepHours));

  // 上流の同時接続数は fetcher 側で絞っているので、ここは並列で投げてよい
  const frames = await Promise.all(
    times.map(async (time) => {
      const pageUrl = buildPageUrl({ form, area, ...time, baseUrl: PAGE_URL });
      try {
        // 日時を指定したページは結果が変わらないので、ディスクにも残す
        const page = await fetchPage(pageUrl, { referer: basePageUrl, persist: true });
        const candidates = extractImageCandidates(page.html, page.url);
        const stations = extractStations(page.html);
        return {
          time,
          label: formatTime(time),
          pageUrl,
          candidates,
          imageUrl: candidates[0]?.url ?? null,
          stations,
          summary: summarize(stations),
          error: candidates.length === 0 ? 'ページ内に画像が見つかりませんでした' : null,
        };
      } catch (error) {
        return {
          time,
          label: formatTime(time),
          pageUrl,
          candidates: [],
          imageUrl: null,
          stations: [],
          summary: null,
          error: error?.message ?? String(error),
        };
      }
    }),
  );

  return {
    area,
    areaLabel: extractAreaLabel(basePage.html),
    stepHours,
    count,
    start: origin,
    basePageUrl,
    form: { roles: form.roles, formCount: form.formCount, fields: form.fields.map((f) => f.name) },
    frames,
  };
}

/**
 * 特定地点の流速の推移を集める。
 * 地点は画像上の座標で指定する（座標は時刻が変わっても一定なので識別子になる）。
 */
export async function collectSeries({
  area = DEFAULTS.area,
  start,
  hours = 24,
  stepHours = DEFAULTS.stepHours,
  x,
  y,
} = {}) {
  const origin = start ?? nowInTokyo();
  const basePageUrl = buildPageUrl({ form: null, area, baseUrl: PAGE_URL });
  const basePage = await fetchPage(basePageUrl);
  const form = discoverForm(basePage.html);

  const times = Array.from({ length: hours }, (_, i) => addHours(origin, i * stepHours));
  const points = await Promise.all(
    times.map(async (time) => {
      const pageUrl = buildPageUrl({ form, area, ...time, baseUrl: PAGE_URL });
      try {
        // 日時を指定したページは結果が変わらないので、ディスクにも残す
        const page = await fetchPage(pageUrl, { referer: basePageUrl, persist: true });
        const stations = extractStations(page.html);
        const hit = nearestStation(stations, x, y);
        return {
          time,
          label: formatTime(time),
          hour: time.hour,
          knots: hit?.station.knots ?? null,
          error: hit ? null : '地点が見つかりませんでした',
        };
      } catch (error) {
        return { time, label: formatTime(time), hour: time.hour, knots: null, error: error?.message ?? String(error) };
      }
    }),
  );

  // 選ばれた地点そのもの（基準時刻のページから確定させる）
  const baseStations = extractStations(basePage.html);
  const picked = nearestStation(baseStations, x, y)?.station ?? null;

  const values = points.map((p) => p.knots).filter((v) => v !== null);
  return {
    area,
    areaLabel: extractAreaLabel(basePage.html),
    station: picked ? { ...picked, id: stationId(picked) } : { x, y, id: `${x},${y}` },
    requested: { x, y },
    stepHours,
    hours,
    start: origin,
    points,
    stats: values.length
      ? {
          max: Math.max(...values),
          min: Math.min(...values),
          mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)),
          peakAt: points.find((p) => p.knots === Math.max(...values))?.label ?? null,
        }
      : null,
  };
}
