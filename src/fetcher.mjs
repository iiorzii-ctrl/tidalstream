import {
  ALLOWED_HOSTS,
  IMAGE_CACHE_TTL_MS,
  PAGE_CACHE_TTL_MS,
  UPSTREAM_CONCURRENCY,
  UPSTREAM_TIMEOUT_MS,
  USER_AGENT,
} from './config.mjs';
import { looksDeterministic, readCache, writeCache } from './diskcache.mjs';
import { decodeBody } from './html.mjs';

/** 同時接続数を絞って、上流サーバに負荷をかけないようにする */
class Semaphore {
  #limit;
  #active = 0;
  #queue = [];

  constructor(limit) {
    this.#limit = limit;
  }

  async run(task) {
    if (this.#active >= this.#limit) {
      await new Promise((resolve) => this.#queue.push(resolve));
    }
    this.#active += 1;
    try {
      return await task();
    } finally {
      this.#active -= 1;
      this.#queue.shift()?.();
    }
  }
}

const gate = new Semaphore(UPSTREAM_CONCURRENCY);

class TtlCache {
  #map = new Map();
  #maxEntries;

  constructor(maxEntries = 200) {
    this.#maxEntries = maxEntries;
  }

  get(key) {
    const hit = this.#map.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.#map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value, ttlMs) {
    if (this.#map.size >= this.#maxEntries) {
      // 一番古い項目から捨てる（Map は挿入順）
      const oldest = this.#map.keys().next();
      if (!oldest.done) this.#map.delete(oldest.value);
    }
    this.#map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

const pageCache = new TtlCache(120);
const imageCache = new TtlCache(120);

export function assertAllowedUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(400, `URL として解釈できません: ${rawUrl}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(400, `許可されていないスキームです: ${url.protocol}`);
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new HttpError(403, `許可されていないホストです: ${url.hostname}`);
  }
  return url;
}

const IMAGE_PATH_RE = /\.(png|gif|jpe?g|webp)$/i;

/**
 * 画像として中継してよい URL か。
 *
 * 上流の CGI は「ページを返す」と「図を描く」が同じ入口なので、ここを素通しに
 * すると /api/image 経由で任意の海域・日時の図を描かせられてしまい、海域と
 * 日付の制限が意味を失う。実際の潮流図は
 * `/TIDE/pred2/CurrPred/curr_img/01_2026080109_.png` のようにクエリを持たない
 * 静的なファイルなので、その形のものだけ通す。
 */
export function assertProxyableImageUrl(rawUrl) {
  const url = assertAllowedUrl(rawUrl);
  if (url.search) {
    throw new HttpError(403, '画像の中継はクエリの無い URL だけです');
  }
  if (!IMAGE_PATH_RE.test(url.pathname)) {
    throw new HttpError(403, `画像ではない URL です: ${url.pathname}`);
  }
  return url;
}

export class HttpError extends Error {
  constructor(status, message, cause) {
    super(message, { cause });
    this.name = 'HttpError';
    this.status = status;
  }
}

async function request(url, { referer, accept } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'ja,en;q=0.8',
        accept: accept ?? 'text/html,application/xhtml+xml,*/*;q=0.8',
        ...(referer ? { referer } : {}),
      },
    });
    if (!response.ok) {
      throw new HttpError(
        response.status === 404 ? 404 : 502,
        `上流が ${response.status} ${response.statusText} を返しました: ${url}`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, contentType: response.headers.get('content-type') ?? '', finalUrl: response.url || url };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.name === 'AbortError') {
      throw new HttpError(504, `上流がタイムアウトしました (${UPSTREAM_TIMEOUT_MS}ms): ${url}`, error);
    }
    throw new HttpError(502, `上流への接続に失敗しました: ${url} (${error?.message ?? error})`, error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HTML ページを取得してデコードする。
 * 日時を明示した URL は結果が変わらないのでディスクにも残す（persist）。
 */
export async function fetchPage(rawUrl, { referer, persist = false } = {}) {
  const url = assertAllowedUrl(rawUrl).toString();
  const cached = pageCache.get(url);
  if (cached) return { ...cached, cached: 'memory' };

  const persistable = persist && looksDeterministic(url);
  if (persistable) {
    const stored = await readCache('pages', url);
    if (stored) {
      const value = {
        html: stored.body.toString('utf8'),
        charset: stored.charset,
        url,
        contentType: stored.contentType,
      };
      pageCache.set(url, value, PAGE_CACHE_TTL_MS);
      return { ...value, cached: 'disk' };
    }
  }

  const { buffer, contentType, finalUrl } = await gate.run(() => request(url, { referer }));
  const { text, charset } = decodeBody(buffer, contentType);
  const value = { html: text, charset, url: finalUrl, contentType };
  pageCache.set(url, value, PAGE_CACHE_TTL_MS);
  // デコード済みの本文を保存する（元の文字コードに戻す必要をなくすため）
  if (persistable) await writeCache('pages', url, { body: Buffer.from(text, 'utf8'), contentType, charset: 'utf-8' });
  return { ...value, cached: false };
}

/**
 * 画像を取得する。Referer を付けないと弾く CGI があるため付与する。
 * ファイル名に日時が入っている画像は内容が変わらないのでディスクにも残す。
 */
export async function fetchImage(rawUrl, { referer } = {}) {
  const url = assertProxyableImageUrl(rawUrl).toString();
  const cached = imageCache.get(url);
  if (cached) return { ...cached, cached: 'memory' };

  const persistable = looksDeterministic(url);
  if (persistable) {
    const stored = await readCache('images', url);
    if (stored) {
      const value = { buffer: stored.body, contentType: stored.contentType };
      imageCache.set(url, value, IMAGE_CACHE_TTL_MS);
      return { ...value, cached: 'disk' };
    }
  }

  const { buffer, contentType } = await gate.run(() =>
    request(url, { referer, accept: 'image/avif,image/webp,image/*,*/*;q=0.8' }),
  );
  // 念のため、返ってきたものが画像であることも確かめる（HTML を中継しない）
  if (contentType && !/^image\//i.test(contentType)) {
    throw new HttpError(502, `画像が返りませんでした: ${contentType}`);
  }
  const value = { buffer, contentType: contentType || 'application/octet-stream' };
  imageCache.set(url, value, IMAGE_CACHE_TTL_MS);
  if (persistable) await writeCache('images', url, { body: buffer, contentType: value.contentType });
  return { ...value, cached: false };
}
