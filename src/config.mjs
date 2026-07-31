// 取得元の設定。上流ページの仕様が変わったらここだけ直せば済むようにしている。

export const UPSTREAM_ORIGIN = 'https://www1.kaiho.mlit.go.jp';

// TIDALSTREAM_PAGE_URL は動作確認用の差し替え口（テスト用スタブを指す等）。
export const PAGE_URL =
  process.env.TIDALSTREAM_PAGE_URL ??
  `${UPSTREAM_ORIGIN}/TIDE/pred2/cgi-bin/CurrPredCgi_K.cgi`;

// プロキシ経由で取りに行ってよいホスト。SSRF 防止のため許可制にしている。
export const ALLOWED_HOSTS = new Set(
  (process.env.TIDALSTREAM_ALLOWED_HOSTS ?? 'www1.kaiho.mlit.go.jp')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean),
);

// 相手は公共機関のサーバなので、控えめに叩く。
export const UPSTREAM_CONCURRENCY = 2;
export const PAGE_CACHE_TTL_MS = 10 * 60 * 1000;
export const IMAGE_CACHE_TTL_MS = 30 * 60 * 1000;
export const UPSTREAM_TIMEOUT_MS = 20_000;

export const USER_AGENT =
  'tidalstream/1.0 (personal tide-chart viewer; contact: repository owner)';

// ページ内にフォームが見つからなかった場合に使うクエリ名のフォールバック。
// 実ページを確認できたら FORM_ROLE_HINTS 側で上書きするのが望ましい。
export const FALLBACK_PARAM_NAMES = {
  area: 'area',
  year: 'year',
  month: 'month',
  day: 'day',
  hour: 'hour',
  minute: 'min',
};

// name 属性から役割を判定するときのヒント。自動判定が外れたらここに追記する。
export const FORM_ROLE_HINTS = {
  year: /^(y|yy|yyyy|year|nen)$/i,
  month: /^(m|mm|month|tsuki|gatsu)$/i,
  day: /^(d|dd|day|hi|nichi)$/i,
  hour: /^(h|hh|hour|hr|ji|jikan|time)$/i,
  minute: /^(mi|mn|min|minute|fun|pun)$/i,
  area: /^(area|kaiiki|region|pref)$/i,
};

export const DEFAULTS = {
  area: '01',
  count: 3, // 横に並べる枚数
  stepHours: 1, // 何時間おきか
};
