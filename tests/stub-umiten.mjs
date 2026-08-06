// 港湾気象予報サイトを模したスタブ。契約者ごとの秘密ディレクトリと Basic 認証を
// 再現し、資格情報の扱いを実サイトに触れずに確認できるようにする。

import { createServer } from 'node:http';

export const STUB_DIR = '/C0000_stubsecretdir';
export const STUB_USER = 'stubuser';
export const STUB_PASS = 'stubpass';

const INDEX_HTML = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>港湾気象予報（スタブ）</title></head>
<body>
<h1>東京湾 港湾気象予報</h1>
<ul>
  <li><a href="point_yokohama.html">横浜</a></li>
  <li><a href="./point_chiba.html">千葉</a></li>
</ul>
<a href="/elsewhere/other.html">範囲外のページ</a>
<a href="https://example.com/">外部サイト</a>
</body></html>`;

export function startStubUmiten() {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    requests.push({ path: url.pathname, headers: req.headers });

    if (req.headers.authorization !== basicHeader(STUB_USER, STUB_PASS)) {
      res.writeHead(401, {
        'www-authenticate': 'Basic realm="umiten"',
        'content-type': 'text/plain; charset=utf-8',
      });
      res.end('Unauthorized');
      return;
    }

    if (!url.pathname.startsWith(`${STUB_DIR}/`)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(url.pathname.endsWith('/index.html') ? INDEX_HTML : `<html><body><p>地点ページ</p></body></html>`);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        requests,
        indexUrl: `http://127.0.0.1:${port}${STUB_DIR}/index.html`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

export function basicHeader(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
}
