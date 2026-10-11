export function uid(prefix = ''): string {
  const c = globalThis.crypto as Crypto | undefined;
  const raw = c && 'randomUUID' in c ? c.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 18);
  return prefix ? `${prefix}_${raw}` : raw;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function nowIso(): string {
  return new Date().toISOString();
}
