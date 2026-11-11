// An exceedance notice: the email to the council (or whoever the consent says to tell) when a limit or trigger is
// exceeded – what was found, where and when, the limit and the condition it comes from, and what the consent says
// must be done. Written from the exceedances themselves, to copy into an email; nothing is sent by EnviroDB.

import type { ExceedanceNote, Parameter, Project, Rule, Sample, Site } from '../db/types';
import type { Exceedance } from './compliance';
import { formatDate } from './dates';
import { unitLabel } from './units';
import { fmtNum } from './values';

export interface NoticeItem {
  rule: Pick<Rule, 'id' | 'name' | 'level' | 'condition' | 'action'>;
  ex: Exceedance;
  note?: Pick<ExceedanceNote, 'text' | 'status' | 'notifiedOn'>;
}

export interface NoticeContext {
  project: Pick<Project, 'name' | 'code' | 'client' | 'consents' | 'regulator' | 'recipient' | 'salutation' | 'location'>;
  site: (id: string) => Pick<Site, 'code' | 'name'> | undefined;
  param: (id: string) => Pick<Parameter, 'name'> | undefined;
  /** The sample a result is from, for the lab and its job number. */
  sampleOf?: (resultId: string) => Pick<Sample, 'labName' | 'labJob' | 'date'> | undefined;
  author?: string;
  company?: string;
}

export interface Notice {
  subject: string;
  body: string;
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const value = (ex: Exceedance) => `${ex.value === null ? '' : `${ex.qualifier}${fmtNum(ex.value)}`}${ex.unit === '%' ? '%' : ` ${unitLabel(ex.unit)}`}`.trim();

/** The conditions the exceedances come under ("Condition 8(a) and Condition 10"), as the rules give them. */
function conditions(items: NoticeItem[]): string {
  return list([...new Set(items.map((i) => i.rule.condition?.trim()).filter((c): c is string => !!c))]);
}

/**
 * The notice for these exceedances – usually one sampling day's. Plain text: a subject, and a body that says who is
 * notifying under which condition, each exceedance with its limit and required action, the lab's job, and what's been
 * done so far (from the follow-up notes), with a place to add more.
 */
export function exceedanceNotice(items: NoticeItem[], ctx: NoticeContext): Notice {
  const p = ctx.project;
  const sorted = [...items].sort((a, b) => a.ex.date.localeCompare(b.ex.date) || (ctx.site(a.ex.siteId)?.code ?? '').localeCompare(ctx.site(b.ex.siteId)?.code ?? ''));
  const days = [...new Set(sorted.map((i) => i.ex.date.slice(0, 10)))];
  const sites = [...new Set(sorted.map((i) => ctx.site(i.ex.siteId)?.code ?? '').filter(Boolean))];
  const many = sorted.length > 1;
  const limits = sorted.some((i) => /limit/i.test(i.rule.level));
  const what = limits ? `exceedance${many ? 's' : ''}` : `trigger level${many ? 's' : ''} exceeded`;
  const when = days.length === 1 ? formatDate(days[0]) : `${formatDate(days[0])} – ${formatDate(days[days.length - 1])}`;
  const subject = [`Notification of ${what}`, p.name, p.consents ? `consent ${p.consents}` : '', `${list(sites)} ${when}`.trim()].filter(Boolean).join(' – ');

  const cond = conditions(sorted);
  const who = ctx.company || p.client || 'we';
  const onBehalf = ctx.company && p.client && ctx.company !== p.client ? `, on behalf of ${p.client},` : '';
  const L: string[] = [];
  L.push(p.salutation?.trim() || (p.regulator ? `To ${p.regulator},` : 'Kia ora,'), '');
  L.push(
    `${cond ? `As required by ${cond} of` : 'Under'} ${p.consents ? `resource consent ${p.consents}` : 'the resource consent'}${p.name ? ` (${p.name}${p.location ? `, ${p.location}` : ''})` : ''}, ${who}${onBehalf} ${who === 'we' ? 'advise' : 'advises'} that monitoring on ${when} found ${
      many ? `${sorted.length} exceedances of ${limits ? 'consent limits or trigger levels' : 'trigger levels'}` : `a result above a ${limits ? 'consent limit' : 'trigger level'}`
    }:`,
    '',
  );
  for (const { rule, ex } of sorted) {
    const site = ctx.site(ex.siteId);
    const s = ex.resultId ? ctx.sampleOf?.(ex.resultId) : undefined;
    const time = /T\d{2}:\d{2}/.test(ex.date) ? ` at ${ex.date.slice(11, 16)}` : '';
    L.push(`- ${site ? `${site.code}${site.name ? ` (${site.name})` : ''}` : 'Site'}, sampled ${formatDate(ex.date.slice(0, 10))}${time}: ${ctx.param(ex.parameterId)?.name ?? ex.parameterId} ${value(ex)}`);
    L.push(`  ${rule.level}: ${rule.name}${ex.limitText ? ` – ${ex.limitText}` : ''}${rule.condition ? ` (${rule.condition})` : ''}`);
    // how it was worked out, when that says more than the value (a change from upstream, results in a row …)
    if (ex.detail && ex.detail !== ex.limitText && ex.detail.trim() !== value(ex)) L.push(`  ${ex.detail}`);
    if (s?.labJob || s?.labName) L.push(`  ${[s.labName, s.labJob ? `job ${s.labJob}` : ''].filter(Boolean).join(', ')}`);
  }
  const actions = [...new Set(sorted.map((i) => i.rule.action?.trim()).filter((a): a is string => !!a))];
  if (actions.length) {
    L.push('', `The consent requires:`);
    for (const a of actions) L.push(`- ${a}`);
  }
  const done = [...new Set(sorted.map((i) => i.note?.text.trim()).filter((t): t is string => !!t))];
  L.push('', 'Actions taken so far:');
  if (done.length) for (const t of done) L.push(...t.split('\n').map((x, k) => (k === 0 ? `- ${x}` : `  ${x}`)));
  else L.push('- [what has been done – e.g. the cause is being investigated; re-sampling is booked for …]');
  L.push('', 'We will let you know the outcome.', '', 'Kind regards,', ...[ctx.author, ctx.company].filter((x): x is string => !!x));
  return { subject, body: L.join('\n') };
}

/** Longer than this, a mailto: address may be cut short or refused (Windows passes about 2,000 characters to the email program). */
export const MAILTO_MAX = 1900;

/**
 * A mailto: address for the notice – opens the email program with the subject and text in it. One too long for that
 * (`fits` false) carries the subject only: the text is to be pasted in.
 */
export function noticeMailto(n: Notice, to = ''): { href: string; fits: boolean } {
  const head = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(n.subject)}`;
  const full = `${head}&body=${encodeURIComponent(n.body)}`;
  return full.length <= MAILTO_MAX ? { href: full, fits: true } : { href: head, fits: false };
}

/** The exceedances that go in one notice with this one: the same sampling day's that are still open. */
export function sameDayOpen<T extends { ex: Exceedance; note?: Pick<ExceedanceNote, 'status'> }>(all: T[], of: T): T[] {
  const day = of.ex.date.slice(0, 10);
  const same = all.filter((x) => x.ex.date.slice(0, 10) === day && (!x.note || x.note.status === 'open'));
  return same.includes(of) ? same : [of, ...same];
}
