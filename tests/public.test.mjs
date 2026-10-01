// アクセス制限なし（公開）で動かしたときの振る舞い。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import test, { after, before } from 'node:test';

import { startStubUpstream } from './stub-upstream.mjs';

let stub;
let child;
let base;

function freePort() {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

before(async () => {
  stub = await startStubUpstream();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(port),
      TIDALSTREAM_PAGE_URL: stub.pageUrl,
      TIDALSTREAM_ALLOWED_HOSTS: '127.0.0.1',
      // 制限をすべて外した状態
      AUTH_USER: '',
      AUTH_PASS: '',
      ACCESS_TOKEN: '',
      TIDALSTREAM_DEBUG: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('サーバが起動しませんでした')), 10_000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('tidalstream')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`サーバが終了しました (code=${code})`));
    });
  });
});

after(async () => {
  child?.kill();
  await stub?.close();
});

test('鍵なしで画面が開く', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /潮流推算ビューア/);
});

test('確認用エンドポイントは閉じている（上流の生 HTML を外に出さない）', async () => {
  const response = await fetch(`${base}/api/debug?area=01`);
  assert.equal(response.status, 404);
});

// 公開すると、これらが上流を守る唯一の歯止めになる
test('公開でも日付の範囲は効く', async () => {
  const far = await fetch(`${base}/api/frames?area=01&date=2100-01-01&hour=9&count=3`);
  assert.equal(far.status, 400);
  assert.match((await far.json()).error, /前後 7 日/);
});

test('公開でも海域は東京湾だけ', async () => {
  const other = await fetch(`${base}/api/frames?area=03&count=3`);
  assert.equal(other.status, 400);
  assert.match((await other.json()).error, /東京湾/);
});

test('公開でも画像の中継から CGI は叩けない', async () => {
  const target = encodeURIComponent(`${stub.pageUrl}?area=05&yy=2099`);
  const response = await fetch(`${base}/api/image?u=${target}`);
  assert.equal(response.status, 403);
});

test('巡回は断ったまま', async () => {
  const response = await fetch(`${base}/robots.txt`);
  assert.equal((await response.text()).trim(), 'User-agent: *\nDisallow: /');
});
