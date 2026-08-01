// 永続キャッシュの確認。実サイトには接続せず、スタブ上流へのリクエスト数を数える。
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';

import { startStubUpstream } from './stub-upstream.mjs';

let stub;
let cacheDir;
let fetcher;
let frames;
let diskcache;

before(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'tidalstream-cache-'));
  stub = await startStubUpstream();
  process.env.TIDALSTREAM_CACHE_DIR = cacheDir;
  process.env.TIDALSTREAM_PAGE_URL = stub.pageUrl;
  process.env.TIDALSTREAM_ALLOWED_HOSTS = '127.0.0.1';
  // 設定は読み込み時に env を見るので、env を立ててから import する
  fetcher = await import('../src/fetcher.mjs');
  frames = await import('../src/frames.mjs');
  diskcache = await import('../src/diskcache.mjs');
});

after(async () => {
  await stub?.close();
  await rm(cacheDir, { recursive: true, force: true });
});

test('日時つきの URL は保存対象と判定する', () => {
  const { looksDeterministic } = diskcache;
  assert.equal(looksDeterministic('http://x/cgi?area=01&year=2026&month=8&day=1&hour=9'), true);
  assert.equal(looksDeterministic('http://x/curr_img/01_2026080109_.png'), true);
  assert.equal(looksDeterministic('http://x/cgi?area=01'), false); // 日時なしの基準ページ
  assert.equal(looksDeterministic('http://x/cgi?area=01&year=2026'), false); // 時刻がない
});

test('同じ画面をもう一度開いても上流に行かない（メモリキャッシュ）', async () => {
  const options = { area: '01', start: { year: 2026, month: 7, day: 31, hour: 9 }, count: 3 };
  const first = await frames.collectFrames(options);
  assert.equal(first.frames.length, 3);
  const afterFirst = stub.requests.length;
  assert.ok(afterFirst > 0);

  await frames.collectFrames(options);
  assert.equal(stub.requests.length, afterFirst);
});

test('プロセスを起動し直しても、日時つきページはディスクから返る', async () => {
  const url = `${stub.pageUrl}?area=01&year=2026&month=7&day=31&hour=11`;
  await fetcher.fetchPage(url, { persist: true });
  const afterFirst = stub.requests.length;

  // fetcher 自体を読み直すとメモリキャッシュは空になる（＝再起動と同じ状態）
  const restarted = await import(`../src/fetcher.mjs?restart=${Date.now()}`);
  const page = await restarted.fetchPage(url, { persist: true });

  assert.equal(page.cached, 'disk');
  assert.equal(stub.requests.length, afterFirst, '上流へのリクエストが増えていないこと');
  assert.match(page.html, /CurrPredCgi_K\.cgi/);
});

test('画像も再起動後にディスクから返る', async () => {
  const url = `http://127.0.0.1:${stub.port}/TIDE/pred2/img/curr_20260731090000.gif`;
  const first = await fetcher.fetchImage(url, { referer: stub.pageUrl });
  const afterFirst = stub.requests.length;

  const restarted = await import(`../src/fetcher.mjs?restart=img${Date.now()}`);
  const again = await restarted.fetchImage(url, { referer: stub.pageUrl });

  assert.equal(again.cached, 'disk');
  assert.equal(stub.requests.length, afterFirst);
  assert.deepEqual(again.buffer, first.buffer);
});

test('保存された内容が元と一致する', async () => {
  const url = `${stub.pageUrl}?area=01&year=2026&month=7&day=31&hour=9`;
  const fresh = await fetcher.fetchPage(url, { persist: true });
  const stored = await diskcache.readCache('pages', url);
  assert.ok(stored, 'ディスクに保存されていること');
  assert.equal(stored.body.toString('utf8'), fresh.html);
});

test('日時のないページはディスクに保存しない', async () => {
  const url = `${stub.pageUrl}?area=01`;
  await fetcher.fetchPage(url, { persist: true });
  assert.equal(await diskcache.readCache('pages', url), null);
});

test('壊れたキャッシュがあっても取得し直して動く', async () => {
  const url = `${stub.pageUrl}?area=01&year=2026&month=7&day=31&hour=15`;
  await fetcher.fetchPage(url, { persist: true });

  // 保存済みのメタ情報を壊す
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.json')) files.push(full);
    }
  };
  await walk(join(cacheDir, 'pages'));
  for (const file of files) await writeFile(file, '{壊れた JSON');

  const reloaded = await import(`../src/fetcher.mjs?reload=${Date.now()}`);
  const page = await reloaded.fetchPage(url, { persist: true });
  assert.match(page.html, /CurrPredCgi_K\.cgi/);
});

test('上限を超えたら古いものから捨てる', async () => {
  const before = await diskcache.cacheStats();
  assert.ok(before.entries > 0);
  const result = await diskcache.pruneCache(1); // 1 バイト上限にして全部捨てさせる
  assert.ok(result.removed > 0);
  const after = await diskcache.cacheStats();
  assert.ok(after.entries < before.entries, `${before.entries} → ${after.entries}`);
});
