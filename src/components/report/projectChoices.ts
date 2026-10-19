// The project a report is being made for – its sites, and the parameters it has results (or consent rules) for – so
// pickers in report sections offer those, not every parameter in the library and every site anywhere.

import { createContext, useContext, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Parameter, Site } from '../../db/types';
import { compareParams } from '../../data/parameters';
import type { ProjectBundle } from '../../lib/analysis';
import { ruleParamIds } from '../../lib/compliance';

export interface ReportProject {
  name: string;
  sites: Site[];
  /** Parameters with results in the project (before any: those in its consent rules). */
  paramIds: string[];
  /** Its rainfall, flow and level records. */
  series?: Array<{ id: string; name: string; kind: string }>;
}

/** On a project's Reports tab, and in the template editor while previewing with a project. */
export const ReportProjectContext = createContext<ReportProject | null>(null);

/** The parameters and site codes to choose from: the project's – or, with no project to go by, all of them. */
export function useCalcChoices(): { params: Parameter[]; codes: string[]; project: string | null } {
  const ctx = useContext(ReportProjectContext);
  const all = useLiveQuery(() => db.parameters.toArray(), []);
  const allCodes = useLiveQuery(async () => (ctx ? [] : [...new Set((await db.sites.toArray()).map((x) => x.code))].sort()), [!!ctx]);
  return useMemo(() => {
    const list = [...(all ?? [])];
    if (!ctx) return { params: list.sort((a, b) => a.name.localeCompare(b.name)), codes: allCodes ?? [], project: null };
    const want = new Set(ctx.paramIds);
    return { params: list.filter((p) => want.has(p.id)).sort(compareParams), codes: [...ctx.sites].sort((a, b) => a.order - b.order).map((s) => s.code), project: ctx.name };
  }, [all, allCodes, ctx]);
}

/** A project's parameters to offer: those with results – or, before any are in, those its consent rules name. */
export function projectParamIds(b: Pick<ProjectBundle, 'index' | 'rules' | 'setMap'>): string[] {
  if (b.index.paramIdsWithData.length) return b.index.paramIdsWithData;
  return [...new Set(b.rules.flatMap((r) => (r.kind === 'guideline' && !r.parameterIds?.length ? [] : ruleParamIds(r, b.setMap))))];
}
