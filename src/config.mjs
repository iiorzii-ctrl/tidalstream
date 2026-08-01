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

// 上流ページで有効な海域コード（2026-08 時点で 01〜20。21 以降は図が無い）。
// 画面の選択肢に使うだけで、これ以外のコードを指定してもリクエスト自体は通る。
export const AREAS = [
  { code: '01', name: '東京湾' },
  { code: '02', name: '伊勢湾' },
  { code: '03', name: '瀬戸内沿岸' },
  { code: '04', name: '九州沿岸' },
  { code: '05', name: '島原湾北部' },
  { code: '06', name: '島原湾南部' },
  { code: '07', name: '八代海北部' },
  { code: '08', name: '八代海南部' },
  { code: '09', name: '鹿児島湾北部' },
  { code: '10', name: '鹿児島湾南部' },
  { code: '11', name: '奄美大島付近' },
  { code: '12', name: '鹿児島県西方沿岸' },
  { code: '13', name: '種子島・屋久島付近' },
  { code: '14', name: '沖縄島群島' },
  { code: '15', name: '沖縄島北部' },
  { code: '16', name: '沖縄島南部' },
  { code: '17', name: '与那国島' },
  { code: '18', name: '慶良間列島・粟国島・久米島' },
  { code: '19', name: '大東諸島' },
  { code: '20', name: '宮古島・石垣島・西表島' },
];
