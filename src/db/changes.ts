// A signal that something worth saving changed outside the data tables (report commentary, settings …), so the
// autosave file can be brought up to date. Kept free of imports so any module can send it.

const listeners = new Set<() => void>();

export function onSaveableChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function saveableChanged(): void {
  listeners.forEach((fn) => fn());
}
