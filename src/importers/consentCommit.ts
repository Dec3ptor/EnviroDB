import { db } from '../db/db';
import type { ExceedanceNote, MonitoringSchedule, Parameter, Project, ReportObligation, Rule } from '../db/types';
import { MONTH_LONG } from '../lib/dates';
import { nowIso, slugify, uid } from '../lib/ids';
import { NEW_PARAM, ruleBlockers, type ConsentPlan } from './consent';
import { withGuidelineLimit } from '../lib/compliance';

/** Everything needed to undo a consent import. */
export interface ConsentUndo {
  project: Project;
  replaced: { rules: Rule[]; schedules: MonitoringSchedule[]; obligations: ReportObligation[]; notes: ExceedanceNote[] };
  created: { sites: string[]; rules: string[]; schedules: string[]; obligations: string[]; params: string[] };
}

export interface ConsentImportResult {
  sites: number;
  rules: number;
  /** Rules imported paused because they still need something (a parameter, limit, reference site…). */
  paused: string[];
  schedules: number;
  obligations: number;
  params: number;
  skipped: string[];
  undo: ConsentUndo;
}

/** Write the selected parts of a reviewed consent plan to the project. */
export async function commitConsentPlan(projectId: string, plan: ConsentPlan, opts: { replace: boolean }): Promise<ConsentImportResult> {
  const sets = new Map((await db.guidelineSets.toArray()).map((g) => [g.id, g]));
  return db.transaction('rw', [db.projects, db.sites, db.rules, db.schedules, db.obligations, db.notes, db.parameters], async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('Project not found');
    const sites = await db.sites.where('projectId').equals(projectId).toArray();
    const oldRules = await db.rules.where('projectId').equals(projectId).toArray();
    const undo: ConsentUndo = { project, replaced: { rules: [], schedules: [], obligations: [], notes: [] }, created: { sites: [], rules: [], schedules: [], obligations: [], params: [] } };
    const res: ConsentImportResult = { sites: 0, rules: 0, paused: [], schedules: 0, obligations: 0, params: 0, skipped: [], undo };

    if (opts.replace) {
      undo.replaced = {
        rules: oldRules,
        schedules: await db.schedules.where('projectId').equals(projectId).toArray(),
        obligations: await db.obligations.where('projectId').equals(projectId).toArray(),
        notes: await db.notes.where('projectId').equals(projectId).toArray(),
      };
      await db.rules.bulkDelete(undo.replaced.rules.map((r) => r.id));
      await db.schedules.bulkDelete(undo.replaced.schedules.map((s) => s.id));
      await db.obligations.bulkDelete(undo.replaced.obligations.map((o) => o.id));
      await db.notes.bulkDelete(undo.replaced.notes.map((n) => n.id));
    }

    // sites
    const valid = new Set(sites.map((s) => s.id));
    let order = Math.max(0, ...sites.map((s) => s.order));
    for (const ps of plan.sites) {
      if (!ps.include || ps.existing) continue;
      if (sites.some((s) => s.code.toLowerCase() === ps.site.code.toLowerCase())) {
        res.skipped.push(`Site ${ps.site.code}: the project already has a site with this code`);
        continue;
      }
      await db.sites.put({ ...ps.site, projectId, order: ++order });
      valid.add(ps.site.id);
      undo.created.sites.push(ps.site.id);
      res.sites++;
    }

    // new parameters chosen during review
    const params = await db.parameters.toArray();
    const paramIds = new Map<string, string>();
    for (const pr of plan.rules) {
      const pid = pr.rule.parameterId;
      if (!pr.include || !pid?.startsWith(NEW_PARAM) || paramIds.has(pid)) continue;
      const name = pr.paramText.trim() || 'New parameter';
      const same = params.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (same) {
        paramIds.set(pid, same.id);
        continue;
      }
      let id = slugify(name) || uid('p');
      if (params.some((p) => p.id === id)) id = `${id}-${uid().slice(0, 4)}`;
      const param: Parameter = { id, name, group: 'Other', unit: pr.rule.unit ?? '', aliases: [name], order: 10000 };
      await db.parameters.put(param);
      params.push(param);
      paramIds.set(pid, id);
      undo.created.params.push(id);
      res.params++;
    }

    // rules
    let ruleOrder = opts.replace ? 0 : Math.max(0, ...oldRules.map((r) => r.order));
    for (const pr of plan.rules) {
      if (!pr.include) continue;
      const r: Rule = { ...pr.rule, projectId };
      if (r.parameterId?.startsWith(NEW_PARAM)) r.parameterId = paramIds.get(r.parameterId);
      Object.assign(r, withGuidelineLimit(r, sets)); // a limit from a guideline set, for the parameter chosen in the review
      if (r.siteIds.length) {
        const kept = r.siteIds.filter((id) => valid.has(id));
        if (!kept.length) {
          res.skipped.push(`Rule "${r.name}": none of its sites were imported`);
          continue;
        }
        r.siteIds = kept;
      }
      if (r.referenceSiteId && !valid.has(r.referenceSiteId)) r.referenceSiteId = undefined;
      const needs = ruleBlockers(r);
      if (needs.length) {
        r.active = false;
        res.paused.push(`${r.name} (${needs.join(', ')})`);
      }
      r.order = ++ruleOrder;
      await db.rules.put(r);
      undo.created.rules.push(r.id);
      res.rules++;
    }

    // sampling schedules and reporting dates
    for (const ps of plan.schedules) {
      if (!ps.include) continue;
      const s = { ...ps.schedule, projectId };
      if (s.siteIds.length) {
        s.siteIds = s.siteIds.filter((id) => valid.has(id));
        if (!s.siteIds.length) {
          res.skipped.push(`Schedule "${s.name}": none of its sites were imported`);
          continue;
        }
      }
      await db.schedules.put(s);
      undo.created.schedules.push(s.id);
      res.schedules++;
    }
    for (const po of plan.obligations) {
      if (!po.include) continue;
      await db.obligations.put({ ...po.obligation, projectId });
      undo.created.obligations.push(po.obligation.id);
      res.obligations++;
    }

    // project details and other consent requirements
    const next: Project = { ...project };
    for (const f of plan.project) {
      if (!f.include) continue;
      if (f.field === 'yearStartMonth') {
        const m = MONTH_LONG.indexOf(f.proposed) + 1;
        if (m > 0) next.yearStartMonth = m;
      } else next[f.field] = f.proposed;
    }
    if (plan.includeNotes && plan.notes.length) {
      const have = (project.consentNotes ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
      const add = plan.notes.map((n) => `- ${n.replace(/^[-•]\s*/, '')}`).filter((n) => !have.includes(n));
      next.consentNotes = [...have, ...add].join('\n');
    }
    next.updatedAt = nowIso();
    await db.projects.put(next);
    return res;
  });
}

/** Put the project back the way it was before a consent import. */
export async function undoConsentImport(u: ConsentUndo): Promise<void> {
  await db.transaction('rw', [db.projects, db.sites, db.samples, db.results, db.rules, db.schedules, db.obligations, db.notes, db.parameters], async () => {
    await db.rules.bulkDelete(u.created.rules);
    await db.notes.where('ruleId').anyOf(u.created.rules).delete();
    await db.schedules.bulkDelete(u.created.schedules);
    await db.obligations.bulkDelete(u.created.obligations);
    for (const id of u.created.sites) if (!(await db.samples.where('siteId').equals(id).count())) await db.sites.delete(id);
    for (const id of u.created.params) if (!(await db.results.filter((r) => r.parameterId === id).count())) await db.parameters.delete(id);
    await db.rules.bulkPut(u.replaced.rules);
    await db.schedules.bulkPut(u.replaced.schedules);
    await db.obligations.bulkPut(u.replaced.obligations);
    await db.notes.bulkPut(u.replaced.notes);
    await db.projects.put(u.project);
  });
}
