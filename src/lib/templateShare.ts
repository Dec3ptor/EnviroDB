// Sharing report templates beyond the team's workspace: a file with one or more templates to send to anyone using
// EnviroDB, and reading such a file back in. Analytes and guideline sets are saved by id with their names, so another
// workspace can match them by name; sites and consent rules belong to the sender's projects and are left to the
// project the report is for. A file from someone else is checked field by field – only what a template has, of the
// right kinds, and pictures only as PNG or JPEG.

import type { GuidelineSet, Parameter, ReportBlock, ReportBlockType, ReportKind, ReportTemplate } from '../db/types';
import { BLOCK_LABELS, newBlock } from '../components/report/blocks';
import { uid } from './ids';
import { APP_VERSION } from './version';

export const TEMPLATE_FILE_KIND = 'report-templates';

export interface TemplateFile {
  app: 'EnviroDB';
  kind: typeof TEMPLATE_FILE_KIND;
  v: 1;
  exported: string;
  appVersion: string;
  by?: string;
  templates: ReportTemplate[];
  /** What the templates' analytes and guideline sets are called, so another workspace can match them by name. */
  names: { parameters: Record<string, { name: string; unit?: string }>; guidelineSets: Record<string, string> };
}

export interface Library {
  params: Parameter[];
  sets: GuidelineSet[];
}

const KINDS: ReportKind[] = ['monitoring', 'letter', 'management-plan', 'investigation', 'ecology', 'other'];
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const IMAGE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

/** Analytes and guideline sets a template refers to. */
function refsOf(t: ReportTemplate): { params: Set<string>; sets: Set<string> } {
  const params = new Set<string>();
  const sets = new Set<string>();
  for (const b of t.blocks as unknown as Array<Record<string, unknown>>) {
    for (const k of ['parameterIds', 'excludeParameterIds']) if (Array.isArray(b[k])) for (const id of b[k] as string[]) params.add(id);
    if (Array.isArray(b.rows)) for (const r of b.rows as Array<{ parameterId?: string }>) if (r?.parameterId) params.add(r.parameterId);
    if (Array.isArray(b.guidelineSetIds)) for (const id of b.guidelineSetIds as string[]) sets.add(id);
  }
  return { params, sets };
}

/** The file to share: the templates (without what's only this workspace's), and the names of what they refer to. */
export function templateFile(templates: ReportTemplate[], lib: Library, opts: { signatures?: boolean; by?: string } = {}): TemplateFile {
  const names: TemplateFile['names'] = { parameters: {}, guidelineSets: {} };
  const pmap = new Map(lib.params.map((p) => [p.id, p]));
  const smap = new Map(lib.sets.map((s) => [s.id, s]));
  const out = templates.map((t) => {
    const copy: ReportTemplate = structuredClone(t);
    delete copy.builtIn;
    delete copy.starter;
    if (!opts.signatures)
      for (const b of copy.blocks)
        if (b.type === 'signatures') for (const s of b.signatories) delete s.image;
    const { params, sets } = refsOf(copy);
    for (const id of params) {
      const p = pmap.get(id);
      if (p) names.parameters[id] = { name: p.name, unit: p.unit };
    }
    for (const id of sets) {
      const s = smap.get(id);
      if (s) names.guidelineSets[id] = s.name;
    }
    return copy;
  });
  return { app: 'EnviroDB', kind: TEMPLATE_FILE_KIND, v: 1, exported: new Date().toISOString(), appVersion: APP_VERSION, by: opts.by || undefined, templates: out, names };
}

export function templateFileName(templates: ReportTemplate[]): string {
  const base = templates.length === 1 ? templates[0].name : `${templates.length} report templates`;
  return `${base.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Report template'}.envirodb-template.json`;
}

// ------------------------------------------------------------ reading a file back in

/** A JSON-safe copy of something from outside: plain values only, within limits, and pictures only as PNG or JPEG. */
function clean(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') {
    if (v.startsWith('data:')) return IMAGE.test(v) && v.length < 8_000_000 ? v : undefined;
    return v.slice(0, 20_000);
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean' || v === null) return v;
  if (depth > 6) return undefined;
  if (Array.isArray(v)) return v.slice(0, 1000).map((x) => clean(x, depth + 1)).filter((x) => x !== undefined);
  if (isObj(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const c = clean(x, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : undefined);
const num = (x: unknown, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : undefined);
const bool = (x: unknown) => (typeof x === 'boolean' ? x : undefined);
const oneOf = <T extends string>(x: unknown, list: readonly T[]) => (list.includes(x as T) ? (x as T) : undefined);
const norm = (s: string) => s.toLowerCase().replace(/[\s_()-]+/g, ' ').trim();

export interface TemplateImport {
  /** Ready to save: new ids throughout. */
  template: ReportTemplate;
  /** What was changed or left out to fit this workspace. */
  notes: string[];
}

export interface ReadContext extends Library {
  /** Names of the templates already here (an imported one with the same name gets "(imported)"). */
  names: string[];
  /** Site ids in this workspace (sites chosen in a template are kept only when they're here). */
  siteIds: Set<string>;
  hasLetterhead: boolean;
}

/** Reads a template file (or a single template) shared from EnviroDB. */
export function readTemplateFile(raw: unknown, ctx: ReadContext): TemplateImport[] {
  const file = isObj(raw) && raw.kind === TEMPLATE_FILE_KIND ? raw : isObj(raw) && Array.isArray(raw.blocks) ? { app: 'EnviroDB', kind: TEMPLATE_FILE_KIND, templates: [raw], names: {} } : null;
  if (!file || file.app !== 'EnviroDB' || !Array.isArray(file.templates)) throw new Error('This isn’t an EnviroDB report template file.');
  const names = isObj(file.names) ? file.names : {};
  const pNames = isObj(names.parameters) ? (names.parameters as Record<string, unknown>) : {};
  const sNames = isObj(names.guidelineSets) ? (names.guidelineSets as Record<string, unknown>) : {};
  const taken = new Set(ctx.names.map(norm));
  const out: TemplateImport[] = [];
  for (const rawT of file.templates.slice(0, 50)) {
    if (!isObj(rawT)) continue;
    const t = clean(rawT) as Record<string, unknown>;
    const notes = new Set<string>();
    const missingParams = new Set<string>();
    const missingSets = new Set<string>();
    let droppedSites = false;
    let droppedRules = false;

    // analytes and guideline sets: the same id here, or the same name
    const pById = new Map(ctx.params.map((p) => [p.id, p]));
    const pByName = new Map<string, string>();
    for (const p of ctx.params) for (const n of [p.name, p.short, ...(p.aliases ?? [])]) if (n && !pByName.has(norm(n))) pByName.set(norm(n), p.id);
    const param = (id: unknown): string | null => {
      if (typeof id !== 'string') return null;
      if (pById.has(id)) return id;
      const named = isObj(pNames[id]) ? str((pNames[id] as Record<string, unknown>).name, 200) : undefined;
      const match = named ? pByName.get(norm(named)) : undefined;
      if (match) return match;
      missingParams.add(named ?? id);
      return null;
    };
    const setById = new Set(ctx.sets.map((s) => s.id));
    const setByName = new Map(ctx.sets.map((s) => [norm(s.name), s.id]));
    const gset = (id: unknown): string | null => {
      if (typeof id !== 'string') return null;
      if (setById.has(id)) return id;
      const named = str(sNames[id], 300);
      const match = named ? setByName.get(norm(named)) : undefined;
      if (match) return match;
      missingSets.add(named ?? id);
      return null;
    };
    const ids = (list: unknown, f: (id: unknown) => string | null) => (Array.isArray(list) ? [...new Set(list.map(f).filter((x): x is string => !!x))] : []);

    const blocks: ReportBlock[] = [];
    for (const rb of Array.isArray(t.blocks) ? (t.blocks as unknown[]) : []) {
      if (!isObj(rb) || typeof rb.type !== 'string' || !(rb.type in BLOCK_LABELS)) continue;
      const type = rb.type as ReportBlockType;
      const base = newBlock(type) as unknown as Record<string, unknown>;
      const b: Record<string, unknown> = { ...base };
      // what the section has, of the same kinds as a new one of its type (plus the optional extras)
      for (const [k, v] of Object.entries(rb)) {
        if (k === 'id' || k === 'type') continue;
        const want = base[k];
        if (want === undefined || want === null || v === null || typeof want === typeof v) b[k] = v;
      }
      for (const k of ['parameterIds', 'excludeParameterIds']) if (k in b) b[k] = ids(b[k], param);
      if ('guidelineSetIds' in b && b.guidelineSetIds !== null) b.guidelineSetIds = ids(b.guidelineSetIds, gset);
      for (const k of ['siteIds', 'excludeSiteIds']) {
        if (!(k in b)) continue;
        const before = Array.isArray(b[k]) ? (b[k] as unknown[]).length : 0;
        b[k] = ids(b[k], (id) => (typeof id === 'string' && ctx.siteIds.has(id) ? id : null));
        if ((b[k] as string[]).length < before) droppedSites = true;
      }
      for (const k of ['upSiteId', 'downSiteId'])
        if (k in b && !(typeof b[k] === 'string' && ctx.siteIds.has(b[k] as string))) {
          delete b[k];
          droppedSites = true;
        }
      if (Array.isArray(b.ruleIds) && b.ruleIds.length) {
        b.ruleIds = [];
        droppedRules = true;
      }
      if (typeof b.overlay === 'string' && !b.overlay.startsWith('kind:')) delete b.overlay;
      if (type === 'calc')
        b.rows = (Array.isArray(b.rows) ? b.rows : []).filter(isObj).flatMap((r) => {
          const pid = param(r.parameterId);
          return pid ? [{ id: uid('c'), label: str(r.label, 300), stat: str(r.stat, 20) ?? 'median', parameterId: pid, sites: Array.isArray(r.sites) ? r.sites.filter((s): s is string => typeof s === 'string').slice(0, 50) : [] }] : [];
        });
      if (type === 'signatures')
        b.signatories = (Array.isArray(b.signatories) ? b.signatories : []).filter(isObj).map((s) => ({
          id: uid('sg'),
          role: str(s.role, 200) ?? '',
          self: bool(s.self),
          name: str(s.name, 200) ?? '',
          details: str(s.details, 2000) ?? '',
          image: typeof s.image === 'string' && IMAGE.test(s.image) ? s.image : undefined,
          date: str(s.date, 100),
        }));
      if (type === 'figures') b.images = (Array.isArray(b.images) ? b.images : []).filter((i) => isObj(i) && typeof i.src === 'string' && IMAGE.test(i.src)).map((i) => ({ id: uid('f'), src: (i as { src: string }).src, caption: str((i as Record<string, unknown>).caption, 2000) ?? '', ref: str((i as Record<string, unknown>).ref, 80) }));
      if (Array.isArray(b.calcColumns)) b.calcColumns = (b.calcColumns as unknown[]).filter(isObj).map((c) => ({ ...c, id: uid('cc') }));
      blocks.push({ ...b, id: uid('b'), type } as unknown as ReportBlock);
    }

    let name = (str(t.name, 120) ?? '').trim() || 'Imported template';
    if (taken.has(norm(name))) name = `${name} (imported)`;
    taken.add(norm(name));
    const template: ReportTemplate = {
      id: uid('tpl'),
      name,
      description: str(t.description, 1000),
      kind: oneOf(t.kind, KINDS),
      orientation: oneOf(t.orientation, ['portrait', 'landscape'] as const) ?? 'portrait',
      pageSize: oneOf(t.pageSize, ['A4', 'A3'] as const) ?? 'A4',
      marginMm: num(t.marginMm, 5, 60) ?? 20,
      fontSize: num(t.fontSize, 6, 18) ?? 10,
      accent: typeof t.accent === 'string' && /^#[0-9a-f]{6}$/i.test(t.accent) ? t.accent : '#0f766e',
      headerText: str(t.headerText, 300),
      footerText: str(t.footerText, 300),
      headerCenter: str(t.headerCenter, 300),
      headerRight: str(t.headerRight, 300),
      footerCenter: str(t.footerCenter, 300),
      footerRight: str(t.footerRight, 300),
      pageTextFirst: bool(t.pageTextFirst),
      pageTextWithLetterhead: bool(t.pageTextWithLetterhead),
      logo: typeof t.logo === 'string' && IMAGE.test(t.logo) ? t.logo : undefined,
      logoHeightMm: num(t.logoHeightMm, 5, 80),
      numbering: bool(t.numbering),
      numberHeadings: bool(t.numberHeadings),
      style: oneOf(t.style, ['report', 'letter'] as const),
      letterhead: bool(t.letterhead),
      tableHeader: oneOf(t.tableHeader, ['accent', 'grey', 'dark'] as const),
      highlightStyle: oneOf(t.highlightStyle, ['fill', 'text'] as const),
      period: oneOf(t.period, ['latestRound'] as const),
      blocks,
      updatedAt: new Date().toISOString(),
    };
    for (const k of Object.keys(template) as Array<keyof ReportTemplate>) if (template[k] === undefined) delete template[k];

    if (missingParams.size) notes.add(`${missingParams.size === 1 ? 'An analyte' : `${missingParams.size} analytes`} this workspace doesn’t have ${missingParams.size === 1 ? 'was' : 'were'} left out: ${[...missingParams].slice(0, 8).join(', ')}${missingParams.size > 8 ? '…' : ''}. Add ${missingParams.size === 1 ? 'it' : 'them'} on the Parameters page and pick ${missingParams.size === 1 ? 'it' : 'them'} in the template if you need ${missingParams.size === 1 ? 'it' : 'them'}.`);
    if (missingSets.size) notes.add(`Guideline sets this workspace doesn’t have were left out: ${[...missingSets].slice(0, 5).join(', ')} – the project’s own are used instead.`);
    if (droppedSites || droppedRules) notes.add(`Sites${droppedRules ? ' and consent rules' : ''} picked for the sender’s projects were cleared – sections use the report’s own.`);
    if (template.letterhead && !ctx.hasLetterhead) notes.add('It prints on a letterhead – add yours in Settings (until then it prints without one).');
    if (blocks.some((b) => b.type === 'signatures' && b.signatories.some((s) => !s.self && !s.image && s.name))) notes.add('Signatures of named people weren’t in the file – add them in its Signatures section if needed.');
    out.push({ template, notes: [...notes] });
  }
  if (!out.length) throw new Error('There are no templates in this file.');
  return out;
}
