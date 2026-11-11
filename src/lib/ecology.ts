// Ecology surveys worked out: how many taxa and how many of each, how evenly they're spread (Shannon, Simpson), and
// for stream invertebrates the mayflies, stoneflies and caddisflies (EPT) and the Macroinvertebrate Community Index –
// MCI from which taxa are there, QMCI from how many of each (SQMCI when they're counted in coded abundances). The
// tolerance scores come from the team's taxa list; EnviroDB has none of its own.

import type { EcoCode, EcoKind, EcoRecord, EcoSurvey, Taxon } from '../db/types';
import { formatDate } from './dates';
import { parseBlock } from './pasteBlock';
import { parseValue } from './values';

/** A taxon's name as it's matched: lower case, one space between words. */
export const taxonKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * How many a coded abundance stands for in the semi-quantitative MCI (Stark 1998): rare 1, common 5, abundant 20,
 * very abundant 100, very very abundant 500.
 */
export const CODE_COUNT: Record<EcoCode, number> = { R: 1, C: 5, A: 20, VA: 100, VVA: 500 };
export const CODE_TEXT: Record<EcoCode, string> = { R: 'Rare (1–4)', C: 'Common (5–19)', A: 'Abundant (20–99)', VA: 'Very abundant (100–499)', VVA: 'Very very abundant (500+)' };

/** The orders that make up EPT. */
const EPT_GROUPS = /^(ephemeroptera|plecoptera|trichoptera|mayfl(y|ies)|stonefl(y|ies)|caddisfl(y|ies)|caddis)$/i;

export type TaxaList = ReadonlyMap<string, Taxon>;

/** How a record counts: its number, its coded abundance as a number, or one for something only noted as there. */
export const recordCount = (r: Pick<EcoRecord, 'n' | 'code'>): number => (typeof r.n === 'number' && Number.isFinite(r.n) ? Math.max(0, r.n) : r.code ? CODE_COUNT[r.code] : 1);

/** How a survey's records are counted: by number, by coded abundance, or only noted as present (mixed: by what each has). */
export function countsOf(records: EcoRecord[]): 'counts' | 'coded' | 'presence' | 'mixed' | 'none' {
  if (!records.length) return 'none';
  const n = records.filter((r) => typeof r.n === 'number').length;
  const c = records.filter((r) => typeof r.n !== 'number' && r.code).length;
  if (n === records.length) return 'counts';
  if (c === records.length) return 'coded';
  if (!n && !c) return 'presence';
  return 'mixed';
}

/** The records with one line a taxon (the same taxon entered twice is added up). */
export function mergedRecords(records: EcoRecord[]): EcoRecord[] {
  const by = new Map<string, EcoRecord>();
  for (const r of records) {
    const k = taxonKey(r.taxon);
    if (!k) continue;
    const cur = by.get(k);
    if (!cur) by.set(k, { ...r, taxon: r.taxon.trim() });
    else if (typeof cur.n === 'number' || typeof r.n === 'number') by.set(k, { ...cur, n: (typeof cur.n === 'number' ? cur.n : recordCount(cur)) + (typeof r.n === 'number' ? r.n : recordCount(r)), code: undefined });
    else if (r.code && (!cur.code || CODE_COUNT[r.code] > CODE_COUNT[cur.code])) by.set(k, { ...cur, code: r.code });
  }
  return [...by.values()];
}

export interface EcoIndices {
  /** How many taxa. */
  richness: number;
  /** How many individuals (coded abundances as the numbers they stand for) – null when taxa were only noted as present. */
  total: number | null;
  /** Shannon's diversity H′ (natural log) and Pielou's evenness J′ = H′ / ln S – null without numbers. */
  shannon: number | null;
  evenness: number | null;
  /** Simpson's diversity 1 − Σp². */
  simpson: number | null;
  /** The commonest taxon and its share of the individuals. */
  dominant: { taxon: string; share: number } | null;
  /** Mayflies, stoneflies and caddisflies: how many taxa, their share of the taxa and of the individuals. */
  ept: { taxa: number; taxaShare: number; share: number | null } | null;
  /** MCI: 20 × the mean tolerance score of the taxa that have one. */
  mci: number | null;
  /** QMCI (SQMCI from coded abundances): the mean tolerance score weighted by how many of each. */
  qmci: number | null;
  /** Which it is, by how the survey was counted. */
  qmciKind: 'QMCI' | 'SQMCI' | null;
  /** How many of the taxa have a tolerance score – the indices are of those. */
  scored: number;
  /** The taxa with no score (left out of the MCI and QMCI). */
  unscored: string[];
  /** Counts are coded abundances or mixed: the diversity figures are approximate. */
  approximate: boolean;
}

/** Whether a taxon counts for EPT: as its entry in the taxa list says, else by its group. */
export const isEpt = (t: Pick<Taxon, 'ept' | 'group'> | undefined): boolean => (t?.ept !== undefined ? t.ept : !!t?.group && EPT_GROUPS.test(t.group.trim()));

/** A taxon's tolerance score for the stream's bed (a soft-bottomed stream takes the hard-bottom score where it has no other). */
export const scoreOf = (t: Pick<Taxon, 'mci' | 'mciSb'> | undefined, bed: 'hard' | 'soft' = 'hard'): number | undefined => {
  const v = bed === 'soft' ? (t?.mciSb ?? t?.mci) : t?.mci;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

/** A survey's indices, from its records and the team's taxa list. */
export function ecoIndices(survey: Pick<EcoSurvey, 'records' | 'bed'>, taxa: TaxaList): EcoIndices {
  const records = mergedRecords(survey.records);
  const how = countsOf(records);
  const numbered = how !== 'presence' && how !== 'none';
  const counts = records.map(recordCount);
  const total = numbered ? counts.reduce((s, n) => s + n, 0) : null;
  let shannon: number | null = null;
  let simpson: number | null = null;
  let dominant: EcoIndices['dominant'] = null;
  if (total && total > 0) {
    let h = 0;
    let d = 0;
    let top = 0;
    counts.forEach((n, i) => {
      const p = n / total;
      if (p > 0) h -= p * Math.log(p);
      d += p * p;
      if (counts[i] > counts[top]) top = i;
    });
    shannon = h;
    simpson = 1 - d;
    dominant = { taxon: records[top].taxon, share: counts[top] / total };
  }
  const S = records.length;
  const eptRecords = records.map((r, i) => ({ r, n: counts[i] })).filter(({ r }) => isEpt(taxa.get(taxonKey(r.taxon))));
  // any of the survey's taxa in the list with a group or an EPT mark: enough to say how many are EPT
  const grouped = records.some((r) => {
    const t = taxa.get(taxonKey(r.taxon));
    return t?.ept !== undefined || !!t?.group;
  });
  const scores = records.map((r) => scoreOf(taxa.get(taxonKey(r.taxon)), survey.bed));
  const scoredAt = scores.map((s, i) => (s === undefined ? -1 : i)).filter((i) => i >= 0);
  const mci = scoredAt.length ? (20 * scoredAt.reduce((s, i) => s + scores[i]!, 0)) / scoredAt.length : null;
  const scoredTotal = scoredAt.reduce((s, i) => s + counts[i], 0);
  const qmci = numbered && scoredAt.length && scoredTotal > 0 ? scoredAt.reduce((s, i) => s + counts[i] * scores[i]!, 0) / scoredTotal : null;
  return {
    richness: S,
    total,
    shannon,
    evenness: shannon !== null && S > 1 ? shannon / Math.log(S) : null,
    simpson,
    dominant,
    ept: S && grouped ? { taxa: eptRecords.length, taxaShare: eptRecords.length / S, share: total ? eptRecords.reduce((s, x) => s + x.n, 0) / total : null } : null,
    mci,
    qmci,
    qmciKind: qmci === null ? null : how === 'counts' ? 'QMCI' : 'SQMCI',
    scored: scoredAt.length,
    unscored: records.filter((_, i) => scores[i] === undefined).map((r) => r.taxon),
    approximate: how === 'coded' || how === 'mixed',
  };
}

// ------------------------------------------------------------ records pasted in

const CODES = new Map<string, EcoCode>([['r', 'R'], ['c', 'C'], ['a', 'A'], ['va', 'VA'], ['vva', 'VVA'], ['rare', 'R'], ['common', 'C'], ['abundant', 'A'], ['very abundant', 'VA'], ['very very abundant', 'VVA']]);

/**
 * Records pasted from a spreadsheet or typed a line each: a taxon, then how many – a number, a coded abundance (R, C,
 * A, VA, VVA), or nothing (present) – then a note. A heading row ("Taxon", "Count") is skipped; so are empty lines.
 */
export function parseRecords(text: string): { records: EcoRecord[]; skipped: string[] } {
  const records: EcoRecord[] = [];
  const skipped: string[] = [];
  // tabs from a spreadsheet; otherwise a comma, or the last run of spaces before a number or a code
  const rows = /\t/.test(text)
    ? parseBlock(text)
    : text
        .split(/\r?\n/)
        .map((line) => {
          const t = line.trim();
          if (!t) return [];
          if (t.includes(',')) return t.split(',').map((c) => c.trim());
          const m = /^(.*\S)\s+(\d[\d.,]*|R|C|A|VA|VVA)$/i.exec(t);
          return m ? [m[1], m[2]] : [t];
        });
  for (const cells of rows) {
    const name = (cells[0] ?? '').trim();
    if (!name) continue;
    const how = (cells[1] ?? '').trim();
    if (/^(taxon|taxa|species|name|scientific name)$/i.test(name) && (!how || !/^\d/.test(how))) continue;
    // a line that's only a number isn't a taxon
    if (/^[\d.,\s]+$/.test(name)) {
      skipped.push(name);
      continue;
    }
    const rec: EcoRecord = { taxon: name };
    const code = CODES.get(how.toLowerCase());
    const v = how ? parseValue(how).value : null;
    if (code) rec.code = code;
    else if (v !== null && v >= 0) rec.n = v;
    else if (how && !/^(p|present|x|✓|yes|y|\+)$/i.test(how)) rec.note = how;
    const note = (cells[2] ?? '').trim();
    if (note) rec.note = rec.note ? `${rec.note}; ${note}` : note;
    records.push(rec);
  }
  return { records, skipped };
}

/**
 * A taxa list pasted from a spreadsheet: a taxon a line with, in any order under headings, its group, its tolerance
 * score for hard-bottomed streams and for soft-bottomed ones, a common name and its status. Without headings: taxon,
 * hard-bottom score, soft-bottom score.
 */
export function parseTaxa(text: string): { taxa: Taxon[]; skipped: string[] } {
  const rows = parseBlock(/\t/.test(text) ? text : text.replace(/,/g, '\t')).filter((r) => r.some((c) => c.trim()));
  if (!rows.length) return { taxa: [], skipped: [] };
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  const heads = rows[0].map(norm);
  const find = (re: RegExp) => heads.findIndex((h) => re.test(h));
  const hasHead = find(/^(taxon|taxa|species|name|scientific name)$/) >= 0;
  const col = hasHead
    ? { name: find(/^(taxon|taxa|species|name|scientific name)$/), group: find(/^(group|order|class|family|higher taxon)$/), mci: find(/^(mci|mci hb|hb|hard|hard bottom|mci hard|tolerance|score|tolerance score|mci score)$/), mciSb: find(/^(mci sb|sb|soft|soft bottom|mci soft)$/), common: find(/^(common|common name)$/), status: find(/^(status|threat|threat status|conservation status|native)$/) }
    : { name: 0, group: -1, mci: 1, mciSb: 2, common: -1, status: -1 };
  const taxa: Taxon[] = [];
  const skipped: string[] = [];
  const score = (s: string | undefined) => {
    const v = s === undefined || !s.trim() ? null : parseValue(s).value;
    return v !== null && v >= 0 && v <= 10 ? v : undefined;
  };
  for (const r of rows.slice(hasHead ? 1 : 0)) {
    const name = (r[col.name] ?? '').trim();
    if (!name || /^[\d.,\s]+$/.test(name)) {
      if (name) skipped.push(name);
      continue;
    }
    const t: Taxon = { id: taxonKey(name), name };
    const at = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    if (at(col.group)) t.group = at(col.group);
    if (score(r[col.mci]) !== undefined && col.mci >= 0) t.mci = score(r[col.mci]);
    if (score(r[col.mciSb]) !== undefined && col.mciSb >= 0) t.mciSb = score(r[col.mciSb]);
    if (at(col.common)) t.common = at(col.common);
    if (at(col.status)) t.status = at(col.status);
    taxa.push(t);
  }
  return { taxa, skipped };
}

// ------------------------------------------------------------ a table of taxa down and samples across

export interface PastedTable {
  /** Each column of counts: its heading (a site, a sample number) and what it found. */
  columns: Array<{ header: string; records: EcoRecord[] }>;
  /** The taxa's groups and common names, where the table gives them. */
  taxa: Taxon[];
  /** Rows left out: no taxon, or a total or an index worked out at the foot of the table. */
  skipped: number;
}

const TAXON_HEAD = /^(scientific ?name|taxon|taxa|species|name)$/i;
const GROUP_HEAD = /^(group|order|class|family|phylum|higher taxon)$/i;
const COMMON_HEAD = /^(common ?name|common)$/i;
/** Columns that describe the taxon rather than count it (a lab's or an eDNA report's). */
const OTHER_HEAD = /^(sequence|target|rank|tax ?id|mci|mci ?-?(hb|sb)|tolerance|score|status|notes?|comments?)$/i;
/** Rows at the foot of a results table that aren't taxa. */
const SUMMARY_ROW = /^(total|totals|sum|count|abundance|total abundance|number of taxa|no\.? of taxa|taxa richness|taxon richness|richness|mci|mci-(hb|sb)|qmci|sqmci|qmci-(hb|sb)|sqmci-(hb|sb)|aspm|%? ?ept.*|ept.*)$/i;
const PRESENT = /^(p|present|x|✓|yes|y|\+)$/i;

/**
 * A results table pasted from a spreadsheet – taxa down, a column of counts for each site or sample across, as a
 * taxonomist's or an eDNA lab's results come: each column's records, and the taxa's groups and common names where the
 * table has columns for them. A taxon on several rows (a row a DNA sequence) is added up. Null when it isn't such a
 * table (fewer than two rows, or no column of counts).
 */
export function parseTable(text: string): PastedTable | null {
  const rows = parseBlock(text).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) return null;
  const head = rows[0].map((h) => h.trim());
  const width = Math.max(...rows.map((r) => r.length));
  let nameCol = head.findIndex((h) => TAXON_HEAD.test(h));
  if (nameCol < 0) nameCol = 0;
  const groupCol = head.findIndex((h, i) => i !== nameCol && GROUP_HEAD.test(h));
  const commonCol = head.findIndex((h, i) => i !== nameCol && COMMON_HEAD.test(h));
  const body = rows.slice(1);
  const isCount = (c: string) => c === '' || CODES.has(c.toLowerCase()) || PRESENT.test(c) || parseValue(c).value !== null;
  const countCols: number[] = [];
  for (let c = 0; c < width; c++) {
    if (c === nameCol || c === groupCol || c === commonCol || OTHER_HEAD.test(head[c] ?? '')) continue;
    const cells = body.map((r) => (r[c] ?? '').trim());
    const filled = cells.filter((x) => x !== '');
    // a column of counts: something in it, and nearly all of it numbers or codes
    if (filled.length && filled.filter(isCount).length >= filled.length * 0.8) countCols.push(c);
  }
  if (!countCols.length) return null;
  const columns = countCols.map((c) => ({ header: head[c] || `Column ${c + 1}`, records: [] as EcoRecord[] }));
  const taxa = new Map<string, Taxon>();
  let skipped = 0;
  for (const r of body) {
    const name = (r[nameCol] ?? '').trim();
    if (!name || SUMMARY_ROW.test(name) || /^[\d.,\s]+$/.test(name)) {
      skipped++;
      continue;
    }
    const group = groupCol >= 0 ? (r[groupCol] ?? '').trim() : '';
    const common = commonCol >= 0 ? (r[commonCol] ?? '').trim() : '';
    if ((group || common) && !taxa.has(taxonKey(name))) taxa.set(taxonKey(name), { id: taxonKey(name), name, ...(group ? { group } : {}), ...(common ? { common } : {}) });
    countCols.forEach((c, i) => {
      const cell = (r[c] ?? '').trim();
      if (!cell) return;
      const code = CODES.get(cell.toLowerCase());
      const v = parseValue(cell).value;
      if (code) columns[i].records.push({ taxon: name, code });
      else if (v !== null && v > 0) columns[i].records.push({ taxon: name, n: v });
      else if (PRESENT.test(cell)) columns[i].records.push({ taxon: name });
    });
  }
  for (const col of columns) col.records = mergedRecords(col.records);
  return { columns: columns.filter((c) => c.records.length), taxa: [...taxa.values()], skipped };
}

// ------------------------------------------------------------ out again

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const round = (v: number | null, dp: number) => (v === null ? '' : Number(v.toFixed(dp)));

/** Every record of some surveys, a line each: for a spreadsheet. */
export function recordsCsv(surveys: EcoSurvey[], siteCode: (id: string | undefined) => string, taxa: TaxaList): string {
  const rows: unknown[][] = [['Date', 'Site', 'Survey', 'Method', 'Taxon', 'Group', 'Count', 'Coded abundance', 'Note']];
  for (const s of [...surveys].sort((a, b) => a.date.localeCompare(b.date)))
    for (const r of s.records) rows.push([s.date, siteCode(s.siteId) || s.place || '', s.kind, s.method ?? '', r.taxon, taxa.get(taxonKey(r.taxon))?.group ?? '', r.n ?? '', r.code ?? '', r.note ?? '']);
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** The surveys' indices, a line each. */
export function indicesCsv(surveys: EcoSurvey[], siteCode: (id: string | undefined) => string, taxa: TaxaList): string {
  const rows: unknown[][] = [['Date', 'Site', 'Survey', 'Method', 'Taxa', 'Individuals', 'Shannon H', 'Evenness J', 'Simpson 1-D', 'EPT taxa', '% EPT taxa', '% EPT individuals', 'MCI', 'QMCI / SQMCI', 'Taxa scored', 'Scores from']];
  for (const s of [...surveys].sort((a, b) => a.date.localeCompare(b.date))) {
    const x = ecoIndices(s, taxa);
    rows.push([s.date, siteCode(s.siteId) || s.place || '', s.kind, s.method ?? '', x.richness, x.total ?? '', round(x.shannon, 3), round(x.evenness, 3), round(x.simpson, 3), x.ept?.taxa ?? '', x.ept ? round(x.ept.taxaShare * 100, 1) : '', x.ept?.share !== null && x.ept ? round(x.ept.share! * 100, 1) : '', round(x.mci, 1), round(x.qmci, 2), x.scored, s.scores ?? '']);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ------------------------------------------------------------ for a report

const STREAM: EcoKind = 'Stream invertebrates';

/** The surveys of a period (and of some kinds – every kind when none are named), the earliest first, by site within a day. */
export function surveysIn(surveys: EcoSurvey[], start: string, end: string, kinds: readonly EcoKind[] | undefined, siteCode: (id: string | undefined) => string): EcoSurvey[] {
  const where = (s: EcoSurvey) => siteCode(s.siteId) || s.place || '';
  return surveys
    .filter((s) => s.date >= start && s.date <= end && (!kinds?.length || kinds.includes(s.kind)))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : where(a).localeCompare(where(b), undefined, { numeric: true }) || (a.id < b.id ? -1 : 1)));
}

/** A table for a report: its heading, which columns are numbers, its lines, the lines that sum it up, and what's said under it. */
export interface EcoTable {
  head: string[];
  numeric: boolean[];
  rows: string[][];
  foot: string[][];
  notes: string[];
}

const whole = (v: number) => Math.round(v).toLocaleString('en-NZ');
const share = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);

/** What's said under a table with the stream invertebrate indices in it. */
function streamNotes(surveys: EcoSurvey[], all: EcoIndices[]): string[] {
  const at = surveys.map((s, i) => (s.kind === STREAM ? i : -1)).filter((i) => i >= 0);
  if (!at.length) return [];
  const notes = ['EPT: mayflies, stoneflies and caddisflies (Ephemeroptera, Plecoptera and Trichoptera). MCI: Macroinvertebrate Community Index – 20 × the mean tolerance score of the taxa found. QMCI: the tolerance scores weighted by how many of each taxon were found.'];
  if (at.some((i) => all[i].qmciKind === 'SQMCI')) notes.push('Where abundances were coded (R, C, A, VA, VVA – taken as 1, 5, 20, 100 and 500), the weighted index is the semi-quantitative SQMCI.');
  const from = [...new Set(at.map((i) => surveys[i].scores?.trim()).filter((x): x is string => !!x))];
  if (from.length) notes.push(`Tolerance scores: ${from.join('; ')}.`);
  if (at.some((i) => surveys[i].bed === 'soft') && at.some((i) => surveys[i].bed !== 'soft')) notes.push('Soft-bottomed streams are scored with the soft-bottom tolerance scores.');
  else if (at.every((i) => surveys[i].bed === 'soft')) notes.push('Soft-bottom tolerance scores were used.');
  const unscored = [...new Set(at.flatMap((i) => all[i].unscored))].sort((a, b) => a.localeCompare(b));
  if (unscored.length && at.some((i) => all[i].scored > 0)) notes.push(`Left out of the MCI and QMCI, having no tolerance score: ${unscored.slice(0, 12).join(', ')}${unscored.length > 12 ? ` and ${unscored.length - 12} more` : ''}.`);
  return notes;
}

/** Some surveys, a line each with what it works out to – for a report's table. */
export function indicesTable(surveys: EcoSurvey[], siteCode: (id: string | undefined) => string, taxa: TaxaList): EcoTable {
  const all = surveys.map((s) => ecoIndices(s, taxa));
  const anyStream = surveys.some((s) => s.kind === STREAM);
  const manyKinds = new Set(surveys.map((s) => s.kind)).size > 1;
  const head = ['Date', 'Site', ...(manyKinds ? ['Survey'] : []), 'Taxa', 'Individuals', 'H′', ...(anyStream ? ['EPT taxa', '% EPT taxa', 'MCI', 'QMCI'] : [])];
  const numeric = [false, false, ...(manyKinds ? [false] : []), true, true, true, ...(anyStream ? [true, true, true, true] : [])];
  const rows = surveys.map((s, i) => {
    const x = all[i];
    const st = s.kind === STREAM;
    return [
      formatDate(s.date),
      siteCode(s.siteId) || s.place || '–',
      ...(manyKinds ? [s.kind] : []),
      String(x.richness),
      x.total === null ? '–' : whole(x.total),
      x.shannon === null ? '–' : x.shannon.toFixed(2),
      ...(anyStream ? [st && x.ept ? String(x.ept.taxa) : '–', st && x.ept ? share(x.ept.taxaShare) : '–', st && x.mci !== null ? x.mci.toFixed(0) : '–', st && x.qmci !== null ? `${x.qmci.toFixed(2)}${x.qmciKind === 'SQMCI' ? '*' : ''}` : '–'] : []),
    ];
  });
  const notes = ['Taxa: how many kinds were found. H′: Shannon’s diversity index (natural logarithm) – higher with more taxa, more evenly spread.'];
  const sq = all.some((x, i) => surveys[i].kind === STREAM && x.qmciKind === 'SQMCI');
  const coded = surveys.some((s) => s.records.some((r) => typeof r.n !== 'number' && r.code));
  const noted = surveys.some((s, i) => all[i].total !== null && s.records.some((r) => typeof r.n !== 'number' && !r.code));
  const rough = [coded && 'abundances were coded', noted && 'a taxon was only noted as present (counted as one)'].filter(Boolean).join(', or ');
  if (sq || rough) notes.push([sq && '* SQMCI.', rough && `Individuals and H′ are approximate where ${rough}.`].filter(Boolean).join(' '));
  notes.push(...streamNotes(surveys, all));
  return { head, numeric, rows, foot: [], notes };
}

/**
 * What some surveys found, a line a taxon and a column a survey (by group, then by name) – with the number of taxa
 * and, for stream invertebrates, EPT, the MCI and the QMCI at the foot.
 */
export function taxaTable(surveys: EcoSurvey[], siteCode: (id: string | undefined) => string, taxa: TaxaList): EcoTable {
  const all = surveys.map((s) => ecoIndices(s, taxa));
  const merged = surveys.map((s) => new Map(mergedRecords(s.records).map((r) => [taxonKey(r.taxon), r])));
  const names = new Map<string, string>();
  for (const m of merged) for (const [k, r] of m) if (!names.has(k)) names.set(k, taxa.get(k)?.name ?? r.taxon);
  const groupOf = (k: string) => taxa.get(k)?.group?.trim() ?? '';
  const keys = [...names.keys()].sort((a, b) => (groupOf(a) || '\uffff').localeCompare(groupOf(b) || '\uffff') || names.get(a)!.localeCompare(names.get(b)!));
  const grouped = keys.some((k) => groupOf(k));
  const head = ['Taxon', ...(grouped ? ['Group'] : []), ...surveys.map((s) => `${siteCode(s.siteId) || s.place || '–'}\n${formatDate(s.date)}`)];
  const numeric = [false, ...(grouped ? [false] : []), ...surveys.map(() => true)];
  const cell = (r: EcoRecord | undefined) => (!r ? '' : typeof r.n === 'number' ? whole(r.n) : (r.code ?? 'P'));
  const rows = keys.map((k) => [names.get(k)!, ...(grouped ? [groupOf(k)] : []), ...merged.map((m) => cell(m.get(k)))]);
  const pad = (label: string, cells: string[]) => [label, ...(grouped ? [''] : []), ...cells];
  const foot = [pad('Number of taxa', all.map((x) => String(x.richness)))];
  const st = surveys.map((s) => s.kind === STREAM);
  if (st.some(Boolean)) {
    if (all.some((x, i) => st[i] && x.ept)) foot.push(pad('EPT taxa', all.map((x, i) => (st[i] && x.ept ? String(x.ept.taxa) : '–'))));
    if (all.some((x, i) => st[i] && x.mci !== null)) {
      foot.push(pad('MCI', all.map((x, i) => (st[i] && x.mci !== null ? x.mci.toFixed(0) : '–'))));
      foot.push(pad('QMCI', all.map((x, i) => (st[i] && x.qmci !== null ? `${x.qmci.toFixed(2)}${x.qmciKind === 'SQMCI' ? '*' : ''}` : '–'))));
    }
  }
  const notes: string[] = [];
  const how = new Set(merged.flatMap((m) => [...m.values()].map((r) => (typeof r.n === 'number' ? 'n' : r.code ? 'code' : 'p'))));
  if (how.has('code')) notes.push('Coded abundances: R rare (1–4), C common (5–19), A abundant (20–99), VA very abundant (100–499), VVA very very abundant (500 or more).');
  if (how.has('p')) notes.push('P: present (not counted).');
  if (all.some((x, i) => st[i] && x.qmciKind === 'SQMCI')) notes.push('* SQMCI.');
  notes.push(...streamNotes(surveys, all));
  return { head, numeric, rows, foot, notes };
}
