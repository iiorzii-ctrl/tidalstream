// ディスク上の永続キャッシュ。
//
// 潮流推算は天文計算なので、同じ (海域, 日時) の結果は永久に変わらない
// （実際に、時間を空けて取得しても41地点すべての値が一致することを確認済み）。
// そのため日時を明示したページと、ファイル名に日時を含む画像は、
// 期限を設けずに保存してよい。これにより同じ日時は生涯で1回しか取りに行かない。
//
// 一方、日時を指定しない基準ページは「現在時刻」が初期値として入るため、
// 保存の対象にしない。判断は呼び出し側が persist で指示する。

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = fileURLToPath(new URL('../.cache/', import.meta.url));

export const CACHE_DIR = process.env.TIDALSTREAM_CACHE_DIR ?? DEFAULT_DIR;
export const CACHE_ENABLED = process.env.TIDALSTREAM_NO_DISK_CACHE !== '1';
export const CACHE_MAX_BYTES = Number(process.env.TIDALSTREAM_CACHE_MAX_MB ?? 200) * 1024 * 1024;

/** 保存してよいかどうか。日時らしい数字の並びを含む URL だけを対象にする */
export function looksDeterministic(url) {
  const text = String(url);
  // 画像は curr_img/01_2026080109_.png のように日時が入る
  if (/\d{8,}/.test(text)) return true;
  // ページは year/month/day/hour などが明示されている
  const params = new URL(text, 'https://example.invalid').searchParams;
  const names = [...params.keys()].join(',').toLowerCase();
  const hasYear = /(^|,)(y|yy|yyyy|year|nen)(,|$)/.test(names);
  const hasHour = /(^|,)(h|hh|hour|hr|ji|jikan|time)(,|$)/.test(names);
  return hasYear && hasHour;
}

function pathFor(kind, url) {
  const hash = createHash('sha256').update(url).digest('hex');
  return join(CACHE_DIR, kind, `${hash.slice(0, 2)}`, hash);
}

let writeCount = 0;

export async function readCache(kind, url) {
  if (!CACHE_ENABLED) return null;
  const file = pathFor(kind, url);
  try {
    const [meta, body] = await Promise.all([readFile(`${file}.json`, 'utf8'), readFile(file)]);
    const parsed = JSON.parse(meta);
    if (parsed.url !== url) return null; // ハッシュ衝突などの保険
    return { ...parsed, body };
  } catch {
    // 未保存・壊れている・読めない場合は取得し直せばよい
    return null;
  }
}

export async function writeCache(kind, url, { body, contentType, charset }) {
  if (!CACHE_ENABLED) return false;
  const file = pathFor(kind, url);
  try {
    await mkdir(join(file, '..'), { recursive: true });
    // 途中で落ちた中身を読まないよう、一時ファイルに書いてから差し替える
    const temporary = `${file}.tmp${process.pid}`;
    await writeFile(temporary, body);
    await writeFile(`${file}.json`, JSON.stringify({ url, contentType, charset, savedAt: Date.now() }));
    const { rename } = await import('node:fs/promises');
    await rename(temporary, file);
  } catch {
    return false; // 書けなくても動作は続ける
  }

  writeCount += 1;
  if (writeCount % 50 === 0) await pruneCache().catch(() => {});
  return true;
}

async function listFiles(directory) {
  const out = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else if (!entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

export async function cacheStats() {
  const files = await listFiles(CACHE_DIR);
  let bytes = 0;
  for (const file of files) {
    try {
      bytes += (await stat(file)).size;
    } catch {
      /* 消えていても無視 */
    }
  }
  return { entries: files.length, bytes };
}

/** 上限を超えたら古いものから捨てる */
export async function pruneCache(maxBytes = CACHE_MAX_BYTES) {
  const files = await listFiles(CACHE_DIR);
  const withTime = [];
  let total = 0;
  for (const file of files) {
    try {
      const info = await stat(file);
      total += info.size;
      withTime.push({ file, size: info.size, mtime: info.mtimeMs });
    } catch {
      /* 無視 */
    }
  }
  if (total <= maxBytes) return { removed: 0, bytes: total };

  withTime.sort((a, b) => a.mtime - b.mtime); // 古い順
  let removed = 0;
  for (const entry of withTime) {
    if (total <= maxBytes) break;
    await rm(entry.file, { force: true });
    await rm(`${entry.file}.json`, { force: true });
    total -= entry.size;
    removed += 1;
  }
  return { removed, bytes: total };
}
