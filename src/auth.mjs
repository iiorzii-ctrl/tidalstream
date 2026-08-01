// アクセス制限。外に出す場合に、誰でもアクセスできる状態を避けるためのもの。
// 2通りあり、どちらも設定しなければ制限なしで動く（手元で使う場合）。
//
//   1. Basic 認証        … AUTH_USER と AUTH_PASS の両方を設定
//   2. 秘密のリンク      … ACCESS_TOKEN を設定し、?k=<token> で1回開く
//
// 2 は開いた時点で Cookie を発行するので、以後はリンクを開くだけで使える。
// 少人数に渡すなら、毎回の入力が要らない 2 のほうが摩擦が少ない。

import { timingSafeEqual } from 'node:crypto';

// 管理画面の入力欄に貼り付けたときに紛れがちな前後の空白・改行は無視する。
// （「見た目は正しいのに弾かれる」事故を防ぐため。値の途中の空白は残す）
const USER = (process.env.AUTH_USER ?? '').trim();
const PASS = (process.env.AUTH_PASS ?? '').trim();
const TOKEN = (process.env.ACCESS_TOKEN ?? '').trim();

export const basicAuthEnabled = USER !== '' && PASS !== '';
export const tokenAuthEnabled = TOKEN !== '';
export const authEnabled = basicAuthEnabled || tokenAuthEnabled;

export const COOKIE_NAME = 'tidalstream_key';
export const TOKEN_PARAM = 'k';

/** 文字列の比較で長さや内容の差が時間に出ないようにする */
function safeEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) {
    // 長さが違っても比較の時間を揃える
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function parseBasicAuth(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(headerValue.trim());
  if (!match) return null;
  let decoded;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
  const separator = decoded.indexOf(':');
  if (separator < 0) return null;
  return { user: decoded.slice(0, separator), pass: decoded.slice(separator + 1) };
}

export function parseCookies(headerValue) {
  const out = {};
  if (typeof headerValue !== 'string') return out;
  for (const part of headerValue.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name) out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function basicAuthMatches(headerValue) {
  if (!basicAuthEnabled) return false;
  const credentials = parseBasicAuth(headerValue);
  if (!credentials) return false;
  // 片方だけ先に判定して早期に返さない
  const userOk = safeEqual(credentials.user, USER);
  const passOk = safeEqual(credentials.pass, PASS);
  return userOk && passOk;
}

export function tokenMatches(value) {
  if (!tokenAuthEnabled || typeof value !== 'string' || value === '') return false;
  return safeEqual(value, TOKEN);
}

/**
 * リクエストを通してよいか判定する。
 * 戻り値の setCookie が true のときは、Cookie を発行してリンクを覚えさせる。
 */
export function checkAccess({ authorization, cookie, tokenParam }) {
  if (!authEnabled) return { ok: true, setCookie: false };
  if (basicAuthMatches(authorization)) return { ok: true, setCookie: false };
  if (tokenMatches(tokenParam)) return { ok: true, setCookie: true };
  if (tokenMatches(parseCookies(cookie)[COOKIE_NAME])) return { ok: true, setCookie: false };
  return { ok: false, setCookie: false };
}

export function cookieHeader({ secure }) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(TOKEN)}`,
    'Path=/',
    'Max-Age=31536000', // 1年。毎回リンクを開き直さなくてよいように
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** 外部に公開しているのに制限が無い状態を起動時に警告する */
export function warnIfExposed(host) {
  if (authEnabled) return null;
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return null;
  return (
    `警告: ${host} で待ち受けていますがアクセス制限がありません。` +
    ' 外部に公開する場合は ACCESS_TOKEN か AUTH_USER/AUTH_PASS を設定してください。'
  );
}

export function authMode() {
  if (basicAuthEnabled && tokenAuthEnabled) return 'Basic 認証 + 秘密のリンク';
  if (basicAuthEnabled) return 'Basic 認証';
  if (tokenAuthEnabled) return '秘密のリンク';
  return 'なし';
}
