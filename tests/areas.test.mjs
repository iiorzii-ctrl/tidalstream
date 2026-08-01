// 海域の絞り込み。既定では東京湾だけを開ける。ネットワークには接続しない。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { ALL_AREAS, AREAS, DEFAULTS, areaMessage, isAreaAllowed } from '../src/config.mjs';

/** 別プロセスで env を変えて読み込み直し、選べる海域コードを返す */
function areaCodesWith(allowedAreas) {
  const script = "import('./src/config.mjs').then(m => console.log(m.AREAS.map(a => a.code).join(',')))";
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, ALLOWED_AREAS: allowedAreas },
    encoding: 'utf8',
  });
  return out.trim();
}

test('既定では東京湾だけ', () => {
  assert.deepEqual(
    AREAS.map((a) => a.code),
    ['01'],
  );
  assert.equal(AREAS[0].name, '東京湾');
  assert.equal(DEFAULTS.area, '01');
});

test('開けていない海域は許さない', () => {
  assert.equal(isAreaAllowed('01'), true);
  assert.equal(isAreaAllowed('03'), false);
  assert.equal(isAreaAllowed('99'), false);
  assert.equal(isAreaAllowed(''), false);
  assert.equal(isAreaAllowed(undefined), false);
});

test('元の一覧は残っていて、増やせる状態にしてある', () => {
  assert.equal(ALL_AREAS.length, 20);
  assert.ok(ALL_AREAS.some((a) => a.code === '03'));
});

test('ALLOWED_AREAS で増やせる', () => {
  assert.equal(areaCodesWith('01,02'), '01,02');
  assert.equal(areaCodesWith('03'), '03');
  assert.equal(areaCodesWith(' 01 , 04 '), '01,04');
});

test('綴り間違いで空になっても、最低ひとつは残す', () => {
  assert.equal(areaCodesWith('zzz'), '01');
  assert.equal(areaCodesWith(''), '01');
});

test('断り文句に海域名が入る', () => {
  assert.match(areaMessage(), /01 東京湾/);
});
