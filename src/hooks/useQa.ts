import { useMemo } from 'react';
import { addDays, dayOf, todayStr } from '../lib/dates';
import { qaInputFor, runQa, withRecords, type QaResult } from '../lib/qa';
import type { ProjectBundle } from '../lib/analysis';
import type { Settings } from '../db/types';
import { useProject } from './useProjectData';
import { useSettings } from './useSettings';

/** Which results the QA/QC checks look at: the latest round, the last 12 months, or everything. */
export type QaRange = 'latest' | '12m' | 'all';

/** The first day looked at. The latest round: the month before the last sample. */
export function qaStart(range: QaRange, samples: Array<{ date: string }>, today = todayStr()): string | undefined {
  if (range === 'all') return undefined;
  if (range === '12m') return addDays(today, -365);
  const last = samples.reduce((m, s) => (s.date > m ? s.date : m), '');
  return last ? addDays(dayOf(last), -31) : undefined;
}

export interface QaView extends QaResult {
  start?: string;
  /** Findings still to look at (not decided), 'check' ones only. */
  toCheck: number;
}

type QaSettings = Pick<Settings, 'qaRpdLimit' | 'qaRpdLimitNearDl' | 'qaOutlierZ'>;

// the checks for a project's data are worked out once however many screens show them
const cache = new WeakMap<object, Map<string, QaView>>();

export function projectQa(b: ProjectBundle, range: QaRange, settings: QaSettings, today = todayStr()): QaView {
  const key = `${range}|${today}|${settings.qaRpdLimit}|${settings.qaRpdLimitNearDl}|${settings.qaOutlierZ}|${b.qc?.records.length}|${b.qc?.records.map((r) => r.at).join()}`;
  let m = cache.get(b);
  if (!m) cache.set(b, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const start = qaStart(range, b.samples, today);
  const r = runQa(qaInputFor(b, { start }, settings));
  const findings = withRecords(r.findings, b.qc?.records ?? []);
  const view: QaView = { ...r, findings, start, toCheck: findings.filter((f) => !f.record && f.severity === 'check').length };
  m.set(key, view);
  return view;
}

/** The QA/QC checks on the open project. */
export function useProjectQa(range: QaRange): QaView {
  const data = useProject();
  const settings = useSettings();
  return useMemo(() => projectQa(data, range, settings), [data, range, settings]);
}
