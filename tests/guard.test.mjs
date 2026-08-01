// 日付範囲の制限と流量制限。ネットワークには接続しない。
import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_DATE_OFFSET_DAYS, clientKey, isDateAllowed, isRangeAllowed, rateLimit, resetRateLimit } from '../src/guard.mjs';
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

test('Cookie を読み取れる', () => {
  assert.deepEqual(parseCookies('a=1; tidalstream_key=abc%20def; b=2'), {
    a: '1',
    tidalstream_key: 'abc def',
    b: '2',
  });
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('壊れた'), {});
});
