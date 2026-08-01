// 実サイト (www1.kaiho.mlit.go.jp) の応答をそのまま保存したものに対する回帰テスト。
// ネットワークには接続しない。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { PAGE_URL } from '../src/config.mjs';
import { buildPageUrl, discoverForm, extractAreaLabel, extractImageCandidates } from '../src/scraper.mjs';

const html = await readFile(new URL('./fixtures/real-page.html', import.meta.url), 'utf8');
const pageUrl = `${PAGE_URL}?area=01&year=2026&month=8&day=1&hour=9`;

test('document.write の中に書かれたフォームを読める', () => {
  const form = discoverForm(html);
  assert.deepEqual(form.roles, {
    area: 'area',
    year: 'year',
    month: 'month',
    day: 'day',
    hour: 'hour',
  });
});

test('エスケープされた属性値を正しく取り出す（value=\\"01\\" → 01）', () => {
  const form = discoverForm(html);
  const area = form.fields.find((f) => f.name === 'area');
  assert.equal(area.value, '01'); // バックスラッシュが混ざっていないこと
  assert.equal(area.kind, 'hidden');
});

test('submit ボタンをフィールドとして拾わない', () => {
  const form = discoverForm(html);
  assert.deepEqual(
    form.fields.map((f) => f.name),
    ['area', 'year', 'month', 'day', 'hour'],
  );
});

test('組み立てた URL がページ自身の「1時間後」ボタンと一致する', () => {
  const form = discoverForm(html);
  // ページ内の OnClick は次の URL を指している:
  //   CurrPredCgi_K.cgi?area=01&year=2026&month=8&day=1&hour=10
  const built = buildPageUrl({ form, area: '01', year: 2026, month: 8, day: 1, hour: 10, baseUrl: PAGE_URL });
  const url = new URL(built);
  assert.equal(url.pathname, '/TIDE/pred2/cgi-bin/CurrPredCgi_K.cgi');
  assert.equal(url.search, '?area=01&year=2026&month=8&day=1&hour=10');
});

test('実ページに無いパラメータ（min など）を付け足さない', () => {
  const form = discoverForm(html);
  const url = new URL(buildPageUrl({ form, area: '01', year: 2026, month: 8, day: 1, hour: 10 }));
  assert.equal(url.searchParams.has('min'), false);
});

test('潮流図の PNG を候補として取り出す', () => {
  const candidates = extractImageCandidates(html, pageUrl);
  assert.equal(
    candidates[0].url,
    'https://www1.kaiho.mlit.go.jp/TIDE/pred2/CurrPred/curr_img/01_2026080109_.png',
  );
});

test('背景画像（kabegami）を潮流図と間違えない', () => {
  const candidates = extractImageCandidates(html, pageUrl);
  assert.ok(!candidates.some((c) => c.url.includes('kabegami')));
});

test('海域名をページから拾える', () => {
  assert.equal(extractAreaLabel(html), '東京湾');
});
