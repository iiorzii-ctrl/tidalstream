// 待ち受けアドレスの決め方。環境変数の設定漏れでデプロイが失敗しないこと。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

/** 指定した環境変数だけでサーバを起動し、1行目の案内を読む */
function startupLine(env) {
  const script = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['server.mjs'], {
      env: { PATH: process.env.PATH, ...${JSON.stringify(env)} },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    child.stdout.once('data', (chunk) => {
      process.stdout.write(String(chunk).split('\\n')[0]);
      child.kill();
      process.exit(0);
    });
    setTimeout(() => { child.kill(); process.exit(1); }, 10000);
  `;
  return execFileSync(process.execPath, ['-e', script], {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf8',
  }).trim();
}

test('実行環境の上では 0.0.0.0 で待ち受ける', () => {
  // RENDER は Render が自動で入れる変数。HOST の設定漏れでポートが見つからず、
  // 時間切れでデプロイが失敗するのを避けるため、こちらを既定にする。
  assert.match(startupLine({ RENDER: 'true', PORT: '10051' }), /http:\/\/0\.0\.0\.0:10051/);
});

test('手元では 127.0.0.1 のまま（外から触れない）', () => {
  assert.match(startupLine({ PORT: '10052' }), /http:\/\/127\.0\.0\.1:10052/);
});

test('HOST を明示すればそちらが優先される', () => {
  assert.match(startupLine({ RENDER: 'true', HOST: '127.0.0.1', PORT: '10053' }), /http:\/\/127\.0\.0\.1:10053/);
});
