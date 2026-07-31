#!/usr/bin/env node
// 上流ページの実際の構造を確認するための調査スクリプト。
// 自動判定が外れたときは、この出力を見て src/config.mjs のヒントを直す。
//
//   node scripts/inspect.mjs [area]

import { DEFAULTS, PAGE_URL } from '../src/config.mjs';
import { fetchPage } from '../src/fetcher.mjs';
import { buildPageUrl, discoverForm, extractImageCandidates } from '../src/scraper.mjs';

const area = process.argv[2] ?? DEFAULTS.area;
const pageUrl = buildPageUrl({ form: null, area, baseUrl: PAGE_URL });

console.log(`取得: ${pageUrl}\n`);

const page = await fetchPage(pageUrl);
console.log(`文字コード: ${page.charset}`);
console.log(`HTML 長: ${page.html.length}\n`);

const form = discoverForm(page.html);
console.log(`フォーム数: ${form.formCount}`);
console.log(`action: ${form.action ?? '(なし)'} / method: ${form.method}`);
console.log('\n--- 判定した役割 ---');
console.table(form.roles);

console.log('\n--- 見つかったフィールド ---');
for (const field of form.fields) {
  const sample = field.options
    ? field.options.slice(0, 5).map((o) => o.value).join(', ') +
      (field.options.length > 5 ? `, …(全${field.options.length}件)` : '')
    : '(選択肢なし)';
  console.log(`  ${field.name} [${field.kind}] = ${field.value}  :: ${sample}`);
}

console.log('\n--- 画像候補（スコア順） ---');
for (const image of extractImageCandidates(page.html, page.url)) {
  console.log(`  ${String(image.score).padStart(4)}  ${image.url}  ${image.alt ? `(alt: ${image.alt})` : ''}`);
}

console.log('\n--- 1時間後の URL の組み立て結果 ---');
const now = new Date();
console.log(
  buildPageUrl({
    form,
    area,
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
    hour: (now.getUTCHours() + 10) % 24,
    baseUrl: PAGE_URL,
  }),
);
