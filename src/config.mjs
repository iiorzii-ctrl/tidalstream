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

// 上流ページで有効な海域コード（2026-08 時点で 01〜20。21 以降は図が無い）。
export const ALL_AREAS = [
  { code: '01', name: '東京湾', nameEn: 'Tokyo Bay' },
  { code: '02', name: '伊勢湾', nameEn: 'Ise Bay' },
  { code: '03', name: '瀬戸内沿岸', nameEn: 'Seto Inland Sea coast' },
  { code: '04', name: '九州沿岸', nameEn: 'Kyushu coast' },
  { code: '05', name: '島原湾北部', nameEn: 'Shimabara Bay (north)' },
  { code: '06', name: '島原湾南部', nameEn: 'Shimabara Bay (south)' },
  { code: '07', name: '八代海北部', nameEn: 'Yatsushiro Sea (north)' },
  { code: '08', name: '八代海南部', nameEn: 'Yatsushiro Sea (south)' },
  { code: '09', name: '鹿児島湾北部', nameEn: 'Kagoshima Bay (north)' },
  { code: '10', name: '鹿児島湾南部', nameEn: 'Kagoshima Bay (south)' },
  { code: '11', name: '奄美大島付近', nameEn: 'Around Amami Oshima' },
  { code: '12', name: '鹿児島県西方沿岸', nameEn: 'Western coast of Kagoshima' },
  { code: '13', name: '種子島・屋久島付近', nameEn: 'Around Tanegashima and Yakushima' },
  { code: '14', name: '沖縄島群島', nameEn: 'Okinawa island group' },
  { code: '15', name: '沖縄島北部', nameEn: 'Okinawa Island (north)' },
  { code: '16', name: '沖縄島南部', nameEn: 'Okinawa Island (south)' },
  { code: '17', name: '与那国島', nameEn: 'Yonaguni Island' },
  { code: '18', name: '慶良間列島・粟国島・久米島', nameEn: 'Kerama, Aguni and Kume Islands' },
  { code: '19', name: '大東諸島', nameEn: 'Daito Islands' },
  { code: '20', name: '宮古島・石垣島・西表島', nameEn: 'Miyako, Ishigaki and Iriomote Islands' },
];

// 実際に使う海域。既定は東京湾だけに絞っている。
// 海域を増やすと上流（海上保安庁）へ生成を頼む図の組み合わせもその分増えるので、
// 使わない海域は開けておかない。他の海域も見たくなったら ALLOWED_AREAS に
// カンマ区切りで足す（例: ALLOWED_AREAS=01,02）。
export const AREAS = (() => {
  const codes = (process.env.ALLOWED_AREAS ?? '01')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
  const picked = ALL_AREAS.filter((area) => codes.includes(area.code));
  // 綴り間違いなどで全部消えてしまうと何も表示できなくなるため、最低限を残す
  return picked.length > 0 ? picked : ALL_AREAS.slice(0, 1);
})();

export function isAreaAllowed(code) {
  return AREAS.some((area) => area.code === code);
}

export function areaMessage() {
  return `指定できる海域は ${AREAS.map((a) => `${a.code} ${a.name}`).join('、')} だけです`;
}

export const DEFAULTS = {
  area: AREAS[0].code,
  count: 3, // 横に並べる枚数
  stepHours: 1, // 何時間おきか
};
