// The workspace folder, through the browser's File System Access API (Edge and Chrome on a computer), and an
// in-memory folder for tests. Paths use "/" and are relative to the folder.

export interface FileInfo {
  lastModified: number;
  size: number;
}

export interface FolderEntry {
  name: string;
  kind: 'file' | 'directory';
}

export interface WorkspaceFolder {
  readonly name: string;
  /** What a directory holds ([] when it does not exist). */
  list(dir: string): Promise<FolderEntry[]>;
  /** A file's size and time, or null when there is no such file. */
  info(path: string): Promise<FileInfo | null>;
  read(path: string): Promise<{ text: string; info: FileInfo } | null>;
  /** Replaces the file (creating it and its directories when needed). */
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Whether the folder can be read and written; `ask` shows the browser's prompt (needs a click). */
  permission(ask: boolean): Promise<PermissionState>;
}

interface DirHandle {
  readonly name: string;
  readonly kind: 'directory';
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
  entries(): AsyncIterable<[string, { kind: 'file' | 'directory' }]>;
  queryPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
}

interface FileHandleLike {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }>;
}

export type DirectoryHandle = DirHandle;

/** Errors meaning "there is nothing there", as opposed to a folder that can't be reached. */
export function isNotFound(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === 'NotFoundError' || name === 'TypeMismatchError';
}

/** Errors meaning the browser no longer lets this page use the folder. */
export function isNoPermission(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === 'NotAllowedError' || name === 'SecurityError';
}

function split(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/').filter(Boolean);
  return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] ?? '' };
}

export function handleFolder(root: DirectoryHandle): WorkspaceFolder {
  const dir = async (parts: string[], create: boolean) => {
    let d = root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  };
  const fileHandle = async (path: string, create: boolean) => {
    const { dirs, name } = split(path);
    return (await dir(dirs, create)).getFileHandle(name, { create });
  };
  return {
    name: root.name,
    async list(path) {
      try {
        const d = await dir(path.split('/').filter(Boolean), false);
        const out: FolderEntry[] = [];
        for await (const [name, h] of d.entries()) out.push({ name, kind: h.kind });
        return out;
      } catch (e) {
        if (isNotFound(e)) return [];
        throw e;
      }
    },
    async info(path) {
      try {
        const f = await (await fileHandle(path, false)).getFile();
        return { lastModified: f.lastModified, size: f.size };
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async read(path) {
      try {
        const f = await (await fileHandle(path, false)).getFile();
        return { text: await f.text(), info: { lastModified: f.lastModified, size: f.size } };
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async write(path, text) {
      const w = await (await fileHandle(path, true)).createWritable();
      await w.write(text);
      await w.close();
    },
    async remove(path) {
      const { dirs, name } = split(path);
      try {
        await (await dir(dirs, false)).removeEntry(name);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    },
    async permission(ask) {
      if (!root.queryPermission) return 'granted';
      let p = await root.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted' && ask && root.requestPermission) p = await root.requestPermission({ mode: 'readwrite' });
      return p;
    },
  };
}

/** A folder held in memory – for tests. `files` maps paths to their content. */
export function memoryFolder(name = 'Workspace'): WorkspaceFolder & { files: Map<string, { text: string; lastModified: number }>; offline: boolean } {
  const files = new Map<string, { text: string; lastModified: number }>();
  let clock = Date.now();
  const check = () => {
    if (folder.offline) throw Object.assign(new Error('The folder is not available'), { name: 'NotReadableError' });
  };
  const folder = {
    name,
    files,
    offline: false,
    async list(path: string) {
      check();
      const prefix = path.split('/').filter(Boolean).join('/');
      const out = new Map<string, FolderEntry>();
      for (const p of files.keys()) {
        if (prefix && !p.startsWith(`${prefix}/`)) continue;
        const rest = prefix ? p.slice(prefix.length + 1) : p;
        const [first, ...more] = rest.split('/');
        out.set(first, { name: first, kind: more.length ? 'directory' : 'file' });
      }
      return [...out.values()];
    },
    async info(path: string) {
      check();
      const f = files.get(path);
      return f ? { lastModified: f.lastModified, size: new TextEncoder().encode(f.text).length } : null;
    },
    async read(path: string) {
      check();
      const f = files.get(path);
      return f ? { text: f.text, info: { lastModified: f.lastModified, size: new TextEncoder().encode(f.text).length } } : null;
    },
    async write(path: string, text: string) {
      check();
      files.set(path, { text, lastModified: (clock = Math.max(clock + 1, Date.now())) });
    },
    async remove(path: string) {
      check();
      files.delete(path);
    },
    async permission() {
      return 'granted' as PermissionState;
    },
  };
  return folder;
}
