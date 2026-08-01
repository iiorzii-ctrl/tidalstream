import { FALLBACK_PARAM_NAMES, FORM_ROLE_HINTS, PAGE_URL } from './config.mjs';
import { decodeEntities, findElements, findTags, parseOptions } from './html.mjs';

/**
 * 上流ページのフォームを読み取り、「年」「月」「日」「時」「分」「海域」に
 * 対応するパラメータ名と現在値を推定する。
 * 実ページの仕様を決め打ちしないために、name のヒントと
 * option の並び（値の形）の両方から判定している。
 */
export function discoverForm(html) {
  const forms = findElements(html, 'form');
  const fields = new Map(); // name -> { name, kind, value, options }

  // 実ページのフォームは document.write("<input ... value=\"01\">") のように
  // JavaScript の文字列として書かれている。エスケープを戻さないと値を誤読するため、
  // 解析前に \" を " に直しておく。
  const scope = (forms.length > 0 ? forms.map((f) => f.inner).join('\n') : html).replace(/\\"/g, '"');

  for (const select of findElements(scope, 'select')) {
    const name = select.attrs.name;
    if (!name) continue;
    const options = parseOptions(select.inner);
    const selected = options.find((o) => o.selected) ?? options[0];
    fields.set(name, {
      name,
      kind: 'select',
      value: selected?.value ?? '',
      options,
    });
  }

  for (const input of findTags(scope, 'input')) {
    const name = input.attrs.name;
    if (!name) continue;
    const type = (input.attrs.type ?? 'text').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset') continue;
    if ((type === 'checkbox' || type === 'radio') && !('checked' in input.attrs)) continue;
    if (fields.has(name)) continue; // select が既にある場合はそちらを優先
    fields.set(name, { name, kind: type, value: input.attrs.value ?? '', options: null });
  }

  const roles = assignRoles([...fields.values()]);
  const action = forms[0]?.attrs.action;
  const method = (forms[0]?.attrs.method ?? 'get').toLowerCase();

  return { fields: [...fields.values()], roles, action, method, formCount: forms.length };
}

/** 各フィールドに役割（year/month/day/hour/minute/area）を割り当てる */
function assignRoles(fields) {
  const roles = {};
  const claim = (role, name) => {
    if (role && !roles[role]) roles[role] = name;
  };

  // 1) name 属性のヒントで確定できるものを先に取る
  for (const field of fields) {
    for (const [role, pattern] of Object.entries(FORM_ROLE_HINTS)) {
      if (pattern.test(field.name)) claim(role, field.name);
    }
  }

  // 2) 残りを option の形から推定する
  for (const field of fields) {
    if (Object.values(roles).includes(field.name)) continue;
    if (!field.options || field.options.length === 0) continue;
    claim(shapeOfOptions(field.options), field.name);
  }

  return roles;
}

/** option の値の並びから、それが年／月／日／時／分のどれかを推定する */
export function shapeOfOptions(options) {
  const values = options.map((o) => String(o.value).trim()).filter((v) => v !== '');
  if (values.length === 0) return null;
  const numbers = values.map(Number);
  if (numbers.some((n) => !Number.isInteger(n))) return null;

  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const unique = new Set(numbers).size === numbers.length;
  if (!unique) return null;

  if (numbers.length >= 2 && min >= 1900 && max <= 2200) return 'year';
  if (numbers.length === 24 && min === 0 && max === 23) return 'hour';
  if (numbers.length === 12 && min === 1 && max === 12) return 'month';
  if (numbers.length >= 28 && numbers.length <= 31 && min === 1 && max === numbers.length) return 'day';
  if (numbers.length >= 2 && min === 0 && max <= 59 && numbers.length <= 60) return 'minute';
  return null;
}

/**
 * 指定時刻のページ URL を組み立てる。
 * 判明したフォームの現在値をベースに、時刻まわりだけ差し替える。
 */
export function buildPageUrl({ form, area, year, month, day, hour, minute, baseUrl = PAGE_URL }) {
  const url = new URL(form?.action ? new URL(form.action, baseUrl) : baseUrl);
  const params = new URLSearchParams();

  // 元ページが持っていた隠しパラメータ等を引き継ぐ
  for (const field of form?.fields ?? []) {
    if (field.value !== undefined && field.value !== null) params.set(field.name, String(field.value));
  }

  // フォームが読めたならその名前だけを使う。読めなかったときだけ推測名に頼る。
  // （両者を混ぜると、実ページに無い min= のような余計なパラメータが付いてしまう）
  const discovered = form?.roles ?? {};
  const roles = Object.keys(discovered).length > 0 ? discovered : FALLBACK_PARAM_NAMES;
  const desired = { area, year, month, day, hour, minute };

  for (const [role, value] of Object.entries(desired)) {
    if (value === undefined || value === null || value === '') continue;
    const name = roles[role];
    if (!name) continue;
    params.set(name, formatForRole(role, value, form, name));
  }

  // baseUrl 側に元から付いていたクエリ（area=01 など）も残す
  for (const [key, value] of url.searchParams.entries()) {
    if (!params.has(key)) params.set(key, value);
  }

  url.search = params.toString();
  return url.toString();
}

/**
 * option の値が "01" 形式か "1" 形式かはページ次第なので、
 * 実際の選択肢に合わせて 0 埋めの有無を決める。
 */
function formatForRole(role, value, form, name) {
  const field = form?.fields?.find((f) => f.name === name);
  const raw = String(value);
  if (!field?.options?.length) return raw;

  const asNumber = Number(raw);
  const match = field.options.find((o) => Number(o.value) === asNumber);
  if (match) return String(match.value);

  // 選択肢に無い値でも、桁数だけは他の選択肢に合わせておく
  const width = Math.max(...field.options.map((o) => String(o.value).trim().length));
  return Number.isFinite(asNumber) && width > raw.length ? raw.padStart(width, '0') : raw;
}

/** ページに書かれている海域名（例:「推算海域(area)：東京湾, Tokyowan」）を拾う */
export function extractAreaLabel(html) {
  const m = /推算海域\s*\(area\)\s*[：:]\s*([^<\n]+)/.exec(html);
  if (!m) return null;
  // 「東京湾, Tokyowan」の和名側だけを使う
  return decodeEntities(m[1]).split(',')[0].trim() || null;
}

const NOISE_RE =
  /(logo|banner|btn|button|icon|spacer|blank|clear\.|menu|header|footer|arrow|home|back|next|prev|title|sitemap|mail|pdf|new_?mark|bar\d|line\d)/i;
const CHART_HINT_RE = /(curr|tide|pred|chart|map|fig|graph|zu|gra|img\/|image\/|gif\/)/i;

/**
 * ページ内の img から「潮流図らしいもの」を点数付けして返す。
 * 実ページを直接確認できていないため、1枚に決め打ちせず候補を順位付けし、
 * 画面側で切り替えられるようにしている。
 */
export function extractImageCandidates(html, pageUrl) {
  const seen = new Set();
  const candidates = [];

  for (const img of findTags(html, 'img')) {
    const src = img.attrs.src;
    if (!src) continue;
    let absolute;
    try {
      absolute = new URL(src, pageUrl).toString();
    } catch {
      continue;
    }
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    candidates.push({
      url: absolute,
      alt: img.attrs.alt ?? '',
      width: toInt(img.attrs.width),
      height: toInt(img.attrs.height),
      score: scoreImage(absolute, img.attrs),
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function toInt(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

function scoreImage(url, attrs) {
  let score = 0;
  const path = url.split('?')[0];

  if (NOISE_RE.test(path)) score -= 60;
  if (CHART_HINT_RE.test(url)) score += 15;
  if (url.includes('?')) score += 15; // 動的生成の図である可能性が高い
  if (/\d{6,}/.test(url)) score += 20; // 時刻やセッション ID を含むファイル名

  const width = toInt(attrs.width);
  const height = toInt(attrs.height);
  if (width && height) {
    const area = width * height;
    if (area >= 100_000) score += 40;
    else if (area >= 20_000) score += 20;
    else if (area <= 2_500) score -= 40; // アイコン相当
  }

  if (/\.(gif|png|jpe?g)$/i.test(path)) score += 5;
  if (attrs.alt && attrs.alt.length >= 2) score += 5;
  return score;
}
