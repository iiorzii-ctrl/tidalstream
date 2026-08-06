// 港湾気象予報（海天 港湾版 / port.umiten.jp）の取得。
//
// 潮流推算（海上保安庁）と違い、こちらは契約者専用のサイトで、次の2つが秘密です。
//
//   1. URL に含まれる契約者ごとのディレクトリ名
//   2. Basic 認証のユーザ名とパスワード
//
// どちらもソースには書かず、環境変数（＝ Render などの secret）から読みます。
// リポジトリは公開されうるので、ここに直接書くと URL だけで誰でも入れてしまいます。
//
// 資格情報を送る先は「設定した URL と同じ生成元の、同じディレクトリ配下」だけに
// 限定しています（assertUmitenUrl）。ページ内のリンクを辿る作りなので、上流の
// リンクが外部を指していた場合に資格情報を他所へ送ってしまわないようにするためです。

import { HttpError, fetchPage } from './fetcher.mjs';
import { decodeEntities, findElements, stripTags } from './html.mjs';

/**
 * 環境変数から設定を読む。
 *
 * 読み込み時ではなく呼ばれるたびに読むのは、設定漏れを「起動できない」ではなく
 * 「この機能だけ無効」として扱いたいのと、テストから差し替えられるようにするため。
 */
export function umitenConfig() {
  // 管理画面に貼り付けたときに紛れがちな前後の空白・改行は落とす
  const indexUrl = (process.env.UMITEN_INDEX_URL ?? '').trim();
  const user = (process.env.UMITEN_USER ?? '').trim();
  const pass = (process.env.UMITEN_PASS ?? '').trim();

  if (!indexUrl || !user || !pass) {
    return { enabled: false, reason: missingReason({ indexUrl, user, pass }) };
  }

  let url;
  try {
    url = new URL(indexUrl);
  } catch {
    return { enabled: false, reason: 'UMITEN_INDEX_URL が URL として読めません' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { enabled: false, reason: 'UMITEN_INDEX_URL は http/https にしてください' };
  }

  return {
    enabled: true,
    reason: null,
    indexUrl: url.toString(),
    origin: url.origin,
    host: url.hostname,
    // 資格情報を送ってよい範囲。index.html を含むディレクトリの配下だけ。
    dirPrefix: url.pathname.replace(/[^/]*$/, ''),
    user,
    pass,
  };
}

function missingReason({ indexUrl, user, pass }) {
  const missing = [
    ['UMITEN_INDEX_URL', indexUrl],
    ['UMITEN_USER', user],
    ['UMITEN_PASS', pass],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  return `${missing.join(' / ')} が設定されていないため、気象予報は使えません`;
}

export function umitenEnabled() {
  return umitenConfig().enabled;
}

/** 設定が無いまま呼ばれたら、その旨を伝えて止める */
export function requireUmiten() {
  const config = umitenConfig();
  if (!config.enabled) throw new HttpError(503, config.reason);
  return config;
}

/**
 * 取りに行ってよい URL か確かめて絶対 URL にする。
 *
 * ページ内のリンクは相対で書かれているため base からの解決も兼ねる。
 * 生成元とディレクトリの両方を見ているのは、資格情報の送り先を限るためと、
 * このサーバが「認証を肩代わりする踏み台」にならないようにするため。
 */
export function assertUmitenUrl(rawUrl, { base, config = umitenConfig() } = {}) {
  if (!config.enabled) throw new HttpError(503, config.reason);

  let url;
  try {
    url = new URL(String(rawUrl), base ?? config.indexUrl);
  } catch {
    throw new HttpError(400, 'URL として解釈できません');
  }
  if (url.origin !== config.origin || !url.pathname.startsWith(config.dirPrefix)) {
    // 秘密のディレクトリ名を含むので、期待した値のほうは応答に出さない
    throw new HttpError(403, '予報サイトの範囲外の URL です');
  }
  return url;
}

function authorizationHeader(config) {
  return `Basic ${Buffer.from(`${config.user}:${config.pass}`, 'utf8').toString('base64')}`;
}

/**
 * 予報ページを1枚取得する。
 *
 * ディスクへの永続キャッシュは使わない（persist を渡さない）。予報は更新される
 * うえ、資格情報付きで取ったものを平文で残したくないため。
 */
export async function fetchUmitenPage(rawUrl, { base, config = requireUmiten() } = {}) {
  const url = assertUmitenUrl(rawUrl, { base, config });
  try {
    return await fetchPage(url.toString(), {
      headers: { authorization: authorizationHeader(config) },
      allowedHosts: new Set([config.host]),
      referer: config.indexUrl,
    });
  } catch (error) {
    throw translateUpstreamError(error, config);
  }
}

/**
 * 上流のエラーを、秘密の URL を含まない形に言い換える。
 * そのまま返すと、応答本文に契約者ごとのディレクトリ名が載ってしまう。
 */
function translateUpstreamError(error, config) {
  const status = error?.upstreamStatus;
  if (status === 401 || status === 403) {
    return new HttpError(502, '予報サイトが認証を受け付けませんでした（UMITEN_USER / UMITEN_PASS を確認してください）');
  }
  if (status === 404) {
    return new HttpError(502, '予報サイトに該当のページがありませんでした（UMITEN_INDEX_URL を確認してください）');
  }
  if (error instanceof HttpError) {
    return new HttpError(error.status, redactSecrets(error.message, config), error);
  }
  return new HttpError(502, `予報サイトへの接続に失敗しました: ${redactSecrets(error?.message ?? String(error), config)}`);
}

/** 秘密のディレクトリ名と資格情報を伏せ字にする（ログや応答に出す前に通す） */
export function redactSecrets(text, config = umitenConfig()) {
  let out = String(text ?? '');
  if (!config.enabled) return out;
  for (const secret of [config.dirPrefix.replace(/^\/|\/$/g, ''), config.user, config.pass]) {
    if (secret && secret.length >= 3) out = out.split(secret).join('***');
  }
  return out;
}

/**
 * ページ内のリンクを列挙する。予報地点の一覧を見つけるのに使う。
 * within が true のものだけが取りに行ける（＝予報サイトの範囲内の）リンク。
 */
export function extractLinks(html, baseUrl, config = umitenConfig()) {
  const out = [];
  const seen = new Set();

  for (const anchor of findElements(html, 'a')) {
    const href = decodeEntities(anchor.attrs.href ?? '').trim();
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) continue;

    let absolute;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    let within = false;
    try {
      assertUmitenUrl(absolute, { base: baseUrl, config });
      within = true;
    } catch {
      within = false;
    }

    out.push({
      href,
      url: absolute,
      text: stripTags(anchor.inner),
      title: anchor.attrs.title ?? '',
      within,
    });
  }

  return out;
}
