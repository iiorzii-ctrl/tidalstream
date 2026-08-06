#!/usr/bin/env node
// 港湾気象予報サイト（海天 港湾版）の構造を確認するための調査スクリプト。
//
// このサイトは契約者専用で、開発環境から届かないことがあります。実際に見える
// ネットワークでこれを実行し、出力を見ながら取り込み処理を合わせてください。
//
//   UMITEN_INDEX_URL=https://.../index.html \
//   UMITEN_USER=... UMITEN_PASS=... \
//   node scripts/inspect-umiten.mjs [ページのURL]
//
// 秘密のディレクトリ名は伏せ字にして出しますが、--raw を付けると HTML を
// そのまま保存できます（fixture として使う場合）。
//
//   node scripts/inspect-umiten.mjs --raw > page.html

import { extractLinks, fetchUmitenPage, redactSecrets, requireUmiten } from '../src/umiten.mjs';
import { findElements, findTags, stripTags } from '../src/html.mjs';

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const target = args.find((a) => !a.startsWith('--'));

let config;
let page;
try {
  config = requireUmiten();
  page = await fetchUmitenPage(target ?? config.indexUrl, { config });
} catch (error) {
  // 設定漏れや認証の失敗は、使う側にとっては入力の誤りなので短く伝える
  console.error(`失敗: ${error?.message ?? error}`);
  process.exit(1);
}

if (raw) {
  // fixture 用。そのまま出す（秘密の URL が含まれる点に注意）
  process.stdout.write(page.html);
  process.exit(0);
}

const show = (text) => console.log(redactSecrets(text, config));

show(`取得: ${page.url}`);
console.log(`文字コード: ${page.charset}`);
console.log(`HTML 長: ${page.html.length}`);
console.log(`title: ${stripTags(findElements(page.html, 'title')[0]?.inner ?? '(なし)')}`);

console.log('\n--- リンク（範囲内のもの） ---');
const links = extractLinks(page.html, page.url, config);
for (const link of links.filter((l) => l.within)) {
  show(`  ${link.text || '(文字なし)'}  →  ${link.href}`);
}

const outside = links.filter((l) => !l.within);
if (outside.length > 0) {
  console.log(`\n--- リンク（範囲外。資格情報を送らないもの）${outside.length} 件 ---`);
  for (const link of outside.slice(0, 20)) show(`  ${link.text || '(文字なし)'}  →  ${link.url}`);
}

console.log('\n--- frame / iframe ---');
for (const tag of [...findTags(page.html, 'frame'), ...findTags(page.html, 'iframe')]) {
  show(`  ${tag.source.slice(0, 200)}`);
}

console.log('\n--- 表 ---');
const tables = findElements(page.html, 'table');
console.log(`表の数: ${tables.length}`);
tables.forEach((table, i) => {
  const rows = findElements(table.inner, 'tr');
  console.log(`\n  [表 ${i}] 行数 ${rows.length}`);
  for (const row of rows.slice(0, 6)) {
    const cells = [...findElements(row.inner, 'th'), ...findElements(row.inner, 'td')]
      .sort((a, b) => a.index - b.index)
      .map((cell) => stripTags(cell.inner));
    show(`    ${cells.join(' | ').slice(0, 200)}`);
  }
  if (rows.length > 6) console.log(`    …(残り ${rows.length - 6} 行)`);
});

console.log('\n--- 画像 ---');
for (const img of findTags(page.html, 'img')) show(`  ${img.attrs.src ?? ''}  (alt: ${img.attrs.alt ?? ''})`);

console.log('\n--- script の src と、JSON らしき埋め込み ---');
for (const script of findElements(page.html, 'script')) {
  if (script.attrs.src) show(`  src: ${script.attrs.src}`);
  else if (/\{|\[/.test(script.inner)) show(`  inline(${script.inner.length}文字): ${script.inner.trim().slice(0, 300)}`);
}

console.log('\n--- 本文の冒頭 ---');
show(stripTags(page.html).slice(0, 1200));
