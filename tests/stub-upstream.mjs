// 上流ページを模したスタブサーバ。実サイトに触れずに全体の動作を確認するために使う。
// 受け取った hh に応じて画像 URL を変える（＝時刻ごとに違う図が返る本番の挙動を再現）。

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('./fixtures/page.html', import.meta.url), 'utf8');

// 1x1 の GIF
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export function startStubUpstream() {
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers });

    if (/\.(gif|png)$/i.test(url.pathname)) {
      res.writeHead(200, { 'content-type': url.pathname.endsWith('.png') ? 'image/png' : 'image/gif' });
      res.end(PIXEL);
      return;
    }

    const yy = url.searchParams.get('yy') ?? '2026';
    const mm = (url.searchParams.get('mm') ?? '7').padStart(2, '0');
    const dd = (url.searchParams.get('dd') ?? '31').padStart(2, '0');
    const hh = url.searchParams.get('hh') ?? '09';
    const html = template.replace(
      'curr_20260731090000.gif',
      `curr_${yy}${mm}${dd}${hh}0000.gif`,
    );

    // 実サイトと同じく Shift_JIS で返す
    res.writeHead(200, { 'content-type': 'text/html; charset=Shift_JIS' });
    res.end(Buffer.from(html, 'latin1'));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        requests,
        pageUrl: `http://127.0.0.1:${port}/TIDE/pred2/cgi-bin/CurrPredCgi_K.cgi`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
