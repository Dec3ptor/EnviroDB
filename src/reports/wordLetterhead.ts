import JSZip from 'jszip';
import type { Letterhead, LetterheadItem, LetterheadPage } from '../db/types';

// A company letterhead from a Word file (.docx or .dotx): its header and footers – logo, address, page numbers –
// margins, fonts and colours. Reading it gives (1) a description the PDF and preview can draw, and (2) a cut-down
// copy of the file holding only the letterhead (no body text), which Word downloads are then built on, so their
// header and footers are exactly the company's own.

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_TYPES = {
  officeDocument: `${REL}/officeDocument`,
  header: `${REL}/header`,
  footer: `${REL}/footer`,
  styles: `${REL}/styles`,
  theme: `${REL}/theme`,
  image: `${REL}/image`,
};
const CT = {
  main: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  header: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  footer: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  styles: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
};
const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
};

const TWIP_MM = 1 / 56.6929;
const EMU_MM = 1 / 36000;

// ---------------------------------------------------------------- a small XML reader (Word's parts are machine-written)

export interface El {
  name: string;
  attrs: Record<string, string>;
  kids: Array<El | string>;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unescapeXml = (s: string) =>
  s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m)));
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function parseXml(xml: string): El {
  const root: El = { name: '#root', attrs: {}, kids: [] };
  const stack: El[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.kids.push(m[1]);
    else if (m[2]) {
      for (let i = stack.length - 1; i > 0; i--)
        if (stack[i].name === m[2]) {
          stack.length = i;
          break;
        }
    } else if (m[3]) {
      const el: El = { name: m[3], attrs: {}, kids: [] };
      const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = ar.exec(m[4]))) el.attrs[a[1]] = unescapeXml(a[2] ?? a[3] ?? '');
      top.kids.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined && (top.name === 'w:t' || top.name === 'w:instrText' || m[6].trim())) top.kids.push(unescapeXml(m[6])); // spaces count only in text
  }
  return root;
}

const els = (el: El | undefined, name?: string): El[] => (el ? (el.kids.filter((k) => typeof k !== 'string' && (!name || k.name === name)) as El[]) : []);
const child = (el: El | undefined, name: string): El | undefined => els(el).find((k) => k.name === name);
function find(el: El | undefined, name: string): El | undefined {
  if (!el) return undefined;
  for (const k of els(el)) {
    if (k.name === name) return k;
    const f = find(k, name);
    if (f) return f;
  }
  return undefined;
}
const textOf = (el: El): string => el.kids.map((k) => (typeof k === 'string' ? k : textOf(k))).join('');
const val = (el: El | undefined, attr = 'w:val') => el?.attrs[attr];
const num = (s: string | undefined) => (s === undefined || s === '' || isNaN(+s) ? undefined : +s);
const on = (el: El | undefined) => (el ? !['0', 'false', 'off'].includes(el.attrs['w:val'] ?? '') : undefined);

// ---------------------------------------------------------------- package helpers

interface Rel {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

function readRels(xml: string | undefined): Rel[] {
  if (!xml) return [];
  return els(find(parseXml(xml), 'Relationships'), 'Relationship').map((r) => ({ id: r.attrs.Id, type: r.attrs.Type, target: r.attrs.Target, external: r.attrs.TargetMode === 'External' }));
}

/** A relationship target as a path in the package, from the folder of the part it belongs to. */
function resolvePath(fromPart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = fromPart.split('/').slice(0, -1);
  for (const bit of target.split('/')) {
    if (bit === '..') parts.pop();
    else if (bit && bit !== '.') parts.push(bit);
  }
  return parts.join('/');
}

const relsPathOf = (part: string) => {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
};

const text = async (zip: JSZip, path: string) => (await zip.file(path)?.async('string')) ?? undefined;

function base64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function bytesOfDataUrl(dataUrl: string): Uint8Array {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function openWord(bytes: ArrayBuffer | Uint8Array): Promise<{ zip: JSZip; main: string }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('This is not a Word document (.docx or .dotx). Older .doc files need saving as .docx in Word first.');
  }
  const root = readRels(await text(zip, '_rels/.rels'));
  const main = root.find((r) => r.type === REL_TYPES.officeDocument)?.target.replace(/^\//, '') ?? 'word/document.xml';
  if (!zip.file(main)) throw new Error('This is not a Word document (.docx or .dotx).');
  return { zip, main };
}

/** The section settings that apply to the document's last section: the body's own sectPr. */
function lastSectPr(docXml: string): { xml: string; all: string[] } {
  const all = docXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g) ?? [];
  if (!all.length) throw new Error('This Word file has no page settings.');
  return { xml: all[all.length - 1], all };
}

/** Header and footer references of the last section; a type it doesn't set is inherited from the sections before it. */
function hdrFtrRefs(all: string[]): Record<'header' | 'footer', Partial<Record<'default' | 'first' | 'even', string>>> {
  const out: Record<'header' | 'footer', Partial<Record<'default' | 'first' | 'even', string>>> = { header: {}, footer: {} };
  for (const s of all) {
    for (const m of s.matchAll(/<w:(header|footer)Reference\b([^>]*)\/>/g)) {
      const type = (m[2].match(/w:type="(\w+)"/)?.[1] ?? 'default') as 'default' | 'first' | 'even';
      const id = m[2].match(/r:id="([^"]+)"/)?.[1];
      if (id) out[m[1] as 'header' | 'footer'][type] = id; // later sections override earlier ones
    }
  }
  return out;
}

// ---------------------------------------------------------------- styles

interface Look {
  color?: string;
  sizePt?: number;
  bold?: boolean;
  italic?: boolean;
  font?: string;
}

interface StyleDef {
  id: string;
  type: string;
  basedOn?: string;
  pPr?: El;
  rPr?: El;
  isDefault: boolean;
}

interface Styles {
  map: Map<string, StyleDef>;
  defaultRun?: El;
  defaultPara?: El;
  theme: { major?: string; minor?: string };
}

function readStyles(stylesXml: string | undefined, themeXml: string | undefined): Styles {
  const map = new Map<string, StyleDef>();
  const root = stylesXml ? parseXml(stylesXml) : undefined;
  const styles = find(root, 'w:styles');
  for (const s of els(styles, 'w:style'))
    map.set(s.attrs['w:styleId'], { id: s.attrs['w:styleId'], type: s.attrs['w:type'], basedOn: val(child(s, 'w:basedOn')), pPr: child(s, 'w:pPr'), rPr: child(s, 'w:rPr'), isDefault: s.attrs['w:default'] === '1' });
  const dd = child(styles, 'w:docDefaults');
  const theme = themeXml ? parseXml(themeXml) : undefined;
  return {
    map,
    defaultRun: child(child(dd, 'w:rPrDefault'), 'w:rPr'),
    defaultPara: child(child(dd, 'w:pPrDefault'), 'w:pPr'),
    theme: { major: val(child(find(theme, 'a:majorFont'), 'a:latin'), 'typeface'), minor: val(child(find(theme, 'a:minorFont'), 'a:latin'), 'typeface') },
  };
}

function runLook(rPr: El | undefined, st: Styles): Look {
  const out: Look = {};
  if (!rPr) return out;
  const color = val(child(rPr, 'w:color'));
  if (color && /^[0-9a-f]{6}$/i.test(color)) out.color = `#${color.toUpperCase()}`;
  const sz = num(val(child(rPr, 'w:sz')));
  if (sz) out.sizePt = sz / 2;
  const b = on(child(rPr, 'w:b'));
  if (b !== undefined) out.bold = b;
  const i = on(child(rPr, 'w:i'));
  if (i !== undefined) out.italic = i;
  const f = child(rPr, 'w:rFonts');
  const theme = f?.attrs['w:asciiTheme'] ?? f?.attrs['w:hAnsiTheme'];
  const font = f?.attrs['w:ascii'] ?? f?.attrs['w:hAnsi'] ?? (theme ? (theme.startsWith('major') ? st.theme.major : st.theme.minor) : undefined);
  if (font) out.font = font;
  return out;
}

/** A style's look with everything it is based on (the base first). */
function styleLook(id: string | undefined, st: Styles, seen = new Set<string>()): Look {
  const s = id ? st.map.get(id) : undefined;
  if (!s || seen.has(s.id)) return {};
  seen.add(s.id);
  return { ...styleLook(s.basedOn, st, seen), ...runLook(s.rPr, st) };
}

/** Left indent (twips) and alignment set by a paragraph style or anything it is based on. */
function stylePara(id: string | undefined, st: Styles, seen = new Set<string>()): { ind?: number; jc?: string } {
  const s = id ? st.map.get(id) : undefined;
  if (!s || seen.has(s.id)) return {};
  seen.add(s.id);
  const base = stylePara(s.basedOn, st, seen);
  const ind = child(s.pPr, 'w:ind');
  const left = num(ind?.attrs['w:left'] ?? ind?.attrs['w:start']);
  return { ind: left ?? base.ind, jc: val(child(s.pPr, 'w:jc')) ?? base.jc };
}

const defaultStyleId = (st: Styles, type: 'paragraph' | 'character') => [...st.map.values()].find((s) => s.type === type && s.isDefault)?.id ?? (type === 'paragraph' ? 'Normal' : undefined);

// ---------------------------------------------------------------- headers and footers, as the PDF draws them

type Align = 'left' | 'center' | 'right';

interface PartContext {
  st: Styles;
  images: Map<string, { dataUrl: string } | null>; // by relationship id (null: a picture the PDF can't draw, e.g. EMF)
  page: { widthMm: number; left: number; right: number };
}

function partItems(xml: string, x: PartContext): LetterheadItem[] {
  const out: LetterheadItem[] = [];
  const st = x.st;
  const normal = defaultStyleId(st, 'paragraph');
  const base: Look = { ...runLook(st.defaultRun, st) };
  const contentMm = x.page.widthMm - x.page.left - x.page.right;

  // content of a block-level container: paragraphs and tables, also inside content controls
  const blocks = (el: El, align: Align | null, dx: number) => {
    for (const k of els(el)) {
      if (k.name === 'w:p') paragraph(k, align, dx);
      else if (k.name === 'w:tbl') table(k, align, dx);
      else if (k.name === 'w:sdt') blocks(child(k, 'w:sdtContent') ?? k, align, dx);
      else if (k.name === 'w:customXml' || k.name === 'w:ins') blocks(k, align, dx);
    }
  };
  const unwrap = (el: El, name: string): El[] => els(el).flatMap((k) => (k.name === name ? [k] : k.name === 'w:sdt' || k.name === 'w:customXml' ? unwrap(child(k, 'w:sdtContent') ?? k, name) : []));
  const table = (tbl: El, align: Align | null, dx: number) => {
    const tblPr = child(tbl, 'w:tblPr');
    const indent = (num(val(child(tblPr, 'w:tblInd'), 'w:w')) ?? 0) * TWIP_MM;
    const grid = els(child(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => (num(g.attrs['w:w']) ?? 0) * TWIP_MM);
    for (const tr of unwrap(tbl, 'w:tr')) {
      const cells = unwrap(tr, 'w:tc');
      let at = dx + indent;
      cells.forEach((tc, i) => {
        const cellAlign: Align | null = cells.length === 1 ? align : i === 0 ? 'left' : i === cells.length - 1 ? 'right' : 'center';
        blocks(tc, cellAlign, at);
        const span = num(val(child(child(tc, 'w:tcPr'), 'w:gridSpan'))) ?? 1;
        at += grid.slice(i, i + span).reduce((s, w) => s + w, 0);
      });
    }
  };
  const paragraph = (p: El, inherited: Align | null, dx: number) => {
    const pPr = child(p, 'w:pPr');
    const styleId = val(child(pPr, 'w:pStyle')) ?? normal;
    const sp = stylePara(styleId, st);
    const jc = val(child(pPr, 'w:jc')) ?? sp.jc;
    const align: Align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'left' || jc === 'start' || jc === 'both' ? (inherited === 'right' && !val(child(pPr, 'w:jc')) ? 'right' : 'left') : (inherited ?? 'left');
    const ind = child(pPr, 'w:ind');
    const indMm = (num(ind?.attrs['w:left'] ?? ind?.attrs['w:start']) ?? sp.ind ?? 0) * TWIP_MM;
    const paraLook: Look = { ...base, ...styleLook(styleId, st) };
    const runs: Array<{ text: string } & Look> = [];
    const pictures: LetterheadItem[] = [];
    const field = { open: false, code: '', result: false, page: '' };
    const addText = (t: string, look: Look) => {
      if (field.result && field.page) return; // the page number's cached value
      runs.push({ text: t, ...look });
    };
    const picture = (drawing: El, look: Align) => {
      const blip = find(drawing, 'a:blip');
      const id = blip?.attrs['r:embed'] ?? find(drawing, 'v:imagedata')?.attrs['r:id'];
      const anchor = child(drawing, 'wp:anchor');
      let side: Align = look;
      if (anchor) {
        const h = child(anchor, 'wp:positionH');
        const alignEl = child(h, 'wp:align');
        const offEl = child(h, 'wp:posOffset');
        const where = alignEl ? textOf(alignEl).trim() : undefined;
        const off = offEl ? num(textOf(offEl).trim()) : undefined;
        if (where) side = where === 'right' || where === 'outside' ? 'right' : where === 'center' ? 'center' : 'left';
        else if (off !== undefined) {
          const fromMargin = h?.attrs.relativeFrom === 'page' ? off * EMU_MM - x.page.left : off * EMU_MM;
          side = fromMargin > contentMm * 0.6 ? 'right' : fromMargin > contentMm * 0.3 ? 'center' : 'left';
        }
        // a text box: its own paragraphs, on the anchor's side
        const box = find(anchor, 'w:txbxContent');
        if (box) blocks(box, side, dx);
      }
      if (!id) return;
      const img = x.images.get(id);
      const ext = find(drawing, 'wp:extent');
      const [cx, cy] = [num(ext?.attrs.cx), num(ext?.attrs.cy)];
      const shift = Math.round((dx + indMm) * 10) / 10;
      if (img && cx && cy) pictures.push({ kind: 'image', align: side, dataUrl: img.dataUrl, widthMm: cx * EMU_MM, heightMm: cy * EMU_MM, ...(side === 'left' && shift ? { dx: shift } : {}) });
    };
    const inline = (el: El, look: Look) => {
      for (const k of els(el)) {
        switch (k.name) {
          case 'w:r': {
            const rPr = child(k, 'w:rPr');
            const rLook: Look = { ...look, ...styleLook(val(child(rPr, 'w:rStyle')), st), ...runLook(rPr, st) };
            for (const r of els(k)) {
              if (r.name === 'w:t') addText(textOf(r), rLook);
              else if (r.name === 'w:tab') addText(' ', rLook);
              else if (r.name === 'w:br' || r.name === 'w:cr') addText('\n', rLook);
              else if (r.name === 'w:fldChar') {
                const type = r.attrs['w:fldCharType'];
                if (type === 'begin') Object.assign(field, { open: true, code: '', result: false, page: '' });
                else if (type === 'separate') {
                  field.result = true;
                  field.page = /\bNUMPAGES\b|\bSECTIONPAGES\b/.test(field.code) ? '{pages}' : /\bPAGE\b/.test(field.code) ? '{page}' : '';
                  if (field.page) runs.push({ text: field.page, ...rLook });
                } else if (type === 'end') {
                  if (!field.result) {
                    const pg = /\bNUMPAGES\b|\bSECTIONPAGES\b/.test(field.code) ? '{pages}' : /\bPAGE\b/.test(field.code) ? '{page}' : '';
                    if (pg) runs.push({ text: pg, ...rLook });
                  }
                  Object.assign(field, { open: false, code: '', result: false, page: '' });
                }
              } else if (r.name === 'w:instrText') field.code += textOf(r);
              else if (r.name === 'w:drawing' || r.name === 'w:pict') picture(r, align);
              else if (r.name === 'mc:AlternateContent') {
                const choice = child(r, 'mc:Choice');
                for (const d of els(choice)) if (d.name === 'w:drawing' || d.name === 'w:pict') picture(d, align);
              }
            }
            break;
          }
          case 'w:fldSimple': {
            const code = k.attrs['w:instr'] ?? '';
            const pg = /\bNUMPAGES\b|\bSECTIONPAGES\b/.test(code) ? '{pages}' : /\bPAGE\b/.test(code) ? '{page}' : '';
            if (pg) runs.push({ text: pg, ...look });
            else inline(k, look);
            break;
          }
          case 'w:hyperlink':
          case 'w:ins':
          case 'w:smartTag':
          case 'w:customXml':
            inline(k, look);
            break;
          case 'w:sdt':
            inline(child(k, 'w:sdtContent') ?? k, look);
            break;
        }
      }
    };
    inline(p, paraLook);
    // one item per line of text, the runs that look alike joined up
    const lines: Array<typeof runs> = [[]];
    for (const r of runs) {
      const bits = r.text.split('\n');
      bits.forEach((bit, i) => {
        if (i) lines.push([]);
        if (bit) lines[lines.length - 1].push({ ...r, text: bit });
      });
    }
    for (const line of lines) {
      const joined: typeof runs = [];
      for (const r of line) {
        const prev = joined[joined.length - 1];
        if (prev && prev.color === r.color && prev.sizePt === r.sizePt && prev.bold === r.bold && prev.italic === r.italic) prev.text += r.text;
        else joined.push({ ...r });
      }
      if (!joined.length || !joined.map((r) => r.text).join('').trim()) continue;
      joined[0].text = joined[0].text.replace(/^\s+/, '');
      joined[joined.length - 1].text = joined[joined.length - 1].text.replace(/\s+$/, '');
      out.push({
        kind: 'text',
        align,
        runs: joined.map(({ text: t, color, sizePt, bold, italic }) => ({ text: t, ...(color ? { color } : {}), ...(sizePt ? { sizePt } : {}), ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) })),
        ...(align === 'left' && Math.abs(dx + indMm) > 0.2 ? { dx: Math.round((dx + indMm) * 10) / 10 } : {}),
      });
    }
    out.push(...pictures);
  };

  const root = parseXml(xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, ''));
  const top = find(root, 'w:hdr') ?? find(root, 'w:ftr');
  if (top) blocks(top, null, 0);
  return out;
}

// ---------------------------------------------------------------- reading a letterhead

const SKIP_MEDIA = /\.(emf|wmf|svg|tiff?|bmp)$/i; // pictures a PDF can't show

/**
 * Read a letterhead from a Word file. The letterhead keeps a cut-down copy of the file – its header and footers,
 * styles and theme, but none of its text – that Word downloads are built on.
 */
export async function readLetterhead(bytes: ArrayBuffer | Uint8Array, fileName: string): Promise<Letterhead> {
  const { zip, main } = await openWord(bytes);
  const docXml = (await text(zip, main))!;
  const rels = readRels(await text(zip, relsPathOf(main)));
  const { xml: sect, all } = lastSectPr(docXml);
  const sectEl = find(parseXml(sect), 'w:sectPr');
  const pgSz = child(sectEl, 'w:pgSz');
  const pgMar = child(sectEl, 'w:pgMar');
  const mm = (attr: string, fallback: number) => Math.abs(num(pgMar?.attrs[attr]) ?? fallback / TWIP_MM) * TWIP_MM;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const portraitW = Math.min(num(pgSz?.attrs['w:w']) ?? 11906, num(pgSz?.attrs['w:h']) ?? 16838) * TWIP_MM;
  const marginsMm = { top: r1(mm('w:top', 25)), right: r1(mm('w:right', 20)), bottom: r1(mm('w:bottom', 25)), left: r1(mm('w:left', 20)), header: r1(mm('w:header', 12.5)), footer: r1(mm('w:footer', 12.5)) };
  const titlePg = !!child(sectEl, 'w:titlePg') && child(sectEl, 'w:titlePg')!.attrs['w:val'] !== '0';

  const styleRel = rels.find((r) => r.type === REL_TYPES.styles);
  const themeRel = rels.find((r) => r.type === REL_TYPES.theme);
  const stylesPath = styleRel ? resolvePath(main, styleRel.target) : undefined;
  const themePath = themeRel ? resolvePath(main, themeRel.target) : undefined;
  const stylesXml = stylesPath ? await text(zip, stylesPath) : undefined;
  const themeXml = themePath ? await text(zip, themePath) : undefined;
  const st = readStyles(stylesXml, themeXml);

  // body text and headings
  const normal = defaultStyleId(st, 'paragraph');
  const body = { ...runLook(st.defaultRun, st), ...styleLook(normal, st) };
  const headingId = ['Heading1', 'Heading2', 'Title'].find((id) => styleLook(id, st).color) ?? [...st.map.values()].find((s) => s.type === 'paragraph' && /heading/i.test(s.id) && styleLook(s.id, st).color)?.id;
  const head = headingId ? styleLook(headingId, st) : {};
  const indent = (stylePara(normal, st).ind ?? 0) * TWIP_MM;

  // the header and footer parts each page uses
  const refs = hdrFtrRefs(all);
  const partPath = (id: string | undefined) => {
    const rel = id ? rels.find((r) => r.id === id) : undefined;
    return rel ? resolvePath(main, rel.target) : undefined;
  };
  const used = new Map<string, LetterheadItem[]>();
  const pageInfo = { widthMm: portraitW, left: marginsMm.left, right: marginsMm.right };
  const itemsOf = async (path: string | undefined): Promise<LetterheadItem[]> => {
    if (!path) return [];
    if (used.has(path)) return used.get(path)!;
    const xml = await text(zip, path);
    if (!xml) return [];
    const images = new Map<string, { dataUrl: string } | null>();
    for (const r of readRels(await text(zip, relsPathOf(path)))) {
      if (r.type !== REL_TYPES.image || r.external) continue;
      const media = resolvePath(path, r.target);
      const ext = media.split('.').pop()!.toLowerCase();
      const file = zip.file(media);
      if (!file || SKIP_MEDIA.test(media) || !MEDIA_TYPES[ext] || ext === 'gif') {
        images.set(r.id, null);
        continue;
      }
      images.set(r.id, { dataUrl: `data:${MEDIA_TYPES[ext]};base64,${base64(await file.async('uint8array'))}` });
    }
    const items = partItems(xml, { st, images, page: pageInfo });
    used.set(path, items);
    return items;
  };
  const other: LetterheadPage = { header: await itemsOf(partPath(refs.header.default)), footer: await itemsOf(partPath(refs.footer.default)) };
  const first: LetterheadPage = titlePg ? { header: await itemsOf(partPath(refs.header.first)), footer: await itemsOf(partPath(refs.footer.first)) } : other;

  const docx = await letterheadOnly(zip, main, docXml, rels, sect, titlePg, refs, stylesPath, themePath);
  return {
    fileName,
    docx: `data:${DOCX_MIME};base64,${base64(docx)}`,
    marginsMm,
    ...(indent > 0.2 && indent < 30 ? { indentMm: r1(indent) } : {}),
    ...(body.font ? { font: body.font } : {}),
    ...(head.font && head.font !== body.font ? { headingFont: head.font } : {}),
    ...(body.sizePt ? { fontSize: body.sizePt } : {}),
    ...(body.color ? { textColor: body.color } : {}),
    ...(head.color ? { headingColor: head.color } : {}),
    first,
    other,
  };
}

/**
 * A Word file holding only the letterhead: an empty body with the page settings, the header and footer parts with
 * their pictures, and the styles and theme they use. Nothing from the body of the file uploaded is kept.
 */
async function letterheadOnly(
  zip: JSZip,
  main: string,
  docXml: string,
  rels: Rel[],
  sect: string,
  titlePg: boolean,
  refs: ReturnType<typeof hdrFtrRefs>,
  stylesPath: string | undefined,
  themePath: string | undefined,
): Promise<Uint8Array> {
  const out = new JSZip();
  const overrides: Array<[string, string]> = [['/word/document.xml', CT.main]];
  const defaults = new Set<string>();
  const docRels: string[] = [];
  let n = 0;
  if (stylesPath && zip.file(stylesPath)) {
    // without the numbering part, styles mustn't refer to its lists
    out.file('word/styles.xml', (await text(zip, stylesPath))!.replace(/<w:numPr>[\s\S]*?<\/w:numPr>/g, ''));
    overrides.push(['/word/styles.xml', CT.styles]);
    docRels.push(`<Relationship Id="rIdStyles" Type="${REL_TYPES.styles}" Target="styles.xml"/>`);
  }
  if (themePath && zip.file(themePath)) {
    out.file('word/theme/theme1.xml', (await text(zip, themePath))!);
    overrides.push(['/word/theme/theme1.xml', CT.theme]);
    docRels.push(`<Relationship Id="rIdTheme" Type="${REL_TYPES.theme}" Target="theme/theme1.xml"/>`);
  }
  // header and footer parts (default and first page), each once
  const copied = new Map<string, string>(); // old rel id → new rel id
  for (const kind of ['header', 'footer'] as const) {
    for (const type of ['default', 'first'] as const) {
      const id = refs[kind][type];
      if (!id || copied.has(id) || (type === 'first' && !titlePg)) continue;
      const rel = rels.find((r) => r.id === id);
      const path = rel ? resolvePath(main, rel.target) : undefined;
      const xml = path ? await text(zip, path) : undefined;
      if (!path || !xml) continue;
      const name = `${kind}${++n}.xml`;
      const newId = `rIdLh${n}`;
      copied.set(id, newId);
      out.file(`word/${name}`, xml);
      overrides.push([`/word/${name}`, kind === 'header' ? CT.header : CT.footer]);
      docRels.push(`<Relationship Id="${newId}" Type="${REL_TYPES[kind]}" Target="${name}"/>`);
      // the part's own relationships: its pictures are copied (other links are kept if external, otherwise dropped)
      const partRels: string[] = [];
      for (const r of readRels(await text(zip, relsPathOf(path)))) {
        if (r.external) partRels.push(`<Relationship Id="${escapeXml(r.id)}" Type="${escapeXml(r.type)}" Target="${escapeXml(r.target)}" TargetMode="External"/>`);
        else {
          const src = resolvePath(path, r.target);
          const file = zip.file(src);
          if (!file) continue;
          const media = `media/lh${n}-${src.split('/').pop()}`;
          out.file(`word/${media}`, await file.async('uint8array'));
          const ext = media.split('.').pop()!.toLowerCase();
          if (MEDIA_TYPES[ext]) defaults.add(ext);
          partRels.push(`<Relationship Id="${escapeXml(r.id)}" Type="${escapeXml(r.type)}" Target="${escapeXml(media)}"/>`);
        }
      }
      if (partRels.length) out.file(`word/_rels/${name}.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${partRels.join('')}</Relationships>`);
    }
  }
  // the body: one empty paragraph and the page settings, referring to the copied parts
  const refsXml = (['header', 'footer'] as const)
    .flatMap((kind) => (['default', 'first'] as const).map((type) => [kind, type, refs[kind][type]] as const))
    .filter(([, type, id]) => id && copied.has(id) && (type === 'default' || titlePg))
    .map(([kind, type, id]) => `<w:${kind}Reference w:type="${type}" r:id="${copied.get(id!)}"/>`)
    .join('');
  const sectXml = sect
    .replace(/<w:(header|footer)Reference\b[^>]*\/>/g, '')
    .replace(/<w:printerSettings\b[^>]*\/>/g, '')
    .replace(/(<w:sectPr\b[^>]*>)/, `$1${refsXml}`);
  const rootOpen = docXml.match(/<w:document\b[^>]*>/)?.[0] ?? '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
  out.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${rootOpen}<w:body><w:p/>${sectXml}</w:body></w:document>`);
  out.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${docRels.join('')}</Relationships>`);
  out.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_TYPES.officeDocument}" Target="word/document.xml"/></Relationships>`);
  out.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...defaults].map((e) => `<Default Extension="${e}" ContentType="${MEDIA_TYPES[e]}"/>`).join('')}${overrides.map(([p, c]) => `<Override PartName="${p}" ContentType="${c}"/>`).join('')}</Types>`,
  );
  return out.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// ---------------------------------------------------------------- Word downloads on the letterhead

// Order of the elements in a paragraph's and a run's properties (the Word schema requires it).
const P_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
const R_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];

/** The direct children of a properties element (`<w:pPr>…</w:pPr>`), as [local name, xml]. */
function propChildren(xml: string): Array<[string, string]> {
  const inner = xml.replace(/^<w:[pr]Pr\b[^>]*>/, '').replace(/<\/w:[pr]Pr>$/, '');
  const out: Array<[string, string]> = [];
  const re = /<w:([\w]+)\b[^>]*?(?:\/>|>[\s\S]*?<\/w:\1>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) out.push([m[1], m[0]]);
  return out;
}

/** Properties with anything they lack filled in from `extra` (e.g. the document defaults), in schema order. */
function mergeProps(own: string | undefined, extra: string | undefined, tag: 'pPr' | 'rPr'): string | undefined {
  if (!extra) return own;
  const order = tag === 'pPr' ? P_ORDER : R_ORDER;
  const mine = own ? propChildren(own) : [];
  const have = new Set(mine.map(([k]) => k));
  const all = [...mine, ...propChildren(extra).filter(([k]) => !have.has(k) && k !== 'rPr')];
  all.sort((a, b) => (order.indexOf(a[0]) + 1 || 999) - (order.indexOf(b[0]) + 1 || 999));
  return all.length ? `<w:${tag}>${all.map(([, x]) => x).join('')}</w:${tag}>` : undefined;
}

/**
 * Copy the styles that the letterhead's header and footer parts use – and the styles those are based on – into
 * the report, renamed "Lh…" so they never clash with the report's own; the letterhead's Normal (with its document
 * defaults baked in) becomes "LhNormal", which its paragraphs without a style are given.
 */
function letterheadStyles(tplStyles: string, used: Set<string>): { xml: string; ids: Map<string, string>; normal: string } {
  const blocks = new Map<string, string>();
  for (const m of tplStyles.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>[\s\S]*?<\/w:style>/g)) blocks.set(m[1], m[0]);
  const defaultPara = tplStyles.match(/<w:style\b(?=[^>]*w:type="paragraph")(?=[^>]*w:default="1")[^>]*w:styleId="([^"]+)"/)?.[1] ?? 'Normal';
  const dd = tplStyles.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)?.[0] ?? '';
  const ddR = dd.match(/<w:rPrDefault>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/)?.[1];
  const ddP = dd.match(/<w:pPrDefault>\s*(<w:pPr>[\s\S]*?<\/w:pPr>)/)?.[1];
  const want = new Set([...used, defaultPara]);
  // everything they are based on, linked to or followed by
  const queue = [...want];
  while (queue.length) {
    const id = queue.pop()!;
    const x = blocks.get(id);
    if (!x) continue;
    for (const m of x.matchAll(/<w:(?:basedOn|link|next) w:val="([^"]+)"\/>/g))
      if (!want.has(m[1]) && blocks.has(m[1])) {
        want.add(m[1]);
        queue.push(m[1]);
      }
  }
  const ids = new Map([...want].filter((id) => blocks.has(id)).map((id) => [id, `Lh${id.replace(/[^\w]/g, '')}`]));
  const rename = (id: string) => ids.get(id) ?? id;
  let xml = '';
  for (const [id, newId] of ids) {
    let x = blocks.get(id)!;
    x = x
      .replace(/ w:default="1"/, '')
      .replace(/w:styleId="[^"]+"/, `w:styleId="${newId}"`)
      .replace(/<w:name w:val="([^"]+)"\/>/, (_, nm: string) => `<w:name w:val="Letterhead ${escapeXml(unescapeXml(nm))}"/>`)
      .replace(/<w:(basedOn|link|next) w:val="([^"]+)"\/>/g, (m, k: string, v: string) => (ids.has(v) ? `<w:${k} w:val="${rename(v)}"/>` : k === 'next' ? '' : m))
      .replace(/<w:numPr>[\s\S]*?<\/w:numPr>/g, '')
      .replace(/<w:(?:semiHidden|unhideWhenUsed|qFormat|uiPriority|rsid)\b[^>]*\/>/g, '');
    if (id === defaultPara) {
      // the letterhead's own document defaults, so its header and footer look as they do in its file
      const pPr = x.match(/<w:pPr>[\s\S]*?<\/w:pPr>|<w:pPr\/>/)?.[0];
      const rPr = x.match(/<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\/>/)?.[0];
      const p2 = mergeProps(pPr === '<w:pPr/>' ? undefined : pPr, ddP, 'pPr');
      const r2 = mergeProps(rPr === '<w:rPr/>' ? undefined : rPr, ddR, 'rPr');
      x = x.replace(/<w:pPr>[\s\S]*?<\/w:pPr>|<w:pPr\/>/, '').replace(/<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\/>/, '');
      x = x.replace(/<\/w:style>$/, `${p2 ?? ''}${r2 ?? ''}</w:style>`);
    }
    xml += x;
  }
  return { xml, ids, normal: rename(defaultPara) };
}

/** A header or footer part made ready for the report: its styles renamed, unstyled paragraphs given LhNormal, links to things left behind removed. */
function adaptPart(xml: string, ids: Map<string, string>, normal: string): string {
  return (
    xml
      .replace(/<w:(pStyle|rStyle|tblStyle) w:val="([^"]+)"\/>/g, (m, k: string, v: string) => (ids.has(v) ? `<w:${k} w:val="${ids.get(v)}"/>` : k === 'tblStyle' ? m : ''))
      .replace(/<w:numPr>[\s\S]*?<\/w:numPr>/g, '')
      .replace(/<w:dataBinding\b[^>]*\/>/g, '')
      .replace(/<w:comment(?:RangeStart|RangeEnd|Reference)\b[^>]*\/>/g, '')
      // paragraphs without a style: the letterhead's Normal, as in its own file
      .replace(/<w:p(\s[^>]*)?\/>/g, (_, a: string | undefined) => `<w:p${a ?? ''}><w:pPr><w:pStyle w:val="${normal}"/></w:pPr></w:p>`)
      .replace(/<w:p(\s[^>]*)?>(?!<w:pPr)/g, (_, a: string | undefined) => `<w:p${a ?? ''}><w:pPr><w:pStyle w:val="${normal}"/></w:pPr>`)
      .replace(/(<w:p(?:\s[^>]*)?>)<w:pPr\/>/g, `$1<w:pPr><w:pStyle w:val="${normal}"/></w:pPr>`)
      .replace(/(<w:p(?:\s[^>]*)?>)<w:pPr>(?!<w:pStyle)/g, `$1<w:pPr><w:pStyle w:val="${normal}"/>`)
  );
}

/** A header or footer line as a Word paragraph: left, then centre and right at tab stops; {page} and {pages} as fields. */
export function pageLineXml(l: { left: string; center: string; right: string }, widthTwips: number, size: number): string {
  const rPr = `<w:rPr><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:color w:val="777777"/></w:rPr>`;
  const bits = (t: string) =>
    t
      .split(/(\{pages?\})/)
      .filter(Boolean)
      .map((b) => (b === '{page}' || b === '{pages}' ? `<w:fldSimple w:instr=" ${b === '{page}' ? 'PAGE' : 'NUMPAGES'} "><w:r>${rPr}<w:t>1</w:t></w:r></w:fldSimple>` : `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(b)}</w:t></w:r>`))
      .join('');
  const tab = `<w:r>${rPr}<w:tab/></w:r>`;
  return (
    `<w:p><w:pPr><w:tabs><w:tab w:val="center" w:pos="${Math.round(widthTwips / 2)}"/><w:tab w:val="right" w:pos="${Math.round(widthTwips)}"/></w:tabs><w:spacing w:before="0" w:after="0"/><w:ind w:left="0" w:right="0" w:firstLine="0"/></w:pPr>` +
    `${bits(l.left)}${l.center || l.right ? tab + bits(l.center) : ''}${l.right ? tab + bits(l.right) : ''}</w:p>`
  );
}

/** The template's own header and footer lines, to add to the letterhead's (Word paragraphs), and whether on the first page too. */
export interface LetterheadExtra {
  header?: string;
  footer?: string;
  first: boolean;
}

/**
 * Put a Word document (made by EnviroDB) on the letterhead: the header and footer parts of the letterhead's Word
 * file, with their pictures and styles, its margins, and its first-page header and footer on the first page – and the
 * template's own lines under the header and above the footer, if given.
 */
export async function applyWordLetterhead(report: Blob | ArrayBuffer | Uint8Array, letterheadDocx: string | ArrayBuffer | Uint8Array, extra?: LetterheadExtra): Promise<Blob> {
  const ours = await JSZip.loadAsync(report instanceof Blob ? await report.arrayBuffer() : report);
  const { zip: tpl, main } = await openWord(typeof letterheadDocx === 'string' ? bytesOfDataUrl(letterheadDocx) : letterheadDocx);
  const tplDoc = (await text(tpl, main))!;
  const tplRels = readRels(await text(tpl, relsPathOf(main)));
  const { xml: tplSect, all } = lastSectPr(tplDoc);
  const refs = hdrFtrRefs(all);
  const titlePg = /<w:titlePg(?![^>]*w:val="(?:0|false)")\b[^>]*\/>/.test(tplSect);
  const pgMar = tplSect.match(/<w:pgMar\b[^>]*\/>/)?.[0];

  let docXml = (await text(ours, 'word/document.xml'))!;
  let docRels = (await text(ours, 'word/_rels/document.xml.rels'))!;
  let types = (await text(ours, '[Content_Types].xml'))!;
  let styles = (await text(ours, 'word/styles.xml')) ?? '';

  // drop the report's own header and footer parts, and pictures nothing else uses
  const orphans = new Set<string>();
  for (const r of readRels(docRels).filter((x) => x.type === REL_TYPES.header || x.type === REL_TYPES.footer)) {
    const path = resolvePath('word/document.xml', r.target);
    for (const pr of readRels(await text(ours, relsPathOf(path)))) if (!pr.external) orphans.add(resolvePath(path, pr.target));
    ours.remove(path);
    ours.remove(relsPathOf(path));
    types = types.replace(new RegExp(`<Override [^>]*PartName="/${path.replace(/[.]/g, '\\.')}"[^>]*/>`), '');
    docRels = docRels.replace(new RegExp(`<Relationship [^>]*Id="${r.id}"[^>]*/>`), '');
  }
  if (orphans.size) {
    const stillUsed = new Set<string>();
    for (const name of Object.keys(ours.files).filter((f) => f.endsWith('.rels'))) {
      const owner = name.replace(/_rels\/([^/]+)\.rels$/, '$1');
      const xml = name === 'word/_rels/document.xml.rels' ? docRels : await text(ours, name);
      for (const rel of readRels(xml)) if (!rel.external) stillUsed.add(resolvePath(owner, rel.target));
    }
    for (const f of orphans) if (!stillUsed.has(f)) ours.remove(f);
  }

  // the letterhead's parts, renamed so nothing clashes
  const parts: Array<{ kind: 'header' | 'footer'; type: 'default' | 'first'; id: string }> = [];
  const partXml = new Map<string, { name: string; xml: string; id: string; kind: 'header' | 'footer'; types: Set<'default' | 'first'> }>();
  const usedStyles = new Set<string>();
  let n = 0;
  for (const kind of ['header', 'footer'] as const)
    for (const type of ['default', 'first'] as const) {
      const oldId = refs[kind][type];
      if (!oldId || (type === 'first' && !titlePg)) continue;
      const rel = tplRels.find((r) => r.id === oldId);
      const path = rel ? resolvePath(main, rel.target) : undefined;
      if (!path) continue;
      let entry = partXml.get(path);
      if (!entry) {
        const xml = await text(tpl, path);
        if (!xml) continue;
        entry = { name: `letterhead-${kind}${++n}.xml`, xml, id: `rIdLetterhead${n}`, kind, types: new Set() };
        partXml.set(path, entry);
        for (const m of xml.matchAll(/<w:(?:pStyle|rStyle|tblStyle) w:val="([^"]+)"\/>/g)) usedStyles.add(m[1]);
        // its pictures and links
        const partRels: string[] = [];
        for (const r of readRels(await text(tpl, relsPathOf(path)))) {
          if (r.external) partRels.push(`<Relationship Id="${escapeXml(r.id)}" Type="${escapeXml(r.type)}" Target="${escapeXml(r.target)}" TargetMode="External"/>`);
          else {
            const src = resolvePath(path, r.target);
            const file = tpl.file(src);
            if (!file) continue;
            const media = `media/letterhead${n}-${src.split('/').pop()}`;
            ours.file(`word/${media}`, await file.async('uint8array'));
            const ext = media.split('.').pop()!.toLowerCase();
            if (MEDIA_TYPES[ext] && !new RegExp(`<Default [^>]*Extension="${ext}"`, 'i').test(types)) types = types.replace('</Types>', `<Default Extension="${ext}" ContentType="${MEDIA_TYPES[ext]}"/></Types>`);
            partRels.push(`<Relationship Id="${escapeXml(r.id)}" Type="${escapeXml(r.type)}" Target="${escapeXml(media)}"/>`);
          }
        }
        if (partRels.length) ours.file(`word/_rels/${entry.name}.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${partRels.join('')}</Relationships>`);
        docRels = docRels.replace('</Relationships>', `<Relationship Id="${entry.id}" Type="${REL_TYPES[kind]}" Target="${entry.name}"/></Relationships>`);
        types = types.replace('</Types>', `<Override PartName="/word/${entry.name}" ContentType="${kind === 'header' ? CT.header : CT.footer}"/></Types>`);
      }
      entry.types.add(type);
      parts.push({ kind, type, id: entry.id });
    }

  // their styles, and the theme their fonts may refer to
  const tplStylesRel = tplRels.find((r) => r.type === REL_TYPES.styles);
  const tplStyles = tplStylesRel ? ((await text(tpl, resolvePath(main, tplStylesRel.target))) ?? '') : '';
  const lh = letterheadStyles(tplStyles, usedStyles);
  // the template's own lines: under the header, above the footer (on the first page only if wanted)
  const withExtra = (p: { xml: string; kind: 'header' | 'footer'; types: Set<'default' | 'first'> }) => {
    const add = extra && (p.types.has('default') || (extra.first && p.types.has('first'))) ? (p.kind === 'header' ? extra.header : extra.footer) : undefined;
    if (!add) return p.xml;
    return p.kind === 'header' ? p.xml.replace(/<\/w:hdr>\s*$/, `${add}</w:hdr>`) : p.xml.replace(/(<w:ftr\b[^>]*>)/, `$1${add}`);
  };
  for (const p of partXml.values()) ours.file(`word/${p.name}`, adaptPart(withExtra(p), lh.ids, lh.normal));
  if (lh.xml) styles = styles.replace('</w:styles>', `${lh.xml}</w:styles>`);
  const tplThemeRel = tplRels.find((r) => r.type === REL_TYPES.theme);
  if (tplThemeRel && !readRels(docRels).some((r) => r.type === REL_TYPES.theme)) {
    const theme = await text(tpl, resolvePath(main, tplThemeRel.target));
    if (theme) {
      ours.file('word/theme/theme1.xml', theme);
      docRels = docRels.replace('</Relationships>', `<Relationship Id="rIdLetterheadTheme" Type="${REL_TYPES.theme}" Target="theme/theme1.xml"/></Relationships>`);
      if (!types.includes('PartName="/word/theme/theme1.xml"')) types = types.replace('</Types>', `<Override PartName="/word/theme/theme1.xml" ContentType="${CT.theme}"/></Types>`);
    }
  }

  // every section (in document order, so the first one met is the first section): the letterhead's header, footers
  // and margins; a different first page only in the first section
  const refsXml = parts.map((p) => `<w:${p.kind}Reference w:type="${p.type}" r:id="${p.id}"/>`).join('');
  let first = true;
  docXml = docXml.replace(/<w:sectPr\b([^>]*)>([\s\S]*?)<\/w:sectPr>/g, (_, attrs: string, inner: string) => {
    let x = inner.replace(/<w:(?:header|footer)Reference\b[^>]*\/>/g, '').replace(/<w:titlePg\b[^>]*\/>/g, '');
    if (pgMar) x = x.replace(/<w:pgMar\b[^>]*\/>/, pgMar);
    if (first && titlePg) x = /<w:(?:textDirection|bidi|rtlGutter|docGrid|printerSettings)\b/.test(x) ? x.replace(/(<w:(?:textDirection|bidi|rtlGutter|docGrid|printerSettings)\b)/, '<w:titlePg/>$1') : `${x}<w:titlePg/>`;
    first = false;
    return `<w:sectPr${attrs}>${refsXml}${x}</w:sectPr>`;
  });
  ours.file('word/document.xml', docXml);
  ours.file('word/_rels/document.xml.rels', docRels);
  ours.file('[Content_Types].xml', types);
  ours.file('word/styles.xml', styles);
  return new Blob([await ours.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })], { type: DOCX_MIME });
}
