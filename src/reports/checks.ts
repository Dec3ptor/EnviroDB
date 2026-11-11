// Before a report is issued: what's missing or not quite ready – sites with no results in the period, rules with
// nothing to assess, commentary left as drafted, references to tables or figures that don't exist, figures sections
// with no pictures, lab jobs with no lab report on file, results nobody has reviewed, exceedances without a follow-up,
// a period not yet over. Warnings, not stops: the report can still be issued.

import type { ImportBatch, ReportTemplate } from '../db/types';
import type { ProjectBundle } from '../lib/analysis';
import { evaluateAll } from '../lib/analysis';
import { formatDate, todayStr } from '../lib/dates';
import type { ReportDoc } from './model';

export interface ReportCheck {
  level: 'warn' | 'info';
  text: string;
  /** Where to put it right: a tab of the project. */
  where?: 'data' | 'compliance' | 'reports' | 'setup' | 'schedule' | 'files';
}

export interface CheckInput {
  bundle: ProjectBundle;
  template: ReportTemplate;
  period: { start: string; end: string };
  /** The report as built now. */
  doc: ReportDoc | null;
  /** Your text for the commentary fields, by key. */
  promptTexts: Record<string, string>;
  /** Pictures added for the figures sections, by block id. */
  figures: Record<string, unknown[]>;
  /** The documents the Laboratory reports sections put in, by block id (each with the lab job it's for, in `about`). */
  attached?: Record<string, Array<{ kind: string; name: string; jobs?: string[] }>>;
  imports: ImportBatch[];
  siteIds?: string[];
  today?: string;
}

const list = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(', '));

export function preIssueChecks(x: CheckInput): ReportCheck[] {
  const out: ReportCheck[] = [];
  const today = x.today ?? todayStr();
  const { bundle: b, period } = x;
  const day = (d: string) => d.slice(0, 10);
  const inPeriod = (d: string) => day(d) >= period.start && day(d) <= period.end;

  // the period
  if (period.end > today) out.push({ level: 'warn', text: `The period ends ${formatDate(period.end)} – it isn’t over yet, so later results won’t be in the report.` });

  // sites with nothing in the period
  const sites = x.siteIds?.length ? b.sites.filter((s) => x.siteIds!.includes(s.id)) : b.sites;
  const sampled = new Set(b.samples.filter((s) => inPeriod(s.date)).map((s) => s.siteId));
  const silent = sites.filter((s) => !sampled.has(s.id));
  if (silent.length && silent.length < sites.length) out.push({ level: 'warn', text: `No results in the period at ${list(silent.map((s) => s.code))}.`, where: 'data' });
  if (sites.length && silent.length === sites.length) out.push({ level: 'warn', text: 'No results in the period at any site.', where: 'data' });

  // rules with nothing to assess, and exceedances with no follow-up
  if (b.rules.some((r) => r.active)) {
    const evals = evaluateAll(b, period.start, period.end);
    const idle = evals.filter((e) => !e.assessed).map((e) => e.rule.name);
    if (idle.length) out.push({ level: 'info', text: `Nothing to assess in the period for ${list(idle, 3)}.`, where: 'compliance' });
    const notes = new Map(b.notes.map((n) => [n.id, n]));
    let open = 0;
    for (const e of evals) for (const ex of e.exceedances) if ((notes.get(`${e.rule.id}|${ex.key}`)?.status ?? 'open') === 'open') open++;
    if (open) out.push({ level: 'info', text: `${open} exceedance${open === 1 ? ' has' : 's have'} no follow-up recorded (notified, closed).`, where: 'compliance' });
  }

  // results nobody has signed off
  const importIds = new Set(b.samples.filter((s) => inPeriod(s.date) && s.importId).map((s) => s.importId!));
  const unreviewed = x.imports.filter((i) => importIds.has(i.id) && !i.reviewed);
  if (unreviewed.length) out.push({ level: 'warn', text: `${unreviewed.length === 1 ? 'An import in the period isn’t' : `${unreviewed.length} imports in the period aren’t`} reviewed: ${list(unreviewed.map((i) => i.fileName), 2)}.`, where: 'data' });

  // the words: commentary left as drafted or blank, references to nothing
  if (x.doc) {
    const blank = x.doc.commentary.filter((c) => !(x.promptTexts[c.key] ?? '').trim() && !c.auto.trim());
    const drafted = x.doc.commentary.filter((c) => !(x.promptTexts[c.key] ?? '').trim() && c.auto.trim());
    if (blank.length) out.push({ level: 'warn', text: `Nothing written for ${list(blank.map((c) => c.label), 3)}.`, where: 'reports' });
    if (drafted.length) out.push({ level: 'info', text: `${drafted.length === 1 ? 'One commentary is' : `${drafted.length} commentaries are`} still as EnviroDB drafted ${drafted.length === 1 ? 'it' : 'them'} (${list(drafted.map((c) => c.label), 3)}).`, where: 'reports' });
    const texts: string[] = [];
    for (const n of x.doc.nodes) {
      if (n.t === 'p') texts.push(n.runs.map((r) => r.text).join(''));
      else if (n.t === 'ul') texts.push(...n.items.map((rs) => rs.map((r) => r.text).join('')));
      else if (n.t === 'h') texts.push(n.text);
      else if (n.t === 'note') texts.push(n.text);
    }
    const lost = texts.reduce((n, t) => n + (t.match(/\b(Figure|Table) \?/g)?.length ?? 0), 0);
    if (lost) out.push({ level: 'warn', text: `${lost} reference${lost === 1 ? '' : 's'} to a table or figure that isn’t in the report (shown as “Table ?” or “Figure ?”).`, where: 'reports' });
    const raw = texts.filter((t) => /\{\{[^}]*\}\}/.test(t)).length;
    if (raw) out.push({ level: 'warn', text: `${raw} placeholder${raw === 1 ? '' : 's'} left as typed ({{…}}).`, where: 'reports' });
  }

  // figures sections with no pictures
  for (const blk of x.template.blocks) {
    if (blk.type !== 'figures') continue;
    const n = (blk.images?.length ?? 0) + (x.figures[blk.id]?.length ?? 0);
    if (!n) out.push({ level: 'info', text: `The figures section${blk.label ? ` (${blk.label}s)` : ''} has no pictures yet.`, where: 'reports' });
  }

  // a Laboratory reports section: the period's lab jobs with no lab report on file
  for (const blk of x.template.blocks) {
    if (blk.type !== 'labReports' || !x.attached) continue;
    const docs = x.attached[blk.id] ?? [];
    if (blk.kinds.length && !blk.kinds.includes('results')) {
      if (!docs.length) out.push({ level: 'info', text: 'The laboratory reports section has no documents: none of the project’s files of those kinds is linked to this period’s samples or rounds.', where: 'files' });
      continue;
    }
    const have = new Set(docs.filter((d) => d.kind === 'results').flatMap((d) => d.jobs ?? []));
    const jobs = [...new Set([...b.samples, ...(b.qc?.samples ?? [])].filter((s) => inPeriod(s.date) && s.labJob && (!x.siteIds?.length || !!s.qc || x.siteIds.includes(s.siteId))).map((s) => s.labJob!.trim()))].filter(Boolean);
    const without = jobs.filter((j) => !have.has(j));
    if (without.length) out.push({ level: 'warn', text: `No lab report on file for lab job${without.length === 1 ? '' : 's'} ${list(without)} – the laboratory reports section won’t have ${without.length === 1 ? 'it' : 'them'}. Upload the lab’s PDF on the Files tab and link it to its job.`, where: 'files' });
    else if (!jobs.length && !docs.length) out.push({ level: 'info', text: 'The laboratory reports section has no documents for this period.', where: 'files' });
  }

  return out;
}

/** The checks in one line, for a button or badge. */
export function checksSummary(checks: ReportCheck[]): string {
  const w = checks.filter((c) => c.level === 'warn').length;
  const i = checks.length - w;
  if (!checks.length) return 'Ready to issue';
  return [w ? `${w} to look at` : '', i ? `${i} to note` : ''].filter(Boolean).join(', ');
}
