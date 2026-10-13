// Change stamps: a hybrid logical clock. A stamp is "<milliseconds, 9 base-36 digits><counter, 3 digits>-<client id>",
// so stamps sort as plain strings, later changes sort later, and no two clients ever make the same stamp. Seeing a
// colleague's stamp moves this clock past it, so an edit made after reading theirs always sorts after it, even
// when the two computers' clocks disagree.

const MS_DIGITS = 9;
const COUNTER_DIGITS = 3;
const MAX_COUNTER = 36 ** COUNTER_DIGITS - 1;
/** Stamps from a clock more than this far ahead are not followed (a computer with a wildly wrong date). */
const MAX_AHEAD_MS = 366 * 86400000;
const STORE_KEY = 'envirodb.clock';

let client = '';
let lastMs = 0;
let counter = 0;

function load(): void {
  try {
    const saved = Number(globalThis.localStorage?.getItem(STORE_KEY));
    if (Number.isFinite(saved) && saved > lastMs) lastMs = saved;
  } catch {
    /* no storage: the clock starts from now */
  }
}

let savedAt = 0;

/** Remembers the clock (at most once a second: a big import makes thousands of stamps). */
function save(): void {
  const now = Date.now();
  if (now - savedAt < 1000) return;
  savedAt = now;
  try {
    globalThis.localStorage?.setItem(STORE_KEY, String(lastMs + 1000));
  } catch {
    /* ignore */
  }
}

/** Sets this browser's client id, which ends every stamp it makes. */
export function setClockClient(id: string): void {
  client = id;
  load();
}

export function clockClient(): string {
  return client;
}

/** A new stamp, later than every stamp made or seen so far. */
export function stamp(): string {
  const now = Date.now();
  if (now > lastMs) {
    lastMs = now;
    counter = 0;
  } else if (++counter > MAX_COUNTER) {
    lastMs++;
    counter = 0;
  }
  save();
  return `${lastMs.toString(36).padStart(MS_DIGITS, '0')}${counter.toString(36).padStart(COUNTER_DIGITS, '0')}-${client}`;
}

/** Takes note of a stamp read from elsewhere, so the next stamp made here sorts after it. */
export function observe(s: string | undefined): void {
  if (!s) return;
  const ms = stampMs(s);
  if (!Number.isFinite(ms) || ms <= lastMs || ms > Date.now() + MAX_AHEAD_MS) return;
  lastMs = ms;
  counter = parseInt(s.slice(MS_DIGITS, MS_DIGITS + COUNTER_DIGITS), 36) || 0;
  save();
}

export function stampMs(s: string): number {
  return parseInt(s.slice(0, MS_DIGITS), 36);
}

/** The client that made a stamp. */
export function stampClient(s: string): string {
  return s.slice(MS_DIGITS + COUNTER_DIGITS + 1);
}

export function laterStamp(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
