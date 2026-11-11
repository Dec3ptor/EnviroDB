import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { CalendarRow, ProjectFile } from '../db/types';
import type { RoundRows } from '../lib/projectFiles';

const NONE: ProjectFile[] = [];
const NO_ROWS: CalendarRow[] = [];

/** A project's files, as they change (none while they're read). */
export function useProjectFiles(projectId: string): ProjectFile[] {
  return useLiveQuery(() => db.files.where('projectId').equals(projectId).toArray(), [projectId]) ?? NONE;
}

/** A project's rows on the monitoring calendar, in its order – the rounds a file can be linked to. */
export function useProjectRows(projectId: string): CalendarRow[] {
  const rows = useLiveQuery(() => db.calendarRows.where('projectId').equals(projectId).toArray(), [projectId]) ?? NO_ROWS;
  return useMemo(() => [...rows].sort((a, b) => a.order - b.order), [rows]);
}

/** The same rows by id – what a file's round link is looked up in. */
export function useRoundRows(projectId: string): RoundRows {
  const rows = useProjectRows(projectId);
  return useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
}
