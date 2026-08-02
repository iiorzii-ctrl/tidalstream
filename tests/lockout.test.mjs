// パスワードの総当たり対策。実際にサーバを立てて、締め出しの動きを確認する。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import test, { after, before } from 'node:test';

import { startStubUpstream } from './stub-upstream.mjs';

const USER = 'tokyobay';
const PASS = 'correct-horse-1234';
const MAX = 3; // テストを短くするため、既定の5回より小さくする
let stub;
let child;
let base;

const authHeader = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
const good = { authorization: authHeader(USER, PASS) };
/** 総当たりを模す。毎回ちがうパスワードを出す。 */
const guess = (n) => ({ authorization: authHeader(USER, `guess-${n}`) });

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
      AUTH_USER: USER,
      AUTH_PASS: PASS,
      MAX_AUTH_FAILURES: String(MAX),
      AUTH_LOCK_MINUTES: '15',
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

// 相手ごとに数えるので、テストごとに違う住所を名乗って独立させる。
// Render のような逆プロキシ配下では x-forwarded-for が相手の住所になる。
const from = (ip, headers = {}) => ({ 'x-forwarded-for': ip, ...headers });

test('鍵を出さない401は回数に数えない（普通に開いただけで締め出さない）', async () => {
  const ip = '198.51.100.1';
  for (let i = 0; i < MAX + 3; i += 1) {
    const response = await fetch(base, { headers: from(ip) });
    assert.equal(response.status, 401, `${i + 1}回目`);
    assert.match(response.headers.get('www-authenticate') ?? '', /^Basic realm=/);
  }
  // 締め出されていないので、正しい鍵ならそのまま入れる
  assert.equal((await fetch(base, { headers: from(ip, good) })).status, 200);
});

test('違う鍵を出しつづけると締め出す', async () => {
  const ip = '198.51.100.2';
  for (let i = 0; i < MAX; i += 1) {
    assert.equal((await fetch(base, { headers: from(ip, guess(i)) })).status, 401, `${i + 1}回目`);
  }
  const locked = await fetch(base, { headers: from(ip, guess(99)) });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
  assert.match(await locked.text(), /分ほどアクセスを止めています/);
});

// これが無いと、締め出し中でも「正解だけ 200」になり、総当たりを止められない
test('締め出し中は正しい鍵でも通さない（当たりが分からないようにする）', async () => {
  const ip = '198.51.100.3';
  for (let i = 0; i < MAX; i += 1) await fetch(base, { headers: from(ip, guess(i)) });
  assert.equal((await fetch(base, { headers: from(ip, good) })).status, 429);
});

// ブラウザに古いパスワードが保存されていると、1ページ開くだけで同じ間違いが
// 何度も飛ぶ。これを回数で数えると、ただの保存忘れで職場ごと締め出してしまう。
test('同じ間違いの繰り返しは1回ぶんとしか数えない', async () => {
  const ip = '198.51.100.8';
  const stale = { authorization: authHeader(USER, 'pilot') }; // 変更前の古いパスワード
  for (let i = 0; i < MAX * 4; i += 1) {
    assert.equal((await fetch(base, { headers: from(ip, stale) })).status, 401, `${i + 1}回目`);
  }
  // 締め出されていないので、正しいパスワードを入れ直せばすぐ入れる
  assert.equal((await fetch(base, { headers: from(ip, good) })).status, 200);
});

test('締め出しは相手ごとで、他の人は巻き添えにならない', async () => {
  const attacker = '198.51.100.4';
  for (let i = 0; i < MAX; i += 1) await fetch(base, { headers: from(attacker, guess(i)) });
  assert.equal((await fetch(base, { headers: from(attacker, guess(99)) })).status, 429);
  // 別の住所の同僚はふつうに使える
  assert.equal((await fetch(base, { headers: from('203.0.113.9', good) })).status, 200);
});

test('上限に届く前に入れれば、失敗の記録は消える', async () => {
  const ip = '198.51.100.5';
  for (let i = 0; i < MAX - 1; i += 1) await fetch(base, { headers: from(ip, guess(i)) });
  assert.equal((await fetch(base, { headers: from(ip, good) })).status, 200);
  // 記録が消えているので、また上限ぶんの猶予がある
  for (let i = 0; i < MAX - 1; i += 1) {
    assert.equal((await fetch(base, { headers: from(ip, guess(50 + i)) })).status, 401, `${i + 1}回目`);
  }
  assert.equal((await fetch(base, { headers: from(ip, good) })).status, 200);
});

test('API も締め出しの対象になる', async () => {
  const ip = '198.51.100.6';
  for (let i = 0; i < MAX; i += 1) await fetch(`${base}/api/areas`, { headers: from(ip, guess(i)) });
  assert.equal((await fetch(`${base}/api/areas`, { headers: from(ip, guess(99)) })).status, 429);
});

test('死活監視は締め出しの影響を受けない', async () => {
  const ip = '198.51.100.7';
  for (let i = 0; i < MAX + 1; i += 1) await fetch(base, { headers: from(ip, guess(i)) });
  assert.equal((await fetch(`${base}/healthz`, { headers: from(ip) })).status, 200);
});
