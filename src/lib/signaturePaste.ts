// Reading a signature pasted from an email, a Word document or a web page: the signature image(s), the name and
// the lines under it. A sign-off table with several people (one per column, row or cell) gives one person each.

/** One person found in the paste. `images` are indexes into `PastedSignature.images`, the likeliest signature first. */
export interface PastedPerson {
  role?: string;
  name?: string;
  /** Lines under the name, with **bold** / *italic* markup. */
  details: string[];
  date?: string;
  images: number[];
}

export interface PastedSignature {
  people: PastedPerson[];
  /** Image sources in document order: a data: or http(s) URL, or null when it can't be read (e.g. a file:// link from Word with no copy of the picture alongside). */
  images: Array<string | null>;
}

export const SIGN_ROLES = ['Prepared by', 'Reviewed by', 'Approved for release by', 'Checked by', 'Authorised by'];

const ROLE_RE = /^(prepared|reviewed|approved|checked|authori[sz]ed|verified|endorsed|issued|compiled|written|peer[- ]reviewed|signed off)\b/i;
const SIGNOFF_RE = /^((kind|warm|best|many)\s+)?(regards|wishes|thanks)\b|^(ngā|nga) mihi\b|^cheers\b|^yours (sincerely|faithfully|truly)\b|^(thank you|thanks|sincerely)\W*$/i;
const DATE_ONLY_RE = /^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4})$/;
const LABEL_RE = /^(job title|title|position|designation|company|organi[sz]ation|qualifications?)\s*:\s*/i;

// ------------------------------------------------------------------ HTML (a small forgiving parser)

interface El {
  tag: string;
  attrs: Record<string, string>;
  children: Array<El | string>;
  parent?: El;
}

const VOID = new Set(['img', 'br', 'hr', 'meta', 'link', 'input', 'col', 'area', 'base', 'wbr', 'source', 'param', 'embed', 'track']);
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'blockquote', 'section', 'article', 'header', 'footer', 'address', 'pre', 'center', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'main', 'nav', 'aside', 'body', 'html', 'caption']);
const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', eacute: 'é',
  amacr: 'ā', emacr: 'ē', imacr: 'ī', omacr: 'ō', umacr: 'ū', Amacr: 'Ā', Emacr: 'Ē', Imacr: 'Ī', Omacr: 'Ō', Umacr: 'Ū',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

function parseHtml(html: string): El {
  const a = html.indexOf('<!--StartFragment-->');
  const z = html.indexOf('<!--EndFragment-->');
  if (a >= 0 && z > a) html = html.slice(a, z);
  html = html
    .replace(/<!--[\s\S]*?-->/g, '') // comments, including Word's VML copies of pictures
    .replace(/<!\[[^\]]*\]>/g, '') // <![if !vml]> … <![endif]>
    .replace(/<(style|script|head|title|xml)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<![^>]*>|<\?[^>]*>/g, '');
  const root: El = { tag: '#root', attrs: {}, children: [] };
  let cur = root;
  const closeTo = (tag: string, stopAt: string[] = []) => {
    for (let e: El | undefined = cur; e && e !== root; e = e.parent) {
      if (stopAt.includes(e.tag)) return;
      if (e.tag === tag) {
        cur = e.parent!;
        return;
      }
    }
  };
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)|</g)) {
    if (m[4] !== undefined || !m[2]) {
      cur.children.push(decodeEntities(m[4] ?? '<'));
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      closeTo(tag);
      continue;
    }
    // tags that close an open one of their kind
    if (tag === 'td' || tag === 'th') (closeTo('td', ['table']), closeTo('th', ['table']));
    if (tag === 'tr') closeTo('tr', ['table']);
    if (tag === 'p' && cur.tag === 'p') cur = cur.parent!;
    if (tag === 'li') closeTo('li', ['ul', 'ol']);
    const el: El = { tag, attrs: parseAttrs(m[3] ?? ''), children: [], parent: cur };
    cur.children.push(el);
    if (!VOID.has(tag)) cur = el;
  }
  return root;
}

const children = (e: El, tags: string[]): El[] => {
  const out: El[] = [];
  for (const c of e.children) {
    if (typeof c === 'string') continue;
    if (tags.includes(c.tag)) out.push(c);
    else if (['tbody', 'thead', 'tfoot'].includes(c.tag)) out.push(...children(c, tags));
  }
  return out;
};

function findAll(e: El, tag: string, out: El[] = []): El[] {
  for (const c of e.children) {
    if (typeof c === 'string') continue;
    if (c.tag === tag) out.push(c);
    findAll(c, tag, out);
  }
  return out;
}

// ------------------------------------------------------------------ text lines with images in between

interface Seg {
  text: string;
  bold: boolean;
  italic: boolean;
}
interface Line {
  plain: string;
  markup: string;
}
/** A run of text lines with the images among them; `at` is the index of the line an image comes before. */
interface Chunk {
  lines: Line[];
  images: Array<{ index: number; at: number }>;
}

function toLine(segs: Seg[]): Line | null {
  // merge runs of the same style and tidy spaces, then write **bold** / *italic* markup
  const merged: Seg[] = [];
  for (const s of segs) {
    const text = s.text.replace(/[\s ]+/g, ' ');
    const last = merged[merged.length - 1];
    if (last && last.bold === s.bold && last.italic === s.italic) last.text += text;
    else merged.push({ ...s, text });
  }
  const plain = merged.map((s) => s.text).join('').replace(/\s+/g, ' ').trim();
  if (!plain) return null;
  const allBold = merged.every((s) => s.bold || !s.text.trim());
  const markup = merged
    .map((s) => {
      const t = s.text.trim();
      if (!t || allBold || !(s.bold || s.italic)) return s.text;
      const lead = /^\s/.test(s.text) ? ' ' : '';
      const trail = /\s$/.test(s.text) ? ' ' : '';
      return `${lead}${s.bold ? `**${t}**` : `*${t}*`}${trail}`;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return { plain, markup: allBold && merged.some((s) => s.text.trim()) ? `**${plain}**` : markup };
}

function chunkOf(el: El, srcs: Map<El, number>): Chunk {
  const chunk: Chunk = { lines: [], images: [] };
  let segs: Seg[] = [];
  const flush = () => {
    const line = toLine(segs);
    if (line) chunk.lines.push(line);
    segs = [];
  };
  const walk = (e: El, bold: boolean, italic: boolean) => {
    const style = (e.attrs.style ?? '').toLowerCase().replace(/\s+/g, '');
    if (/display:none|mso-hide:all|visibility:hidden/.test(style)) return;
    if (['b', 'strong'].includes(e.tag) || /font-weight:(bold|[6-9]00)/.test(style)) bold = !/font-weight:(normal|[1-4]00)/.test(style);
    else if (/font-weight:(normal|[1-4]00)/.test(style)) bold = false;
    if (['i', 'em'].includes(e.tag) || /font-style:italic/.test(style)) italic = true;
    const block = BLOCK.has(e.tag);
    if (block) flush();
    for (const c of e.children) {
      if (typeof c === 'string') segs.push({ text: c, bold, italic });
      else if (c.tag === 'br') flush();
      else if (c.tag === 'img') {
        flush();
        const i = srcs.get(c);
        if (i !== undefined) chunk.images.push({ index: i, at: chunk.lines.length });
      } else walk(c, bold, italic);
    }
    if (block) flush();
  };
  walk(el, false, false);
  flush();
  return chunk;
}

// ------------------------------------------------------------------ pictures in RTF (Word's own copy of them)

function removeGroups(rtf: string, keyword: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const at = rtf.indexOf(`{\\${keyword}`, i);
    if (at < 0) return out + rtf.slice(i);
    out += rtf.slice(i, at);
    i = groupEnd(rtf, at) + 1;
  }
}

/** Index of the brace closing the group that opens at `at`. */
function groupEnd(s: string, at: number): number {
  let depth = 0;
  for (let j = at; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') j++;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j;
  }
  return s.length - 1;
}

function bytesToBase64(hex: string): string {
  let bin = '';
  for (let i = 0; i + 1 < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(bin);
}

/** PNG and JPEG pictures in RTF, in document order (Word puts its pictures here; the HTML only links to temporary files). */
export function rtfImages(rtf: string): string[] {
  if (!rtf.startsWith('{\\rtf')) return [];
  const body = removeGroups(rtf, 'nonshppict'); // Word's fallback copies (metafiles) of the same pictures
  const out: string[] = [];
  for (let i = body.indexOf('{\\pict'); i >= 0; i = body.indexOf('{\\pict', i + 1)) {
    const end = groupEnd(body, i);
    let inner = body.slice(i + 1, end);
    const type = /\\pngblip\b/.test(inner) ? 'png' : /\\jpegblip\b/.test(inner) ? 'jpeg' : null;
    if (type && !/\\bin\d/.test(inner)) {
      // drop nested groups ({\*\picprop …}, {\*\blipuid …}) and control words; what is left is the picture in hex
      for (let j = inner.indexOf('{'); j >= 0; j = inner.indexOf('{')) inner = `${inner.slice(0, j)} ${inner.slice(groupEnd(inner, j) + 1)}`; // a space, so a control word's number doesn't run into the hex
      const hex = inner.replace(/\\[a-zA-Z]+-?\d* ?|\\./g, '').replace(/\s+/g, '');
      if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0 && hex.length > 100) out.push(`data:image/${type};base64,${bytesToBase64(hex)}`);
    }
    i = end;
  }
  return out;
}

// ------------------------------------------------------------------ people

const isRole = (l: Line | undefined) => !!l && l.plain.length < 80 && ROLE_RE.test(l.plain);

function personFrom(chunk: Chunk): PastedPerson {
  const p: PastedPerson = { details: [], images: [] };
  let nameAt = -1;
  chunk.lines.forEach((line, k) => {
    const text = line.plain;
    if (!p.name && !p.role && isRole(line)) {
      const m = text.match(/^(.*?)\s*:\s*(.*)$/);
      p.role = (m ? m[1] : text).replace(/[\s:]+$/, '');
      if (m?.[2]) (p.name = m[2]), (nameAt = k);
      return;
    }
    if (!p.name && SIGNOFF_RE.test(text)) return; // "Kind regards,"
    if (/^(signature|signed)\s*:?$/i.test(text)) return;
    const date = text.match(/^date\s*[:–-]?\s*(.*)$/i);
    if (date) {
      if (date[1]) p.date = date[1];
      return;
    }
    if (DATE_ONLY_RE.test(text)) {
      p.date ??= text;
      return;
    }
    const name = text.match(/^name\s*:\s*(.+)$/i);
    if (name && !p.name) {
      p.name = name[1];
      nameAt = k;
      return;
    }
    if (!p.name && !LABEL_RE.test(text)) {
      p.name = text;
      nameAt = k;
      return;
    }
    if (text.length > 150) return; // email disclaimers and the like
    p.details.push(LABEL_RE.test(text) ? text.replace(LABEL_RE, '') : line.markup);
  });
  // a signature sits above the name; logos usually come after the details
  const before = chunk.images.filter((im) => nameAt < 0 || im.at <= nameAt);
  const after = chunk.images.filter((im) => !before.includes(im));
  p.images = [...before, ...after].map((im) => im.index);
  return p;
}

const merge = (chunks: Chunk[]): Chunk => {
  const out: Chunk = { lines: [], images: [] };
  for (const c of chunks) {
    out.images.push(...c.images.map((im) => ({ ...im, at: im.at + out.lines.length })));
    out.lines.push(...c.lines);
  }
  return out;
};

/**
 * A sign-off table gives one person per column (roles across a row), per row (roles down the first column) or per
 * cell. Null when the table isn't a sign-off (e.g. an email signature laid out in a table).
 */
function peopleFromTable(rows: Chunk[][]): PastedPerson[] | null {
  const across = rows.findIndex((r) => r.filter((c) => isRole(c.lines[0])).length >= 2);
  if (across >= 0) {
    const cols = Math.max(...rows.slice(across).map((r) => r.length));
    return Array.from({ length: cols }, (_, k) => personFrom(merge(rows.slice(across).map((r) => r[k]).filter((c): c is Chunk => !!c)))).filter((p) => p.role || p.name);
  }
  const down = rows.filter((r) => isRole(r[0]?.lines[0]));
  if (down.length >= 2) return down.map((r) => personFrom(merge(r)));
  return null;
}

/** Read what was pasted: HTML (from an email, Word or a web page), Word's RTF (where its pictures are) and/or plain text. */
export function parseSignaturePaste(input: { html?: string; text?: string; rtf?: string }): PastedSignature {
  const rtfPics = input.rtf ? rtfImages(input.rtf) : [];
  if (input.html?.trim()) {
    const root = parseHtml(input.html);
    const imgs = findAll(root, 'img').filter((im) => !(Number(im.attrs.width) <= 2 || Number(im.attrs.height) <= 2)); // not tracking pixels
    const src = imgs.map((im) => {
      const s = (im.attrs.src ?? '').trim();
      return /^data:image\//i.test(s) || /^https?:/i.test(s) ? s : null;
    });
    // Word links its pictures to temporary files the browser can't open; its RTF has the same pictures in the same order
    const images = src.map((s, i) => (rtfPics.length === imgs.length && !s?.startsWith('data:') ? rtfPics[i] : s));
    let next = 0;
    for (let i = 0; i < images.length && rtfPics.length !== imgs.length; i++) if (images[i] === null && next < rtfPics.length) images[i] = rtfPics[next++];
    const srcs = new Map(imgs.map((im, i) => [im, i]));
    for (const table of findAll(root, 'table')) {
      const rows = children(table, ['tr']).map((tr) => children(tr, ['td', 'th']).map((td) => chunkOf(td, srcs)));
      const people = peopleFromTable(rows);
      if (people?.length) return { people, images };
    }
    const all = chunkOf(root, srcs);
    return { people: all.lines.length || all.images.length ? [personFrom(all)] : [], images };
  }
  const lines = (input.text ?? '').replace(/\r/g, '').split('\n');
  const asLine = (s: string): Line | null => (s.trim() ? { plain: s.trim().replace(/\s+/g, ' '), markup: s.trim().replace(/\s+/g, ' ') } : null);
  const chunkFrom = (texts: string[]): Chunk => ({ lines: texts.map(asLine).filter((l): l is Line => !!l), images: [] });
  const images = rtfPics as Array<string | null>;
  if (lines.some((l) => l.includes('\t'))) {
    // a table copied as text: cells separated by tabs
    const people = peopleFromTable(lines.filter((l) => l.trim()).map((l) => l.split('\t').map((c) => chunkFrom([c]))));
    if (people?.length) return { people, images };
  }
  const all = chunkFrom(lines.flatMap((l) => l.split('\t')));
  if (!all.lines.length && !images.length) return { people: [], images };
  const person = personFrom(all);
  person.images = images.map((_, i) => i);
  return { people: [person], images };
}
