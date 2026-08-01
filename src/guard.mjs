// 外部に公開したときに、想定外の量のリクエストが上流（海上保安庁）へ
// 流れないようにするための歯止め。
//
// 一番効くのは日付の範囲制限。制限が無いと area × 日付 × 時刻 の組み合わせが
// 天文学的な数になり、機械的に辿られると際限なく図を生成させてしまう。

import { addHours, nowInTokyo } from './frames.mjs';

/** 今日から前後何日まで許すか */
export const MAX_DATE_OFFSET_DAYS = Number(process.env.MAX_DATE_OFFSET_DAYS ?? 7);

/** 1分あたり、同一の相手から受け付けるリクエスト数 */
export const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN ?? 90);

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcMillis(time) {
  return Date.UTC(time.year, time.month - 1, time.day);
}

/**
 * 指定された日付が許容範囲かどうか。
 * 判定は日本時間の「今日」を基準にする。
 */
export function isDateAllowed(start, now = nowInTokyo()) {
  if (!start) return true; // 日付の指定が無ければ現在時刻が使われる
  const offsetDays = Math.abs(toUtcMillis(start) - toUtcMillis(now)) / DAY_MS;
  return offsetDays <= MAX_DATE_OFFSET_DAYS;
}

/** 表示の終端（開始 + 間隔 × 枚数）も範囲内に収まっているか */
export function isRangeAllowed(start, { count = 1, stepHours = 1 } = {}, now = nowInTokyo()) {
  if (!start) return true;
  if (!isDateAllowed(start, now)) return false;
  const end = addHours(start, Math.max(0, count - 1) * stepHours);
  return isDateAllowed(end, now);
}

export function dateRangeMessage() {
  return `日付は今日の前後 ${MAX_DATE_OFFSET_DAYS} 日以内で指定してください`;
}

/**
 * 相手ごとの流量制限。分単位の単純な数え上げで、超えた分だけ断る。
 * 逆プロキシ配下では x-forwarded-for の先頭が相手の住所になる。
 */
const counters = new Map();

export function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded !== '') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

export function rateLimit(key, now = Date.now(), limit = RATE_LIMIT_PER_MIN) {
  const minute = Math.floor(now / 60_000);
  const entry = counters.get(key);
  if (!entry || entry.minute !== minute) {
    counters.set(key, { minute, count: 1 });
    // 古い記録を捨てる（多人数で使う想定ではないので単純に）
    if (counters.size > 500) {
      for (const [k, v] of counters) if (v.minute < minute) counters.delete(k);
    }
    return { allowed: true, remaining: limit - 1 };
  }
  entry.count += 1;
  return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count) };
}

/** テスト用 */
export function resetRateLimit() {
  counters.clear();
}
