// The project's history: who did what, when. Written beside the changes that matter (imports and their undoing,
// sign-offs, sites, rules, obligations, edits to results) and shown under the project's Setup tab. Shared with the
// workspace like the data, so a colleague's actions show too.

import { db } from './db';
import type { AuditEntry } from './types';
import { nowIso, uid } from '../lib/ids';
import { getWorkspaceState } from '../sync/workspace';

/** Who's using this browser: their name in the workspace, if given. */
export const whoAmI = (): string => getWorkspaceState().myName || '';

/** Records something that happened to a project. Never throws: history must not stop the work. */
export async function logAudit(projectId: string, kind: AuditEntry['kind'], text: string): Promise<void> {
  try {
    await db.audit.put({ id: uid('aud'), projectId, at: nowIso(), by: whoAmI(), kind, text: text.slice(0, 400) });
  } catch {
    /* nothing: the change itself went through */
  }
}

export const AUDIT_KIND_TEXT: Record<AuditEntry['kind'], string> = {
  import: 'Import',
  undo: 'Undo',
  review: 'Review',
  site: 'Site',
  rule: 'Rule',
  obligation: 'Reporting',
  result: 'Result',
  sample: 'Sample',
  note: 'Note',
  project: 'Project',
  setup: 'Setup',
};
