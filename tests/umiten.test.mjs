// 港湾気象予報サイトの取得まわり。実サイトには触れず、スタブを相手に確認する。
//
// 見ているのは主に「資格情報をどこへ送るか」で、次の3点が要点。
//   1. 設定したディレクトリの配下にだけ送る
//   2. 応答に秘密の URL・資格情報を混ぜない
//   3. 設定が無いときは機能ごと止まる（起動は妨げない）
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { STUB_PASS, STUB_USER, basicHeader, startStubUmiten } from './stub-umiten.mjs';

let stub;
let umiten;

before(async () => {
  stub = await startStubUmiten();
  process.env.UMITEN_INDEX_URL = stub.indexUrl;
  process.env.UMITEN_USER = STUB_USER;
  process.env.UMITEN_PASS = STUB_PASS;
  umiten = await import('../src/umiten.mjs');
});

after(async () => {
  await stub?.close();
});

test('設定が揃っていれば有効になり、秘密の範囲を読み取る', () => {
  const config = umiten.umitenConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.host, '127.0.0.1');
  assert.match(config.dirPrefix, /^\/C0000_stubsecretdir\/$/);
});

test('設定が欠けていれば無効になり、足りない変数名を伝える', () => {
  const saved = process.env.UMITEN_PASS;
  delete process.env.UMITEN_PASS;
  try {
    const config = umiten.umitenConfig();
    assert.equal(config.enabled, false);
    assert.match(config.reason, /UMITEN_PASS/);
  } finally {
    process.env.UMITEN_PASS = saved;
  }
});

test('Basic 認証を付けてページを取得する', async () => {
  const page = await umiten.fetchUmitenPage(stub.indexUrl);
  assert.match(page.html, /東京湾 港湾気象予報/);

  const request = stub.requests.at(-1);
  assert.equal(request.headers.authorization, basicHeader(STUB_USER, STUB_PASS));
});

test('相対リンクは設定した URL から解決する', () => {
  const url = umiten.assertUmitenUrl('point_yokohama.html');
  assert.equal(url.toString(), `http://127.0.0.1:${stub.port}/C0000_stubsecretdir/point_yokohama.html`);
});

test('ディレクトリの外と別ホストには資格情報を送らない', () => {
  const outside = [
    '/elsewhere/other.html', // 同じホストでも契約者ディレクトリの外
    '../other/index.html', // 相対で外に出るもの
    'https://example.com/', // 別のホスト
    'http://127.0.0.1:1/C0000_stubsecretdir/index.html', // ポート違い（生成元が違う）
  ];
  for (const target of outside) {
    assert.throws(() => umiten.assertUmitenUrl(target), /範囲外/, target);
  }
});

test('リンクの一覧は、範囲内かどうかを区別して返す', async () => {
  const page = await umiten.fetchUmitenPage(stub.indexUrl);
  const links = umiten.extractLinks(page.html, page.url);

  const within = links.filter((l) => l.within);
  assert.deepEqual(
    within.map((l) => l.text),
    ['横浜', '千葉'],
  );
  assert.deepEqual(
    links.filter((l) => !l.within).map((l) => l.text),
    ['範囲外のページ', '外部サイト'],
  );
});

test('資格情報が違えば、その旨を秘密を出さずに伝える', async () => {
  const saved = process.env.UMITEN_PASS;
  process.env.UMITEN_PASS = 'wrong-password';
  try {
    await assert.rejects(
      () => umiten.fetchUmitenPage(`${stub.indexUrl}?retry=1`),
      (error) => {
        assert.match(error.message, /UMITEN_USER \/ UMITEN_PASS/);
        assert.doesNotMatch(error.message, /stubsecretdir/);
        assert.doesNotMatch(error.message, /wrong-password/);
        return true;
      },
    );
  } finally {
    process.env.UMITEN_PASS = saved;
  }
});

test('秘密のディレクトリ名と資格情報は伏せ字にできる', () => {
  const text = `http://127.0.0.1/C0000_stubsecretdir/index.html を ${STUB_USER}:${STUB_PASS} で取得`;
  const redacted = umiten.redactSecrets(text);
  assert.doesNotMatch(redacted, /stubsecretdir/);
  assert.doesNotMatch(redacted, new RegExp(STUB_PASS));
  assert.match(redacted, /\*\*\*/);
});
