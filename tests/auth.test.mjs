// 認証はプロセス起動時の環境変数で決まるので、子プロセスを立てて確認する。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import test, { after, before } from 'node:test';

import { startStubUpstream } from './stub-upstream.mjs';

const CREDENTIALS = { user: 'tide', pass: 'p@ss:word' }; // パスワードに ':' を含めて試す
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

function waitForListening(process_) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('サーバが起動しませんでした')), 10_000);
    process_.stdout.on('data', (chunk) => {
      if (String(chunk).includes('tidalstream')) {
        clearTimeout(timer);
        resolve();
      }
    });
    process_.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`サーバが終了しました (code=${code})`));
    });
  });
}

const authHeader = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

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
      AUTH_USER: CREDENTIALS.user,
      AUTH_PASS: CREDENTIALS.pass,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForListening(child);
});

after(async () => {
  child?.kill();
  await stub?.close();
});

test('認証情報が無いと 401 を返す', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate') ?? '', /^Basic realm=/);
});

test('間違ったパスワードでは通さない', async () => {
  const response = await fetch(`${base}/`, {
    headers: { authorization: authHeader(CREDENTIALS.user, 'wrong') },
  });
  assert.equal(response.status, 401);
});

test('利用者名が違っても通さない', async () => {
  const response = await fetch(`${base}/`, {
    headers: { authorization: authHeader('someone', CREDENTIALS.pass) },
  });
  assert.equal(response.status, 401);
});

test('正しい認証情報なら画面を返す', async () => {
  const response = await fetch(`${base}/`, {
    headers: { authorization: authHeader(CREDENTIALS.user, CREDENTIALS.pass) },
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /潮流推算ビューア/);
});

test('API も認証の対象になる', async () => {
  assert.equal((await fetch(`${base}/api/areas`)).status, 401);
  const allowed = await fetch(`${base}/api/areas`, {
    headers: { authorization: authHeader(CREDENTIALS.user, CREDENTIALS.pass) },
  });
  assert.equal(allowed.status, 200);
});

test('死活監視だけは認証なしで通る', async () => {
  const response = await fetch(`${base}/healthz`);
  assert.equal(response.status, 200);
  assert.equal((await response.text()).trim(), 'ok');
});

test('壊れた Authorization ヘッダで落ちない', async () => {
  for (const value of ['Basic', 'Basic !!!!', 'Bearer abc', 'Basic ' + Buffer.from('nocolon').toString('base64')]) {
    const response = await fetch(`${base}/`, { headers: { authorization: value } });
    assert.equal(response.status, 401, `値: ${value}`);
  }
});
