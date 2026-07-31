import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { PAGE_URL } from '../src/config.mjs';
import { decodeBody, parseOptions, findElements } from '../src/html.mjs';
import { buildPageUrl, discoverForm, extractImageCandidates, shapeOfOptions } from '../src/scraper.mjs';
import { addHours, formatTime, nowInTokyo } from '../src/frames.mjs';

const html = await readFile(new URL('./fixtures/page.html', import.meta.url), 'utf8');
const pageUrl = `${PAGE_URL}?area=01`;

test('フォームのパラメータ名と役割を推定できる', () => {
  const form = discoverForm(html);
  assert.equal(form.formCount, 1);
  assert.equal(form.roles.year, 'yy');
  assert.equal(form.roles.month, 'mm');
  assert.equal(form.roles.day, 'dd');
  assert.equal(form.roles.hour, 'hh');
  assert.equal(form.roles.area, 'area');
});

test('submit ボタンはフィールドに含めない', () => {
  const form = discoverForm(html);
  assert.ok(!form.fields.some((f) => f.name === 'submit'));
  assert.ok(form.fields.some((f) => f.name === 'mode' && f.value === '1'));
});

test('selected の値を初期値として読む', () => {
  const form = discoverForm(html);
  const byName = Object.fromEntries(form.fields.map((f) => [f.name, f.value]));
  assert.equal(byName.yy, '2026');
  assert.equal(byName.mm, '7');
  assert.equal(byName.hh, '09');
});

test('選択肢の形から年月日時を判別できる', () => {
  const hours = Array.from({ length: 24 }, (_, i) => ({ value: String(i) }));
  const months = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1) }));
  const days = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1) }));
  assert.equal(shapeOfOptions(hours), 'hour');
  assert.equal(shapeOfOptions(months), 'month');
  assert.equal(shapeOfOptions(days), 'day');
  assert.equal(shapeOfOptions([{ value: '2025' }, { value: '2026' }]), 'year');
});

test('指定時刻の URL を組み立てられる（0埋めは選択肢に合わせる）', () => {
  const form = discoverForm(html);
  const url = new URL(
    buildPageUrl({ form, area: '02', year: 2026, month: 8, day: 1, hour: 5, baseUrl: pageUrl }),
  );
  assert.equal(url.searchParams.get('area'), '02');
  assert.equal(url.searchParams.get('yy'), '2026');
  assert.equal(url.searchParams.get('mm'), '8'); // 選択肢が 0 埋めなしなので合わせる
  assert.equal(url.searchParams.get('dd'), '1');
  assert.equal(url.searchParams.get('hh'), '05'); // 選択肢が 0 埋めありなので合わせる
  assert.equal(url.searchParams.get('mode'), '1'); // hidden は引き継ぐ
});

test('フォームが無いページではフォールバックのパラメータ名を使う', () => {
  const url = new URL(buildPageUrl({ form: null, area: '01', year: 2026, month: 7, day: 31, hour: 9 }));
  assert.equal(url.searchParams.get('area'), '01');
  assert.equal(url.searchParams.get('year'), '2026');
  assert.equal(url.searchParams.get('hour'), '9');
});

test('潮流図をロゴやボタンより上位に順位付けする', () => {
  const candidates = extractImageCandidates(html, pageUrl);
  assert.equal(candidates[0].url, 'https://www1.kaiho.mlit.go.jp/TIDE/pred2/img/curr_20260731090000.gif');
  assert.ok(candidates.length >= 3);
  assert.ok(candidates[0].score > candidates[1].score);
  assert.equal(candidates[0].width, 600);
});

test('相対 URL をページ URL 基準で絶対化する', () => {
  const urls = extractImageCandidates(html, pageUrl).map((c) => c.url);
  // ページは /TIDE/pred2/cgi-bin/ 配下なので ../image/ は /TIDE/pred2/image/ になる
  assert.ok(urls.includes('https://www1.kaiho.mlit.go.jp/TIDE/pred2/image/header_logo.gif'));
});

test('Shift_JIS のページをデコードできる', () => {
  const sjis = Buffer.from([
    0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, // <html>
    0x92, 0xaa, 0x97, 0xac, // 潮流 (Shift_JIS)
  ]);
  const { text, charset } = decodeBody(sjis, 'text/html; charset=Shift_JIS');
  assert.equal(charset, 'shift_jis');
  assert.ok(text.includes('潮流'));
});

test('終了タグの無い option を読める（古い CGI 出力）', () => {
  const [select] = findElements(html, 'select').filter((s) => s.attrs.name === 'hh');
  const options = parseOptions(select.inner);
  assert.equal(options.length, 24);
  assert.equal(options[9].value, '09');
  assert.equal(options[9].selected, true);
});

test('1時間ずつずらすと日付をまたいでも正しい', () => {
  const start = { year: 2026, month: 12, day: 31, hour: 23 };
  assert.equal(formatTime(addHours(start, 1)), '2027-01-01 00:00');
  assert.equal(formatTime(addHours(start, 2)), '2027-01-01 01:00');
  assert.equal(formatTime(addHours({ year: 2026, month: 2, day: 28, hour: 22 }, 3)), '2026-03-01 01:00');
});

test('現在時刻（日本時間）を取得できる', () => {
  const now = nowInTokyo(new Date('2026-07-31T15:30:00Z')); // JST では 8/1 00:30
  assert.deepEqual(now, { year: 2026, month: 8, day: 1, hour: 0 });
});
