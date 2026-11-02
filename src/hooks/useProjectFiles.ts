import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { ProjectFile } from '../db/types';

const NONE: ProjectFile[] = [];

/** A project's files, as they change (none while they're read). */
export function useProjectFiles(projectId: string): ProjectFile[] {
  return useLiveQuery(() => db.files.where('projectId').equals(projectId).toArray(), [projectId]) ?? NONE;
}
