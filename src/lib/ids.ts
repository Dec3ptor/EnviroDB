export function uid(prefix = ''): string {
  const c = globalThis.crypto as Crypto | undefined;
  const raw = c && 'randomUUID' in c ? c.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 18);
  return prefix ? `${prefix}_${raw}` : raw;
}

/**
 * An id made from what a record is rather than at random – so two people creating the same thing at once (importing
 * the same lab results) make the same record, which merges instead of turning up twice.
 */
export function stableId(prefix: string, ...parts: string[]): string {
  const str = parts.join('\u0001');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${prefix}_${(h2 >>> 0).toString(36).padStart(7, '0')}${(h1 >>> 0).toString(36).padStart(7, '0')}`;
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
