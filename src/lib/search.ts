// Search across everything: projects, sites, parameters, rules, reporting obligations, templates, guideline sets
// and the app's own pages. A few letters find a site code or a project; every word typed has to match somewhere.

import type { GuidelineSet, Parameter, Project, ReportObligation, ReportTemplate, Rule, Site } from '../db/types';

export type SearchKind = 'project' | 'site' | 'page' | 'obligation' | 'rule' | 'parameter' | 'template' | 'guideline';

export interface SearchHit {
  kind: SearchKind;
  title: string;
  detail?: string;
  to: string;
  score: number;
}

export interface SearchSource {
  projects: Project[];
  sites: Array<Site & { projectName?: string }>;
  params: Parameter[];
  rules: Array<Rule & { projectName?: string }>;
  obligations: Array<ReportObligation & { projectName?: string }>;
  templates: Array<Pick<ReportTemplate, 'id' | 'name' | 'description'>>;
  guidelineSets: Array<Pick<GuidelineSet, 'id' | 'name' | 'shortName'>>;
}

export const KIND_TEXT: Record<SearchKind, string> = {
  project: 'Projects',
  site: 'Sites',
  page: 'Pages',
  obligation: 'Reports and plans due',
  rule: 'Limits and triggers',
  parameter: 'Parameters',
  template: 'Report templates',
  guideline: 'Guideline values',
};
const KIND_ORDER: SearchKind[] = ['project', 'site', 'page', 'obligation', 'rule', 'parameter', 'template', 'guideline'];

/** The app's pages, so "settings" or "calendar" is a hit too. */
export const PAGES: Array<{ title: string; detail?: string; to: string; words?: string }> = [
  { title: 'Dashboard', to: '/', words: 'home actions deadlines' },
  { title: 'Projects', to: '/projects' },
  { title: 'Monitoring calendar', to: '/calendar', words: 'rounds schedule year' },
  { title: 'Import data', to: '/import', words: 'lab file results upload' },
  { title: 'Quick check', to: '/quick-check', words: 'guidelines compare file' },
  { title: 'Guideline values', detail: 'Library', to: '/guidelines', words: 'anzg anzecc drinking water standards' },
  { title: 'Report templates', detail: 'Library', to: '/templates' },
  { title: 'Parameters', detail: 'Library', to: '/parameters', words: 'analytes dictionary units aliases' },
  { title: 'Settings & backup', to: '/settings', words: 'you name signature colours' },
  { title: 'Team features', detail: 'Settings → Team', to: '/settings?tab=team', words: 'switch on field mode nps-fm packs ai letterhead workspace' },
  { title: 'Field work', detail: 'Settings → Team → Features', to: '/settings?tab=team', words: 'phone field mode codes sheet' },
];

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();

/** How well a text answers one word: exact, at the start, at a word's start, anywhere, or not at all. */
function wordScore(text: string, word: string): number {
  if (!text) return 0;
  if (text === word) return 100;
  if (text.startsWith(word)) return 80;
  if (new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)) return 60;
  if (text.includes(word)) return 40;
  return 0;
}

/** Every word has to match one of the fields; the first field counts for more. */
function score(fields: Array<string | undefined>, words: string[]): number {
  const texts = fields.map((f) => norm(f ?? ''));
  let total = 0;
  for (const w of words) {
    let best = 0;
    texts.forEach((t, i) => {
      const s = wordScore(t, w);
      if (s) best = Math.max(best, s - (i ? 15 : 0));
    });
    if (!best) return 0;
    total += best;
  }
  return total / words.length;
}

export function searchAll(query: string, src: SearchSource, limit = 40): SearchHit[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  const add = (kind: SearchKind, title: string, detail: string | undefined, to: string, fields: Array<string | undefined>) => {
    const s = score(fields, words);
    if (s) hits.push({ kind, title, detail, to, score: s });
  };
  for (const p of src.projects) add('project', p.name, [p.code, p.client, p.status === 'archived' ? 'archived' : ''].filter(Boolean).join(' · ') || undefined, `/projects/${p.id}`, [p.name, p.code, p.client, p.consents, p.regulator]);
  for (const s of src.sites) add('site', s.code, [s.name, s.type, s.projectName].filter(Boolean).join(' · '), `/projects/${s.projectId}/setup`, [s.code, s.name, ...s.aliases]);
  for (const pg of PAGES) add('page', pg.title, pg.detail, pg.to, [pg.title, pg.words]);
  for (const o of src.obligations) add('obligation', o.name, [o.kind === 'plan' ? 'Management plan' : o.kind === 'other' ? 'Document' : 'Report', o.recipient, o.projectName].filter(Boolean).join(' · '), `/projects/${o.projectId}/schedule`, [o.name, o.recipient]);
  for (const r of src.rules) add('rule', r.name, [r.level, r.condition, r.projectName].filter(Boolean).join(' · '), `/projects/${r.projectId}/compliance`, [r.name, r.condition]);
  for (const p of src.params) add('parameter', p.name, [p.short, p.group].filter(Boolean).join(' · '), '/parameters', [p.name, p.short, ...p.aliases.slice(0, 12)]);
  for (const t of src.templates) add('template', t.name, t.description, `/templates/${t.id}`, [t.name, t.description]);
  for (const g of src.guidelineSets) add('guideline', g.name, g.shortName, `/guidelines/${g.id}`, [g.name, g.shortName]);
  hits.sort((a, b) => b.score - a.score || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.title.localeCompare(b.title));
  return hits.slice(0, limit);
}

/** The keyboard shortcuts, for the help and the README. */
export const SHORTCUTS: Array<{ keys: string; does: string }> = [
  { keys: 'Ctrl K', does: 'Search everything (⌘ K on a Mac)' },
  { keys: '?', does: 'These shortcuts' },
  { keys: 'g then d', does: 'Dashboard' },
  { keys: 'g then p', does: 'Projects' },
  { keys: 'g then c', does: 'Monitoring calendar' },
  { keys: 'g then i', does: 'Import data' },
  { keys: 'g then l', does: 'Library' },
  { keys: 'g then s', does: 'Settings' },
  { keys: '1 – 7', does: 'A project’s tabs, in order (Overview, Data, Graphs, Map, Compliance, Reports, Setup)' },
  { keys: 'Esc', does: 'Close a dialog or drawer' },
];

/** Where "g then <letter>" goes. */
export const GO_KEYS: Record<string, string> = { d: '/', p: '/projects', c: '/calendar', i: '/import', l: '/guidelines', s: '/settings' };
