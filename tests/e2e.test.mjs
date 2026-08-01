// 実サイトに触れずに、スタブ上流を相手に全体の流れを確認する。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import test, { after, before } from 'node:test';

import { startStubUpstream } from './stub-upstream.mjs';

let stub;
let frames;
let fetcher;

before(async () => {
  stub = await startStubUpstream();
  process.env.TIDALSTREAM_PAGE_URL = stub.pageUrl;
  process.env.TIDALSTREAM_ALLOWED_HOSTS = '127.0.0.1';
  // config は読み込み時に env を見るので、env を立ててから import する
  frames = await import('../src/frames.mjs');
  fetcher = await import('../src/fetcher.mjs');
});

after(async () => {
  await stub?.close();
});

test('1時間ごとに3枚ぶんの図を集められる', async () => {
  const result = await frames.collectFrames({
    area: '01',
    start: { year: 2026, month: 7, day: 31, hour: 9 },
    count: 3,
    stepHours: 1,
  });

  assert.equal(result.frames.length, 3);
  assert.deepEqual(
    result.frames.map((f) => f.label),
    ['2026-07-31 09:00', '2026-07-31 10:00', '2026-07-31 11:00'],
  );

  // 時刻ごとに別々の図が選ばれていること
  const images = result.frames.map((f) => f.imageUrl);
  assert.equal(new Set(images).size, 3);
  assert.ok(images[0].endsWith('curr_20260731090000.gif'));
  assert.ok(images[1].endsWith('curr_20260731100000.gif'));
  assert.ok(images[2].endsWith('curr_20260731110000.gif'));
  assert.ok(result.frames.every((f) => f.error === null));

  // 上流には推定したパラメータ名で時刻が渡っていること
  const hours = stub.requests
    .filter((r) => r.query.hh !== undefined)
    .map((r) => r.query.hh);
  assert.ok(hours.includes('09') && hours.includes('10') && hours.includes('11'));
});

test('日付をまたぐ並びも取得できる', async () => {
  const result = await frames.collectFrames({
    area: '01',
    start: { year: 2026, month: 7, day: 31, hour: 23 },
    count: 3,
  });
  assert.deepEqual(
    result.frames.map((f) => f.label),
    ['2026-07-31 23:00', '2026-08-01 00:00', '2026-08-01 01:00'],
  );
  assert.ok(result.frames[1].imageUrl.endsWith('curr_20260801000000.gif'));
});

test('画像取得では Referer を付ける', async () => {
  const before = stub.requests.length;
  const image = await fetcher.fetchImage(
    `http://127.0.0.1:${stub.port}/TIDE/pred2/img/curr_20260731090000.gif`,
    { referer: stub.pageUrl },
  );
  assert.equal(image.contentType, 'image/gif');
  assert.ok(image.buffer.length > 0);
  const imageRequest = stub.requests.slice(before).find((r) => r.path.endsWith('.gif'));
  assert.equal(imageRequest.headers.referer, stub.pageUrl);
});

test('許可外のホストは取りに行かない', async () => {
  await assert.rejects(() => fetcher.fetchImage('https://example.com/evil.gif'), /許可されていないホスト/);
  await assert.rejects(() => fetcher.fetchPage('file:///etc/passwd'), /許可されていないスキーム/);
});

test('同じ URL は再取得しない（キャッシュ）', async () => {
  const url = `http://127.0.0.1:${stub.port}/TIDE/pred2/img/curr_20260731090000.gif`;
  await fetcher.fetchImage(url, { referer: stub.pageUrl });
  const before = stub.requests.length;
  const second = await fetcher.fetchImage(url, { referer: stub.pageUrl });
  assert.equal(second.cached, 'memory');
  assert.equal(stub.requests.length, before);
});

test('HTTP エンドポイントが一通り動く', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(port),
      TIDALSTREAM_PAGE_URL: stub.pageUrl,
      TIDALSTREAM_ALLOWED_HOSTS: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForListening(child);
    const base = `http://127.0.0.1:${port}`;

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /潮流推算ビューア/);

    // 日付は今日を使う。固定の日付だと、日付範囲の制限（前後7日）に
    // いずれ引っかかってテストが壊れるため。
    const { year, month, day } = frames.nowInTokyo();
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${year}-${pad(month)}-${pad(day)}`;
    const api = await fetch(`${base}/api/frames?date=${today}&hour=9&count=3&step=1`);
    assert.equal(api.status, 200);
    const data = await api.json();
    assert.equal(data.frames.length, 3);
    assert.ok(data.frames[0].proxiedImageUrl.startsWith('/api/image?u='));

    const image = await fetch(base + data.frames[2].proxiedImageUrl);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/gif');

    // 開けていない海域は、上流に触らずに断る
    const areas = await (await fetch(`${base}/api/areas`)).json();
    assert.deepEqual(areas.areas.map((a) => a.code), ['01']);
    const upstreamBefore = stub.requests.length;
    const otherArea = await fetch(`${base}/api/frames?area=03&date=${today}&hour=9&count=3`);
    assert.equal(otherArea.status, 400);
    assert.match((await otherArea.json()).error, /東京湾/);
    assert.equal(stub.requests.length, upstreamBefore);
    const otherSeries = await fetch(`${base}/api/series?area=03&date=${today}&hour=9&x=190&y=395`);
    assert.equal(otherSeries.status, 400);

    const blocked = await fetch(`${base}/api/image?u=${encodeURIComponent('https://example.com/x.gif')}`);
    assert.equal(blocked.status, 403);

    const missing = await fetch(`${base}/nope.js`);
    assert.equal(missing.status, 404);
  } finally {
    child.kill();
  }
});

function freePort() {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function waitForListening(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('サーバが起動しませんでした')), 10_000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('tidalstream')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`サーバが終了しました (code=${code})`));
    });
  });
}
