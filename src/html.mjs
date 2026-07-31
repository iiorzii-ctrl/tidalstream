// 依存パッケージなしで済ませるための、用途を絞った軽量 HTML パーサ。
// 上流ページは古い CGI 出力なので、正規表現で十分に読める。

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;

export function parseAttrs(tagSource) {
  const attrs = {};
  // タグ名の部分を落としてから属性を読む
  const body = tagSource.replace(/^<\s*[a-zA-Z][-a-zA-Z0-9]*/, '');
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(body)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const key = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : whole;
  });
}

export function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/** 単独タグ（img, input など）を列挙する */
export function findTags(html, tagName) {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ source: m[0], index: m.index, attrs: parseAttrs(m[0]) });
  }
  return out;
}

/** 開始／終了タグを持つ要素を、中身つきで列挙する（入れ子は想定しない） */
export function findElements(html, tagName) {
  const re = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}\\s*>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({
      source: m[0],
      index: m.index,
      attrs: parseAttrs(`<${tagName}${m[1]}>`),
      inner: m[2],
    });
  }
  return out;
}

export function parseOptions(selectInner) {
  const out = [];
  const re = /<option\b([^>]*)>([\s\S]*?)(?=<option\b|<\/select|$)/gi;
  let m;
  while ((m = re.exec(selectInner)) !== null) {
    const attrs = parseAttrs(`<option${m[1]}>`);
    const label = stripTags(m[2]);
    out.push({
      value: attrs.value !== undefined ? attrs.value : label,
      label,
      selected: 'selected' in attrs,
    });
  }
  return out;
}

/** meta / Content-Type から文字コードを推定してデコードする */
export function decodeBody(buffer, contentTypeHeader = '') {
  const headerCharset = /charset=["']?([\w-]+)/i.exec(contentTypeHeader)?.[1];
  const ascii = Buffer.from(buffer).toString('latin1').slice(0, 4096);
  const metaCharset =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(ascii)?.[1] ??
    /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(ascii)?.[1];

  const candidates = [headerCharset, metaCharset, 'utf-8'].filter(Boolean);
  for (const charset of candidates) {
    try {
      const decoder = new TextDecoder(normalizeCharset(charset), { fatal: false });
      return { text: decoder.decode(buffer), charset: normalizeCharset(charset) };
    } catch {
      // 未対応の charset は次の候補へ
    }
  }
  return { text: Buffer.from(buffer).toString('utf8'), charset: 'utf-8' };
}

function normalizeCharset(charset) {
  const key = String(charset).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key === 'sjis' || key === 'shiftjis' || key === 'xsjis' || key === 'windows31j' || key === 'cp932') {
    return 'shift_jis';
  }
  if (key === 'eucjp' || key === 'xeucjp') return 'euc-jp';
  if (key === 'iso2022jp') return 'iso-2022-jp';
  if (key === 'utf8') return 'utf-8';
  return charset;
}
