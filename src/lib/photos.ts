// Photos of a sample: taken on the phone in field mode or added here from a computer. The pictures live in the
// team's shared folder (Field photos/<project>/<date>/<site> n.jpg); a sample's notes say which are its, on a line
// "Field photos: path; path". The database never holds the pictures themselves.

import { db } from '../db/db';
import { logAudit } from '../db/audit';
import type { Project, Sample, Site } from '../db/types';
import { currentWorkspaceFolder } from '../sync/workspace';
import type { WorkspaceFolder } from '../sync/folder';
import { readFigureFile } from './image';

const LINE = /^Field photos: (.+)$/m;

/** A name safe for a file or folder in the shared folder. */
export const safeName = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();

/** The paths of a sample's photos, from its notes. */
export function samplePhotoPaths(notes?: string): string[] {
  const m = notes ? LINE.exec(notes) : null;
  return m ? m[1].split(';').map((p) => p.trim()).filter(Boolean) : [];
}

/** The notes with these photo paths (replacing the line; none = no line). */
export function withPhotoPaths(notes: string | undefined, paths: string[]): string {
  const kept = (notes ?? '').split('\n').filter((l) => !/^Field photos: /.test(l));
  if (paths.length) kept.push(`Field photos: ${paths.join('; ')}`);
  return kept.join('\n').replace(/^\n+/, '');
}

/** Where a project's photos for a day go. */
export function photoDir(project: Pick<Project, 'code' | 'name'>, date: string): string {
  return `Field photos/${safeName(project.code || project.name || 'Project')}/${date.slice(0, 10)}`;
}

/** A photo as a URL for an <img> (revoke it when done), or null when the folder isn't connected or has no such file. */
export async function photoUrl(path: string, folder: WorkspaceFolder | null = currentWorkspaceFolder()): Promise<string | null> {
  if (!folder) return null;
  try {
    const f = await folder.file(path);
    return f ? URL.createObjectURL(f) : null;
  } catch {
    return null;
  }
}

const bytesOf = (dataUrl: string): Blob => {
  const [head, b64] = dataUrl.split(',');
  const type = /^data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(b64 ?? '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type });
};

/**
 * Add photos to a sample from a computer: each is scaled to a sensible size, written to the shared folder beside
 * the phone's, and noted on the sample. Returns how many were added, and what went wrong with the rest.
 */
export async function addSamplePhotos(sample: Sample, site: Pick<Site, 'code'>, project: Pick<Project, 'code' | 'name'>, files: File[], toDataUrl: (f: File) => Promise<string> = (f) => readFigureFile(f, 1800), folder: WorkspaceFolder | null = currentWorkspaceFolder()): Promise<{ added: number; paths: string[]; error?: string }> {
  if (!folder?.writeBlob) return { added: 0, paths: [], error: 'The shared folder isn’t connected, so photos can’t be kept.' };
  const have = samplePhotoPaths(sample.notes);
  const dir = photoDir(project, sample.date);
  const added: string[] = [];
  let error: string | undefined;
  let n = have.length;
  for (const f of files) {
    try {
      const dataUrl = await toDataUrl(f);
      const blob = bytesOf(dataUrl);
      const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
      // the next free name (the phone's photos count from 1)
      let path = '';
      for (let tries = 0; tries < 50; tries++) {
        n++;
        path = `${dir}/${safeName(site.code)} ${n}.${ext}`;
        if (!(await folder.info(path).catch(() => null))) break;
      }
      await folder.writeBlob(path, blob);
      added.push(path);
    } catch (e) {
      error = `${f.name}: ${(e as Error).message}`;
    }
  }
  if (added.length) {
    await db.samples.update(sample.id, { notes: withPhotoPaths(sample.notes, [...have, ...added]) });
    await logAudit(sample.projectId, 'sample', `${added.length} photo${added.length === 1 ? '' : 's'} added to ${site.code} ${sample.date.slice(0, 10)}`);
  }
  return { added: added.length, paths: added, error };
}

/** Take a photo off a sample (the file stays in the shared folder). */
export async function removeSamplePhoto(sample: Sample, path: string): Promise<void> {
  const left = samplePhotoPaths(sample.notes).filter((p) => p !== path);
  await db.samples.update(sample.id, { notes: withPhotoPaths(sample.notes, left) });
  await logAudit(sample.projectId, 'sample', `Photo removed from a sample: ${path.split('/').pop()}`);
}

/** Just the file name, for a caption. */
export const photoName = (path: string) => path.split('/').pop() ?? path;
