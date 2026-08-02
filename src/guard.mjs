// 外部に公開したときに、想定外の量のリクエストが上流（海上保安庁）へ
// 流れないようにするための歯止め。
//
// 一番効くのは日付の範囲制限。制限が無いと area × 日付 × 時刻 の組み合わせが
// 天文学的な数になり、機械的に辿られると際限なく図を生成させてしまう。

import { createHash } from 'node:crypto';

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

/**
 * パスワードの総当たり対策。一定回数間違えた相手を、しばらく締め出す。
 *
 * 判断のもとにしている点が2つある。
 *
 * 1. 締め出しは、鍵が合っているかを調べる「前」に効かせる。あとで調べると、
 *    締め出し中でも正解だけ 200 が返ることになり、総当たりを止められない
 *    （当たったかどうかが応答で分かってしまう）。
 *
 * 2. 数えるのは「違う鍵を出してきた回数」で、リクエストの回数ではない。
 *    同じ間違いの繰り返しは1回ぶんとして数える。ブラウザに古いパスワードが
 *    保存されていると、1ページ開くだけで同じ間違いが何度も送られるため、
 *    リクエスト数で数えると、ただの保存忘れで職場ごと締め出してしまう。
 *    総当たりは毎回違う鍵を出すので、こちらは正しく数えられる。
 */
export const MAX_AUTH_FAILURES = Number(process.env.MAX_AUTH_FAILURES ?? 5);
export const AUTH_LOCK_MINUTES = Number(process.env.AUTH_LOCK_MINUTES ?? 15);

const failures = new Map();

function lockMs() {
  return AUTH_LOCK_MINUTES * 60_000;
}

/** 出された鍵をそのまま覚えずに済むよう、短い指紋にして扱う */
function fingerprint(credential) {
  return createHash('sha256').update(String(credential)).digest('base64').slice(0, 16);
}

/** いま締め出し中かどうか */
export function authLockState(key, now = Date.now()) {
  const entry = failures.get(key);
  if (!entry) return { locked: false, retryAfterSec: 0 };
  if (entry.until > now) {
    return { locked: true, retryAfterSec: Math.ceil((entry.until - now) / 1000) };
  }
  // 締め出しが明けたら数え直しから始める
  if (entry.until > 0) failures.delete(key);
  return { locked: false, retryAfterSec: 0 };
}

/** 鍵が合わなかったことを記録する。違う鍵が上限に達したらそこから締め出す。 */
export function recordAuthFailure(key, credential = '', now = Date.now()) {
  const seen = fingerprint(credential);
  const entry = failures.get(key);

  // しばらく間が空いていれば数え直す（何日も前の失敗を持ち越さない）
  if (!entry || now - entry.first > lockMs()) {
    if (failures.size > 500) {
      for (const [k, v] of failures) if (v.until < now && now - v.first > lockMs()) failures.delete(k);
    }
    failures.set(key, { count: 1, first: now, until: 0, tried: new Set([seen]) });
    return { locked: false, remaining: MAX_AUTH_FAILURES - 1 };
  }

  // 同じ間違いの繰り返しは数えない
  if (entry.tried.has(seen)) {
    return { locked: entry.until > now, remaining: Math.max(0, MAX_AUTH_FAILURES - entry.count) };
  }

  entry.tried.add(seen);
  entry.count += 1;
  if (entry.count >= MAX_AUTH_FAILURES) entry.until = now + lockMs();
  return { locked: entry.until > now, remaining: Math.max(0, MAX_AUTH_FAILURES - entry.count) };
}

/** 通れた相手の記録は消す（打ち間違えたあと入れた場合に持ち越さない） */
export function clearAuthFailures(key) {
  failures.delete(key);
}

export function authLockMessage(retryAfterSec) {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  return `パスワードの間違いが続いたため、${minutes}分ほどアクセスを止めています`;
}

/** テスト用 */
export function resetAuthFailures() {
  failures.clear();
}
