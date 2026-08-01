// 秘密のリンク（ACCESS_TOKEN）での出入りを、実際にサーバを立てて確認する。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import test, { after, before } from 'node:test';

import { startStubUpstream } from './stub-upstream.mjs';

const TOKEN = 'test-secret-token-1234567890';
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
      ACCESS_TOKEN: TOKEN,
      AUTH_USER: '',
      AUTH_PASS: '',
      RATE_LIMIT_PER_MIN: '1000',
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

test('鍵が無ければ入れない', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 401);
});

test('秘密のリンクだと認証ダイアログを出さない', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.headers.get('www-authenticate'), null);
});

test('間違った鍵では入れない', async () => {
  const response = await fetch(`${base}/?k=wrong-token`);
  assert.equal(response.status, 401);
});

test('正しい鍵で開くと Cookie が発行され、鍵の無い URL へ送られる', async () => {
  const response = await fetch(`${base}/?k=${TOKEN}`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  const cookie = response.headers.get('set-cookie') ?? '';
  assert.match(cookie, /tidalstream_key=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  // 鍵が URL に残り続けないようにする
  assert.equal(response.headers.get('location'), '/');
});

test('Cookie があれば以後は鍵なしで使える', async () => {
  const cookie = `tidalstream_key=${encodeURIComponent(TOKEN)}`;
  const page = await fetch(`${base}/`, { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /潮流推算ビューア/);

  const api = await fetch(`${base}/api/areas`, { headers: { cookie } });
  assert.equal(api.status, 200);
});

test('偽の Cookie では入れない', async () => {
  const response = await fetch(`${base}/`, { headers: { cookie: 'tidalstream_key=nope' } });
  assert.equal(response.status, 401);
});

test('robots.txt は鍵なしで読めて、巡回を断っている', async () => {
  const response = await fetch(`${base}/robots.txt`);
  assert.equal(response.status, 200);
  assert.equal((await response.text()).trim(), 'User-agent: *\nDisallow: /');
});

test('死活監視は鍵なしで通る', async () => {
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
});

test('遠い日付は断る', async () => {
  const cookie = `tidalstream_key=${encodeURIComponent(TOKEN)}`;
  const far = await fetch(`${base}/api/frames?area=01&date=2100-01-01&hour=9&count=3`, { headers: { cookie } });
  assert.equal(far.status, 400);
  assert.match((await far.json()).error, /前後 7 日/);

  const series = await fetch(`${base}/api/series?area=01&date=2100-01-01&hour=9&x=190&y=395`, { headers: { cookie } });
  assert.equal(series.status, 400);
});
