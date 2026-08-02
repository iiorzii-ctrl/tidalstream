// 日付範囲の制限と流量制限。ネットワークには接続しない。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_LOCK_MINUTES,
  MAX_AUTH_FAILURES,
  MAX_DATE_OFFSET_DAYS,
  authLockMessage,
  authLockState,
  clearAuthFailures,
  clientKey,
  isDateAllowed,
  isRangeAllowed,
  rateLimit,
  recordAuthFailure,
  resetAuthFailures,
  resetRateLimit,
} from '../src/guard.mjs';
import { parseCookies } from '../src/auth.mjs';

const today = { year: 2026, month: 8, day: 1, hour: 12 };

test('既定では前後7日まで許す', () => {
  assert.equal(MAX_DATE_OFFSET_DAYS, 7);
  assert.equal(isDateAllowed({ ...today, day: 1 }, today), true);
  assert.equal(isDateAllowed({ ...today, day: 8 }, today), true); // ちょうど7日後
  assert.equal(isDateAllowed({ year: 2026, month: 7, day: 25, hour: 0 }, today), true); // 7日前
});

test('範囲外の日付は弾く', () => {
  assert.equal(isDateAllowed({ ...today, day: 9 }, today), false); // 8日後
  assert.equal(isDateAllowed({ year: 2026, month: 7, day: 24, hour: 0 }, today), false);
  assert.equal(isDateAllowed({ year: 2200, month: 1, day: 1, hour: 0 }, today), false);
  assert.equal(isDateAllowed({ year: 1, month: 1, day: 1, hour: 0 }, today), false);
});

test('日付の指定が無ければ通す（現在時刻が使われるため）', () => {
  assert.equal(isDateAllowed(undefined, today), true);
  assert.equal(isRangeAllowed(undefined, { count: 3 }, today), true);
});

test('表示の終端まで範囲に収まっているか見る', () => {
  const start = { ...today, day: 8, hour: 23 }; // 7日後の23時（開始は範囲内）
  assert.equal(isDateAllowed(start, today), true);
  // 6時間おきに6枚だと翌日（8日後）に届くので弾く
  assert.equal(isRangeAllowed(start, { count: 6, stepHours: 6 }, today), false);
  // 3枚なら同じ日に収まる
  assert.equal(isRangeAllowed(start, { count: 1, stepHours: 1 }, today), true);
});

test('月や年をまたいでも正しく数える', () => {
  const endOfYear = { year: 2026, month: 12, day: 30, hour: 0 };
  assert.equal(isDateAllowed({ year: 2027, month: 1, day: 3, hour: 0 }, endOfYear), true); // 4日後
  assert.equal(isDateAllowed({ year: 2027, month: 1, day: 10, hour: 0 }, endOfYear), false); // 11日後
});

test('流量制限は上限を超えた分だけ断る', () => {
  resetRateLimit();
  const now = 1_800_000_000_000;
  for (let i = 0; i < 5; i += 1) {
    assert.equal(rateLimit('a', now, 5).allowed, true, `${i + 1}回目`);
  }
  assert.equal(rateLimit('a', now, 5).allowed, false);
  // 相手が違えば影響しない
  assert.equal(rateLimit('b', now, 5).allowed, true);
});

test('分が変わると数え直す', () => {
  resetRateLimit();
  const now = 1_800_000_000_000;
  rateLimit('c', now, 1);
  assert.equal(rateLimit('c', now, 1).allowed, false);
  assert.equal(rateLimit('c', now + 60_000, 1).allowed, true);
});

test('逆プロキシ配下では x-forwarded-for を相手とみなす', () => {
  assert.equal(clientKey({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, socket: {} }), '203.0.113.7');
  assert.equal(clientKey({ headers: {}, socket: { remoteAddress: '198.51.100.4' } }), '198.51.100.4');
  assert.equal(clientKey({ headers: {}, socket: {} }), 'unknown');
});

const T0 = 1_800_000_000_000;

test('既定では5回間違えると15分締め出す', () => {
  resetAuthFailures();
  assert.equal(MAX_AUTH_FAILURES, 5);
  assert.equal(AUTH_LOCK_MINUTES, 15);

  for (let i = 1; i < MAX_AUTH_FAILURES; i += 1) {
    recordAuthFailure('x', `guess-${i}`, T0);
    assert.equal(authLockState('x', T0).locked, false, `${i}回目では止めない`);
  }
  recordAuthFailure('x', 'guess-last', T0); // 5回目
  const lock = authLockState('x', T0);
  assert.equal(lock.locked, true);
  assert.ok(lock.retryAfterSec > 14 * 60 && lock.retryAfterSec <= 15 * 60);
});

test('同じ鍵の繰り返しは1回ぶんとしか数えない', () => {
  resetAuthFailures();
  // ブラウザに古いパスワードが保存されている状況。何度飛んできても締め出さない
  for (let i = 0; i < MAX_AUTH_FAILURES * 5; i += 1) recordAuthFailure('保存忘れ', 'old-password', T0);
  assert.equal(authLockState('保存忘れ', T0).locked, false);

  // 一方、違う鍵を出してくる相手はきちんと数える
  for (let i = 0; i < MAX_AUTH_FAILURES; i += 1) recordAuthFailure('総当たり', `guess-${i}`, T0);
  assert.equal(authLockState('総当たり', T0).locked, true);
});

test('締め出しは時間が経てば明ける', () => {
  resetAuthFailures();
  for (let i = 0; i < MAX_AUTH_FAILURES; i += 1) recordAuthFailure('y', `guess-${i}`, T0);
  assert.equal(authLockState('y', T0 + 14 * 60_000).locked, true);
  assert.equal(authLockState('y', T0 + 16 * 60_000).locked, false);
  // 明けたあとは、また最初から数え直す
  recordAuthFailure('y', 'guess-again', T0 + 16 * 60_000);
  assert.equal(authLockState('y', T0 + 16 * 60_000).locked, false);
});

test('間隔が空いた失敗は持ち越さない', () => {
  resetAuthFailures();
  for (let i = 0; i < MAX_AUTH_FAILURES - 1; i += 1) recordAuthFailure('z', `guess-${i}`, T0);
  // 20分後の失敗は、前の4回とは別に数える
  recordAuthFailure('z', 'guess-later', T0 + 20 * 60_000);
  assert.equal(authLockState('z', T0 + 20 * 60_000).locked, false);
});

test('入れたら失敗の記録は消える', () => {
  resetAuthFailures();
  for (let i = 0; i < MAX_AUTH_FAILURES - 1; i += 1) recordAuthFailure('w', `guess-${i}`, T0);
  clearAuthFailures('w');
  // 消したあとは、また5回ぶんの猶予がある
  for (let i = 1; i < MAX_AUTH_FAILURES; i += 1) {
    recordAuthFailure('w', `retry-${i}`, T0);
    assert.equal(authLockState('w', T0).locked, false, `${i}回目`);
  }
});

test('締め出しは相手ごと', () => {
  resetAuthFailures();
  for (let i = 0; i < MAX_AUTH_FAILURES; i += 1) recordAuthFailure('攻撃元', `guess-${i}`, T0);
  assert.equal(authLockState('攻撃元', T0).locked, true);
  assert.equal(authLockState('同僚', T0).locked, false);
});

test('残り時間を分で伝える', () => {
  assert.match(authLockMessage(15 * 60), /15分/);
  assert.match(authLockMessage(30), /1分/); // 1分未満でも 0分 とは言わない
});

test('Cookie を読み取れる', () => {
  assert.deepEqual(parseCookies('a=1; tidalstream_key=abc%20def; b=2'), {
    a: '1',
    tidalstream_key: 'abc def',
    b: '2',
  });
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('壊れた'), {});
});
