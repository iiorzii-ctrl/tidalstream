import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COOKIE_NAME, TOKEN_PARAM, authMode, checkAccess, cookieHeader, tokenAuthEnabled, warnIfExposed } from './src/auth.mjs';
import { clientKey, dateRangeMessage, isRangeAllowed, rateLimit } from './src/guard.mjs';
import { AREAS, DEFAULTS, PAGE_URL } from './src/config.mjs';
import { HttpError, fetchImage, fetchPage } from './src/fetcher.mjs';
import { collectFrames, collectSeries, nowInTokyo } from './src/frames.mjs';
import { buildPageUrl, discoverForm, extractImageCandidates } from './src/scraper.mjs';

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  try {
    // 死活監視は認証の対象外にする（ホスティング側のヘルスチェック用）。
    // 内部の情報は返さない。
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('ok\n');
      return;
    }
    // 検索エンジンなどに拾われないようにする（秘密のリンクで使う前提）
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('User-agent: *\nDisallow: /\n');
      return;
    }

    const access = checkAccess({
      authorization: req.headers.authorization,
      cookie: req.headers.cookie,
      tokenParam: url.searchParams.get(TOKEN_PARAM),
    });
    if (!access.ok) {
      // 秘密のリンクだけの運用なら、認証ダイアログを出さずに素っ気なく断る
      const headers = { 'content-type': 'text/plain; charset=utf-8' };
      if (!tokenAuthEnabled) headers['www-authenticate'] = 'Basic realm="tidalstream", charset="UTF-8"';
      res.writeHead(401, headers);
      res.end('アクセスできません\n');
      return;
    }
    if (access.setCookie) {
      // 合鍵を Cookie に覚えさせ、URL から鍵を落として開き直させる
      const secure = (req.headers['x-forwarded-proto'] ?? '').includes('https');
      url.searchParams.delete(TOKEN_PARAM);
      res.writeHead(302, {
        'set-cookie': cookieHeader({ secure }),
        location: url.pathname + (url.search || '') + url.hash,
        'cache-control': 'no-store',
      });
      res.end();
      return;
    }

    const limit = rateLimit(clientKey(req));
    if (!limit.allowed) {
      res.writeHead(429, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60' });
      res.end('リクエストが多すぎます。少し待ってから開き直してください\n');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, 'GET のみ対応しています');
    }
    if (url.pathname === '/api/areas') return sendJson(res, 200, { areas: AREAS });
    if (url.pathname === '/api/frames') return await handleFrames(url, res);
    if (url.pathname === '/api/series') return await handleSeries(url, res);
    if (url.pathname === '/api/series.csv') return await handleSeriesCsv(url, res);
    if (url.pathname === '/api/image') return await handleImage(url, res);
    if (url.pathname === '/api/debug') return await handleDebug(url, res);
    return await handleStatic(url, res);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error(`[${status}] ${url.pathname}: ${error?.stack ?? error}`);
    sendJson(res, status, { error: error?.message ?? String(error) });
  }
});

async function handleFrames(url, res) {
  const area = url.searchParams.get('area') || DEFAULTS.area;
  const count = clampInt(url.searchParams.get('count'), DEFAULTS.count, 1, 12);
  const stepHours = clampInt(url.searchParams.get('step'), DEFAULTS.stepHours, 1, 24);
  const start = parseStart(url.searchParams);

  if (!isRangeAllowed(start, { count, stepHours })) throw new HttpError(400, dateRangeMessage());

  const result = await collectFrames({ area, start, count, stepHours });

  // 画像は自前のプロキシ経由で出す（Referer 制限とキャッシュのため）
  for (const frame of result.frames) {
    frame.proxiedImageUrl = frame.imageUrl ? proxyUrlFor(frame.imageUrl, frame.pageUrl) : null;
    for (const candidate of frame.candidates) {
      candidate.proxiedUrl = proxyUrlFor(candidate.url, frame.pageUrl);
    }
  }

  sendJson(res, 200, result);
}

function seriesOptions(url) {
  const x = Number.parseFloat(url.searchParams.get('x') ?? '');
  const y = Number.parseFloat(url.searchParams.get('y') ?? '');
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new HttpError(400, '地点の座標 x, y を指定してください');
  }
  const hours = clampInt(url.searchParams.get('hours'), 12, 1, 12);
  const stepHours = clampInt(url.searchParams.get('step'), DEFAULTS.stepHours, 1, 24);
  const start = parseStart(url.searchParams);
  if (!isRangeAllowed(start, { count: hours, stepHours })) throw new HttpError(400, dateRangeMessage());

  return {
    area: url.searchParams.get('area') || DEFAULTS.area,
    // 1時間ぶんの取得ごとに上流で図が1枚生成されるので、上限も控えめにしておく
    hours,
    stepHours,
    start,
    x,
    y,
  };
}

async function handleSeries(url, res) {
  sendJson(res, 200, await collectSeries(seriesOptions(url)));
}

async function handleSeriesCsv(url, res) {
  const series = await collectSeries(seriesOptions(url));
  const rows = [
    ['datetime_jst', 'area', 'area_name', 'station_x', 'station_y', 'knots'],
    ...series.points.map((p) => [
      p.label,
      series.area,
      series.areaLabel ?? '',
      series.station.x,
      series.station.y,
      p.knots ?? '',
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const body = Buffer.from(`﻿${csv}\r\n`, 'utf8'); // Excel 用に BOM を付ける
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-length': body.length,
    'content-disposition': `attachment; filename="tidalstream_${series.area}_${series.station.x}-${series.station.y}.csv"`,
  });
  res.end(body);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function handleImage(url, res) {
  const target = url.searchParams.get('u');
  if (!target) throw new HttpError(400, 'u パラメータが必要です');
  const referer = url.searchParams.get('r') || PAGE_URL;

  const image = await fetchImage(target, { referer });
  res.writeHead(200, {
    'content-type': image.contentType,
    'content-length': image.buffer.length,
    'cache-control': 'public, max-age=900',
    'x-upstream-cache': image.cached || 'miss', // memory / disk / miss
  });
  res.end(image.buffer);
}

/** 上流ページの構造をそのまま見るための確認用エンドポイント */
async function handleDebug(url, res) {
  const area = url.searchParams.get('area') || DEFAULTS.area;
  const pageUrl = buildPageUrl({ form: null, area, baseUrl: PAGE_URL });
  const page = await fetchPage(pageUrl);
  const form = discoverForm(page.html);

  sendJson(res, 200, {
    pageUrl,
    charset: page.charset,
    htmlLength: page.html.length,
    form,
    images: extractImageCandidates(page.html, page.url),
    htmlHead: page.html.slice(0, 4000),
  });
}

async function handleStatic(url, res) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) throw new HttpError(403, 'アクセスできません');

  let body;
  try {
    body = await readFile(filePath);
  } catch {
    throw new HttpError(404, `見つかりません: ${url.pathname}`);
  }
  res.writeHead(200, {
    'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  res.end(body);
}

function proxyUrlFor(imageUrl, referer) {
  return `/api/image?u=${encodeURIComponent(imageUrl)}&r=${encodeURIComponent(referer)}`;
}

function parseStart(params) {
  const date = params.get('date');
  const hour = params.get('hour');
  if (!date) return hour === null ? undefined : { ...nowInTokyo(), hour: clampInt(hour, 0, 0, 23) };

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new HttpError(400, 'date は YYYY-MM-DD 形式で指定してください');
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: clampInt(hour, nowInTokyo().hour, 0, 23),
  };
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

server.listen(PORT, HOST, () => {
  console.log(`tidalstream → http://${HOST}:${PORT}`);
  console.log(`アクセス制限: ${authMode()}`);
  const warning = warnIfExposed(HOST);
  if (warning) console.warn(warning);
});
