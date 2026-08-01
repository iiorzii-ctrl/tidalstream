// 日本語と英語の切り替え。
//
// 画面の固定文言は HTML 側の data-i18n 属性で差し替え、
// 動的に組み立てる文言は t() を使う。

const STRINGS = {
  ja: {
    'app.title': '潮流推算ビューア',
    'app.eyebrow': '海上保安庁 海洋情報部',
    'app.lede': '海上保安庁「潮流推算」ページの図を、指定時刻から1時間ごとに横並びで表示します。',
    'lang.toggle': 'English',
    'lang.toggleAria': 'Switch to English',

    'controls.area': '海域',
    'controls.date': '日付',
    'controls.hour': '開始時刻',
    'controls.step': '間隔',
    'controls.count': '枚数',
    'controls.load': '表示',
    'controls.now': '現在時刻',
    'controls.print': '印刷',
    'controls.autoRefresh': '毎時自動更新',
    'controls.stepHours': '{n}時間',
    'controls.countSheets': '{n}枚',

    'status.loading': '読み込み中…',
    'status.shown': '{area}{count}枚を表示しました（{step}時間間隔・日本時間）',
    'status.partial': '{area}{count}枚中 {failed}枚を取得できませんでした',
    'status.failed': '取得に失敗しました: {message}',

    'frame.imageError': '画像を読み込めませんでした',
    'frame.noImage': '画像が見つかりませんでした',
    'frame.candidates': '候補',
    'frame.openSource': '元ページを開く',
    'frame.chartAlt': '{time} の潮流図',
    'frame.stationAria': '地点 {x},{y} の流速 {knots}ノット。選ぶと推移を表示します',
    'frame.stationTitle': '{knots}kn（{time}）',

    'point.title': '地点の流速',
    'point.titleAt': '地点 ({x}, {y}) の流速',
    'point.showTable': '表で見る',
    'point.hideTable': '表を隠す',
    'point.clear': '選択を解除',
    'point.stats': '最大 {max}kn（{peakAt}）／最小 {min}kn／平均 {mean}kn',
    'point.statsNone': '流速を取得できませんでした',
    'point.seriesFailed': '推移を取得できませんでした: {message}',
    'point.arrowLabel': '流れの向き（各時刻の矢印を拡大）',

    'chart.noData': 'この地点の流速を取得できませんでした',
    'chart.caption': '横軸: 時（日本時間）／縦軸: 流速（ノット）',
    'chart.aria': '地点 {x},{y} の流速の推移',
    'chart.plotAria': '流速の推移。左右キーで時刻を移動できます',
    'chart.tableTime': '日時（JST）',
    'chart.tableKnots': '流速',
    'chart.knots': '{value} kn',

    'foot.sourcePrefix': '出典:',
    'foot.sourceName': '「潮流推算」（海上保安庁 海洋情報部ホームページ）',
    'foot.processed': '／グラフ・表・CSV は同ページの値をもとに作成',
  },

  en: {
    'app.title': 'Tidal Current Viewer',
    'app.eyebrow': 'Japan Coast Guard · Hydrographic Department',
    'app.lede':
      'Shows charts from the Japan Coast Guard tidal current prediction page, side by side at hourly steps.',
    'lang.toggle': '日本語',
    'lang.toggleAria': '日本語に切り替える',

    'controls.area': 'Area',
    'controls.date': 'Date',
    'controls.hour': 'Start time',
    'controls.step': 'Step',
    'controls.count': 'Charts',
    'controls.load': 'Show',
    'controls.now': 'Now',
    'controls.print': 'Print',
    'controls.autoRefresh': 'Refresh hourly',
    'controls.stepHours': '{n} h',
    'controls.countSheets': '{n}',

    'status.loading': 'Loading…',
    'status.shown': '{area}{count} charts shown ({step}-hour steps, Japan time)',
    'status.partial': '{area}{failed} of {count} charts could not be loaded',
    'status.failed': 'Could not load: {message}',

    'frame.imageError': 'Could not load the image',
    'frame.noImage': 'No image found',
    'frame.candidates': 'Image',
    'frame.openSource': 'Open the source page',
    'frame.chartAlt': 'Tidal current chart for {time}',
    'frame.stationAria': 'Station {x},{y}, {knots} knots. Select to see how it changes over time',
    'frame.stationTitle': '{knots} kn ({time})',

    'point.title': 'Current speed at a station',
    'point.titleAt': 'Current speed at ({x}, {y})',
    'point.showTable': 'Show table',
    'point.hideTable': 'Hide table',
    'point.clear': 'Clear selection',
    'point.stats': 'Max {max} kn ({peakAt}) / min {min} kn / mean {mean} kn',
    'point.statsNone': 'Current speed is unavailable',
    'point.seriesFailed': 'Could not load the series: {message}',
    'point.arrowLabel': 'Flow direction (arrow at each time, enlarged)',

    'chart.noData': 'No current speed available for this station',
    'chart.caption': 'Horizontal: hour (Japan time) / vertical: current speed (knots)',
    'chart.aria': 'Current speed over time at station {x},{y}',
    'chart.plotAria': 'Current speed over time. Use the left and right arrow keys to move between times',
    'chart.tableTime': 'Time (JST)',
    'chart.tableKnots': 'Speed',
    'chart.knots': '{value} kn',

    'foot.sourcePrefix': 'Source:',
    'foot.sourceName': '“Tidal current prediction” (Japan Coast Guard, Hydrographic and Oceanographic Department)',
    'foot.processed': ' / graph, table and CSV built from values on that page',
  },
};

const KEY = 'tidalstream.lang';

function detect() {
  const saved = localStorage.getItem(KEY);
  if (saved === 'ja' || saved === 'en') return saved;
  // 日本語圏のブラウザなら日本語、それ以外は英語で始める
  return (navigator.language ?? '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export let lang = detect();

export function t(key, params) {
  const template = STRINGS[lang][key] ?? STRINGS.ja[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

export function setLang(next) {
  lang = next === 'en' ? 'en' : 'ja';
  localStorage.setItem(KEY, lang);
  document.documentElement.lang = lang;
  applyStatic();
}

export function toggleLang() {
  setLang(lang === 'ja' ? 'en' : 'ja');
  return lang;
}

/** data-i18n が付いた要素の文言を差し替える */
export function applyStatic(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-aria]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  }
  // 数字が入る選択肢（1時間 / 1 h など）
  for (const node of root.querySelectorAll('[data-i18n-n]')) {
    node.textContent = t(node.dataset.i18nN, { n: node.value });
  }
  document.title = `${t('app.title')} — ${lang === 'ja' ? '1時間ごとに3枚' : 'hourly, side by side'}`;
  document.documentElement.lang = lang;
}
