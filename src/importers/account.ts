// Every result of a file accounted for before it's imported: how many go in and, for each that doesn't, why – a sample
// left out or without a site, an analyte not matched to a parameter, the same sample and parameter in the file twice.
// With what the file has that couldn't be read as a result at all, nothing is left out unsaid.

import type { Parameter, Site } from '../db/types';
import { convert } from '../lib/units';
import { formatDate } from '../lib/dates';
import { analyteMapKey, type LeftOut, type ParsedImport, type RawResult, type RawSample } from './model';

export interface AccountMapping {
  sites: Record<string, string | null | undefined>;
  dates: Record<string, string | undefined>;
  include: Record<string, boolean>;
  params: Record<string, string | null | undefined>;
  units?: Record<string, string | undefined>;
}

/** The sample a file's sample goes to: one a site a day – except at a quality control site, where each is its own, told apart by name. */
export function sampleKeyOf(siteId: string, date: string, sampleName: string | undefined, qcSites: ReadonlySet<string>): string {
  return `${siteId}|${date.slice(0, 10)}|${qcNameOf(siteId, sampleName, qcSites)}`;
}
export const qcNameOf = (siteId: string, name: string | undefined, qcSites: ReadonlySet<string>): string => (qcSites.has(siteId) ? (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() : '');

export type AccountWhy = 'unticked' | 'no-site' | 'no-date' | 'no-parameter' | 'twice';

export interface AccountLine {
  why: AccountWhy;
  /** How many of the file's results. */
  n: number;
  /** Which – the samples, or the analytes – the most affected first. */
  items: string[];
}

/** One sample and parameter in the file twice with different values: only one can be kept. */
export interface Clash {
  site: string;
  day: string;
  parameter: string;
  /** The value that goes in (the later in the file), and the one it replaces. */
  kept: string;
  dropped: string;
  /** Where each is in the file: the sample's name and the analyte's, kept then dropped. */
  from: [string, string];
}

export interface ImportAccount {
  /** Results read from the file. */
  read: number;
  /** Of those, the ones that go to a sample and a parameter. */
  going: number;
  /** Why the others don't. */
  lines: AccountLine[];
  /** Results that replace another of the file's (the same sample and parameter): with a different value, and with the same. */
  clashes: Clash[];
  repeats: number;
  /** Samples of the file that become one (the same site and day), where that makes one's results replace another's. */
  merged: Array<{ site: string; day: string; names: string[] }>;
  /** What the file has that wasn't read as a result. */
  left: LeftOut[];
}

const shown = (r: RawResult) => r.parsed.text || String(r.raw ?? '');

/** A file's results against how they're matched: what goes in and what doesn't. `keepBoth`: results already in the project and repeats are kept beside each other. */
export function accountFor(parsed: ParsedImport, mapping: AccountMapping, ctx: { sites: Site[]; params: ReadonlyMap<string, Parameter>; qcSites: ReadonlySet<string>; keepBoth?: boolean }): ImportAccount {
  const siteCode = new Map(ctx.sites.map((s) => [s.id, s.code]));
  const count = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
  const by: Record<Exclude<AccountWhy, 'twice'>, Map<string, number>> = { unticked: new Map(), 'no-site': new Map(), 'no-date': new Map(), 'no-parameter': new Map() };
  const seen = new Map<string, { sample: RawSample; result: RawResult; value: number | null }>();
  const clashes: Clash[] = [];
  const mergedNames = new Map<string, Set<string>>();
  const mergedHit = new Set<string>();
  let read = 0, going = 0, repeats = 0;
  for (const s of parsed.samples) {
    read += s.results.length;
    const label = s.sampleName || s.siteText || 'A sample';
    if (mapping.include[s.key] === false) {
      count(by.unticked, label, s.results.length);
      continue;
    }
    const siteId = mapping.sites[s.key];
    if (!siteId) {
      count(by['no-site'], s.siteText || label, s.results.length);
      continue;
    }
    const date = mapping.dates[s.key] ?? s.date;
    if (!date) {
      count(by['no-date'], label, s.results.length);
      continue;
    }
    const key = sampleKeyOf(siteId, date, s.sampleName, ctx.qcSites);
    mergedNames.set(key, (mergedNames.get(key) ?? new Set()).add(label));
    for (const r of s.results) {
      const akey = analyteMapKey(r);
      const pid = mapping.params[akey];
      if (!pid) {
        count(by['no-parameter'], r.analyte, 1);
        continue;
      }
      going++;
      if (ctx.keepBoth) continue;
      const p = ctx.params.get(pid);
      const unit = mapping.units?.[akey] ?? r.unit ?? p?.unit;
      const value = r.parsed.value === null ? null : (convert(r.parsed.value, unit, p?.unit) ?? r.parsed.value);
      const k = `${key}|${pid}`;
      const before = seen.get(k);
      if (before) {
        // the later replaces the earlier: one fewer goes in
        going--;
        const same = before.result.parsed.qualifier === r.parsed.qualifier && (before.value === value || (before.value !== null && value !== null && Math.abs(before.value - value) <= 1e-9 * Math.max(Math.abs(before.value), Math.abs(value))));
        if (same) repeats++;
        else {
          clashes.push({
            site: siteCode.get(siteId) ?? '?',
            day: date.slice(0, 10),
            parameter: p?.name ?? pid,
            kept: shown(r),
            dropped: shown(before.result),
            from: [`${label} – ${r.analyte}`, `${before.sample.sampleName || before.sample.siteText} – ${before.result.analyte}`],
          });
          if (before.sample !== s) mergedHit.add(key);
        }
      }
      seen.set(k, { sample: s, result: r, value });
    }
  }
  const order: Array<Exclude<AccountWhy, 'twice'>> = ['no-parameter', 'no-site', 'no-date', 'unticked'];
  const lines: AccountLine[] = order
    .map((why) => ({ why, n: [...by[why].values()].reduce((a, b) => a + b, 0), items: [...by[why]].sort((a, b) => b[1] - a[1]).map(([k]) => k) }))
    .filter((l) => l.n > 0);
  if (clashes.length + repeats) lines.push({ why: 'twice', n: clashes.length + repeats, items: [...new Set(clashes.map((c) => `${c.site} ${formatDate(c.day)}: ${c.parameter}`))] });
  const merged = [...mergedHit].map((key) => {
    const [siteId, day] = key.split('|');
    return { site: siteCode.get(siteId) ?? '?', day, names: [...(mergedNames.get(key) ?? [])] };
  });
  return { read, going, lines, clashes, repeats, merged, left: parsed.left ?? [] };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-NZ')} ${n === 1 ? one : many}`;
const some = (items: string[], max = 5) => `${items.slice(0, max).join(', ')}${items.length > max ? ` and ${items.length - max} more` : ''}`;

/** A line of the account in words: "12 results for analytes not matched to a parameter: pH at 25°C, Ion balance". */
export function accountText(l: AccountLine): string {
  switch (l.why) {
    case 'no-parameter':
      return `${plural(l.n, 'result')} for ${l.items.length === 1 ? 'an analyte' : `${l.items.length} analytes`} not matched to a parameter: ${some(l.items, 8)}`;
    case 'no-site':
      return `${plural(l.n, 'result')} of ${l.items.length === 1 ? 'a sample' : 'samples'} with no site chosen: ${some(l.items)}`;
    case 'no-date':
      return `${plural(l.n, 'result')} of ${l.items.length === 1 ? 'a sample' : 'samples'} with no date: ${some(l.items)}`;
    case 'unticked':
      return `${plural(l.n, 'result')} of ${l.items.length === 1 ? 'a sample' : 'samples'} you left out: ${some(l.items)}`;
    case 'twice':
      return `${plural(l.n, 'result')} in the file twice for one sample and parameter – the later is kept${l.items.length ? `: ${some(l.items)}` : ' (the same value both times)'}`;
  }
}

/** What couldn't be read, by what it says: "“TNTC” ×3 (E. coli)", for a list that stays short however long the file. */
export function leftSummary(left: LeftOut[]): Array<{ text: string; n: number; why: LeftOut['why']; where: string[] }> {
  const by = new Map<string, { text: string; n: number; why: LeftOut['why']; where: Set<string> }>();
  for (const x of left) {
    const k = `${x.why}|${x.text.toLowerCase()}`;
    const cur = by.get(k) ?? { text: x.text, n: 0, why: x.why, where: new Set<string>() };
    cur.n++;
    const where = [x.sample, x.analyte].filter(Boolean).join(' – ');
    if (where && cur.where.size < 6) cur.where.add(where);
    by.set(k, cur);
  }
  return [...by.values()].sort((a, b) => b.n - a.n).map((x) => ({ ...x, where: [...x.where] }));
}

/** Why something wasn't read, in words. */
export const LEFT_WHY: Record<LeftOut['why'], string> = {
  unreadable: 'not a number or a detection limit',
  'no-test': 'results in the PDF with no test beside them',
  'two-values': 'two values under one sample in the PDF',
  'no-sample': 'no sample to go to',
};
