// Basic 認証。外に出す場合に、誰でもアクセスできる状態を避けるためのもの。
//
// AUTH_USER と AUTH_PASS の両方が設定されているときだけ有効になる。
// 手元で動かすぶんには何も設定しなくてよい。

import { timingSafeEqual } from 'node:crypto';

const USER = process.env.AUTH_USER ?? '';
const PASS = process.env.AUTH_PASS ?? '';

export const authEnabled = USER !== '' && PASS !== '';

/** 文字列の比較で長さや内容の差が時間に出ないようにする */
function safeEqual(a, b) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
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

export function isAuthorized(headerValue) {
  if (!authEnabled) return true;
  const credentials = parseBasicAuth(headerValue);
  if (!credentials) return false;
  // 片方だけ先に判定して早期に返さない
  const userOk = safeEqual(credentials.user, USER);
  const passOk = safeEqual(credentials.pass, PASS);
  return userOk && passOk;
}

/** 外部に公開しているのに認証が無い状態を起動時に警告する */
export function warnIfExposed(host) {
  if (authEnabled) return null;
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return null;
  return (
    `警告: ${host} で待ち受けていますが認証が設定されていません。` +
    ' 外部に公開する場合は AUTH_USER と AUTH_PASS を設定してください。'
  );
}
