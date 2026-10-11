import { useMemo } from 'react';
import type { Parameter, Site } from '../db/types';
import { analyteMapKey, type ParsedImport, type RawResult } from './model';
import { buildParamIndex, matchParameter, matchSite, type ParamMatch } from '../lib/matching';

export interface AnalyteRow {
  key: string;
  analyte: string;
  group?: string;
  unit?: string;
  count: number;
  examples: string[];
  match: ParamMatch;
}

export interface SiteTextRow {
  siteText: string;
  count: number;
  matchId: string | null;
}

/** Distinct analytes in a parsed import with automatic parameter matches. */
export function useAnalyteRows(parsed: ParsedImport | null, params: Parameter[]): AnalyteRow[] {
  return useMemo(() => {
    if (!parsed) return [];
    const index = buildParamIndex(params);
    const map = new Map<string, AnalyteRow>();
    for (const s of parsed.samples) {
      for (const r of s.results) {
        const key = analyteMapKey(r);
        let row = map.get(key);
        if (!row) {
          row = { key, analyte: r.analyte, group: r.group, unit: r.unit, count: 0, examples: [], match: matchParameter(r.analyte, index, r.group) };
          map.set(key, row);
        }
        row.count++;
        if (row.examples.length < 3) row.examples.push(exampleText(r));
      }
    }
    return Array.from(map.values());
  }, [parsed, params]);
}

function exampleText(r: RawResult): string {
  return r.parsed.text || String(r.raw ?? '');
}

export function useSiteTextRows(parsed: ParsedImport | null, sites: Site[]): SiteTextRow[] {
  return useMemo(() => {
    if (!parsed) return [];
    const map = new Map<string, SiteTextRow>();
    for (const s of parsed.samples) {
      const t = s.siteText || s.sampleName;
      let row = map.get(t);
      if (!row) {
        const m = matchSite(t, sites);
        const m2 = m.siteId ? m : matchSite(s.sampleName, sites);
        row = { siteText: t, count: 0, matchId: m2.siteId };
        map.set(t, row);
      }
      row.count++;
    }
    return Array.from(map.values());
  }, [parsed, sites]);
}

/** Suggest a short site code from free text such as "SW1 Upstream". */
export function suggestCode(text: string): string {
  const t = text.trim();
  const m = t.match(/^([A-Za-z]{1,6}[-_ ]?\d{1,4}[A-Za-z]?)\b/);
  if (m) return m[1].replace(/\s+/g, '').toUpperCase();
  return t.length <= 16 ? t : t.slice(0, 16).trim();
}
