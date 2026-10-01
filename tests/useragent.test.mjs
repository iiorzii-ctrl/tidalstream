// 上流へ名乗る User-Agent。連絡先が辿れる形で実際に送られているかを見る。
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { startStubUpstream } from './stub-upstream.mjs';

let stub;
let fetcher;
let config;

before(async () => {
  stub = await startStubUpstream();
  process.env.TIDALSTREAM_PAGE_URL = stub.pageUrl;
  process.env.TIDALSTREAM_ALLOWED_HOSTS = '127.0.0.1';
  config = await import('../src/config.mjs');
  fetcher = await import('../src/fetcher.mjs');
});

after(async () => {
  await stub?.close();
});

test('連絡先として辿れる URL を名乗っている', () => {
  assert.match(config.USER_AGENT, /^tidalstream\/\d/);
  assert.match(config.USER_AGENT, /\+https:\/\/github\.com\/[\w-]+\/[\w-]+/);
  // 以前の仮置きのまま公開してしまわないように
  assert.doesNotMatch(config.USER_AGENT, /repository owner/);
});

test('ページの取得で実際に送っている', async () => {
  const before = stub.requests.length;
  await fetcher.fetchPage(`${stub.pageUrl}?area=01&yy=2026&mm=10&dd=1&hh=09`);
  const request = stub.requests.slice(before).at(-1);
  assert.equal(request.headers['user-agent'], config.USER_AGENT);
});

test('画像の取得でも送っている', async () => {
  const before = stub.requests.length;
  await fetcher.fetchImage(`http://127.0.0.1:${stub.port}/TIDE/pred2/img/ua_check.gif`, {
    referer: stub.pageUrl,
  });
  const request = stub.requests.slice(before).at(-1);
  assert.equal(request.headers['user-agent'], config.USER_AGENT);
});
