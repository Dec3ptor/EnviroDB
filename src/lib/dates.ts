// Date helpers. All dates are "floating" local strings: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'.
// Arithmetic is done in UTC so results never shift with the viewer's timezone/DST.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function makeDate(y: number, m: number, d: number, hh?: number, mm?: number): string {
  const base = `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
  if (hh === undefined || hh === null || Number.isNaN(hh)) return base;
  return `${base}T${pad(hh)}:${pad(mm ?? 0)}`;
}

function expandYear(y: number): number {
  if (y >= 100) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

/** Excel serial date (1900 date system) → floating date string. */
export function fromExcelSerial(serial: number, keepTime = true): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 120000) return null;
  const ms = Math.round(serial * 86400) * 1000 + Date.UTC(1899, 11, 30);
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  const hh = dt.getUTCHours();
  const mi = dt.getUTCMinutes();
  if (keepTime && (hh !== 0 || mi !== 0)) return makeDate(y, m, d, hh, mi);
  return makeDate(y, m, d);
}

export function toExcelSerial(date: string): number {
  return (toUtcMs(date) - Date.UTC(1899, 11, 30)) / 86400000;
}

function parseTime(s: string | undefined): { hh: number; mm: number } | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  const ap = m[4]?.toLowerCase().replace(/\./g, '');
  if (!m[2] && !ap) return null; // a bare number is not a time
  if (ap === 'pm' && hh < 12) hh += 12;
  if (ap === 'am' && hh === 12) hh = 0;
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}

const TIME_RE = String.raw`(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?|\d{1,2}\s*(?:am|pm))`;

/**
 * Parse a free-text date. NZ convention: numeric dates are day-first (12/03/2024 = 12 March 2024).
 * Returns null when the text is not (only) a date.
 */
export function parseDateString(input: string): string | null {
  const s = input.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  let m: RegExpMatchArray | null;

  // ISO 2024-03-12, 2024/03/12, optional time
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2})[:.](\d{2})(?:[:.]\d{2}(?:\.\d+)?)?\s*(am|pm)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (!isValidYmd(y, mo, d)) return null;
    if (m[4] === undefined) return makeDate(y, mo, d);
    let hh = +m[4];
    const mi = +m[5];
    if (m[6]?.toLowerCase() === 'pm' && hh < 12) hh += 12;
    if (m[6]?.toLowerCase() === 'am' && hh === 12) hh = 0;
    return hh <= 23 && mi <= 59 ? makeDate(y, mo, d, hh, mi) : makeDate(y, mo, d);
  }

  // Day-first numeric 12/03/2024, 12-03-24, 12.3.2024
  m = s.match(new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:,?\s+` + TIME_RE + ')?$', 'i'));
  if (m) {
    let d = +m[1], mo = +m[2];
    const y = expandYear(+m[3]);
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // clearly month-first (e.g. US export)
    if (!isValidYmd(y, mo, d)) return null;
    const t = parseTime(m[4]);
    return t ? makeDate(y, mo, d, t.hh, t.mm) : makeDate(y, mo, d);
  }

  // 12-Mar-2024, 12 March 2024, 12th Mar 24, optional time
  m = s.match(new RegExp(String.raw`^(\d{1,2})(?:st|nd|rd|th)?[-/ .,]*([A-Za-z]{3,9})\.?[-/ .,]*(\d{2}|\d{4})(?:,?\s+` + TIME_RE + ')?$', 'i'));
  if (m && MONTHS[m[2].toLowerCase()]) {
    const d = +m[1], mo = MONTHS[m[2].toLowerCase()], y = expandYear(+m[3]);
    if (!isValidYmd(y, mo, d)) return null;
    const t = parseTime(m[4]);
    return t ? makeDate(y, mo, d, t.hh, t.mm) : makeDate(y, mo, d);
  }

  // Mar 12, 2024 / March 12 2024
  m = s.match(new RegExp(String.raw`^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})(?:,?\s+` + TIME_RE + ')?$', 'i'));
  if (m && MONTHS[m[1].toLowerCase()]) {
    const d = +m[2], mo = MONTHS[m[1].toLowerCase()], y = +m[3];
    if (!isValidYmd(y, mo, d)) return null;
    const t = parseTime(m[4]);
    return t ? makeDate(y, mo, d, t.hh, t.mm) : makeDate(y, mo, d);
  }

  // Month-year only: "Mar-2024", "March 2024", "Mar 24" → 1st of month
  m = s.match(/^([A-Za-z]{3,9})\.?[-/ ,]*(\d{4}|\d{2})$/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const mo = MONTHS[m[1].toLowerCase()], y = expandYear(+m[2]);
    if (!isValidYmd(y, mo, 1)) return null;
    return makeDate(y, mo, 1);
  }
  return null;
}

/** Find a date (and optional time) inside a longer string such as a lab sample name. */
export function extractDate(text: string): { date: string; rest: string } | null {
  const patterns = [
    new RegExp(String.raw`(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})(?:[T ]` + TIME_RE + ')?', 'i'),
    new RegExp(String.raw`(\d{1,2}(?:st|nd|rd|th)?[- /.]?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?[- /.,]?(?:\d{4}|\d{2}))(?:,?\s+` + TIME_RE + ')?', 'i'),
    new RegExp(String.raw`(\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2}))(?:,?\s+` + TIME_RE + ')?', 'i'),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const full = m[0];
    const datePart = m[1];
    const date = parseDateString(m[2] ? `${datePart} ${m[2]}` : datePart);
    if (!date) continue;
    const rest = (text.slice(0, m.index) + ' ' + text.slice((m.index ?? 0) + full.length)).replace(/\s+/g, ' ').trim();
    return { date, rest };
  }
  return null;
}

/** Parse anything a spreadsheet cell can hold into a floating date string. */
export function parseDateAny(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const hh = v.getHours(), mi = v.getMinutes();
    return hh || mi
      ? makeDate(v.getFullYear(), v.getMonth() + 1, v.getDate(), hh, mi)
      : makeDate(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === 'number') return fromExcelSerial(v);
  if (typeof v === 'string') {
    const t = v.trim();
    if (/^\d{5}(\.\d+)?$/.test(t)) return fromExcelSerial(Number(t));
    return parseDateString(t);
  }
  return null;
}

// ------------------------------------------------------------ arithmetic

export function toUtcMs(date: string): number {
  const y = +date.slice(0, 4), m = +date.slice(5, 7), d = +date.slice(8, 10);
  const hh = date.length > 10 ? +date.slice(11, 13) : 0;
  const mi = date.length > 10 ? +date.slice(14, 16) : 0;
  return Date.UTC(y, m - 1, d, hh, mi);
}

export function fromUtcMs(ms: number, withTime = false): string {
  const dt = new Date(ms);
  return withTime
    ? makeDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), dt.getUTCHours(), dt.getUTCMinutes())
    : makeDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export const dayOf = (date: string) => date.slice(0, 10);

export function todayStr(): string {
  const n = new Date();
  return makeDate(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

export function addDays(date: string, n: number): string {
  return fromUtcMs(toUtcMs(dayOf(date)) + n * 86400000);
}

export function addMonths(date: string, n: number): string {
  const y = +date.slice(0, 4), m = +date.slice(5, 7), d = +date.slice(8, 10);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return makeDate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Add months keeping "end of month" semantics: 30 Jun + 3 months = 30 Sep, 31 Mar + 3 = 30 Jun, 28 Feb + 12 = 28 Feb. */
export function addMonthsEom(date: string, n: number): string {
  const y = +date.slice(0, 4), m = +date.slice(5, 7), d = +date.slice(8, 10);
  const wasEom = d === daysInMonth(y, m);
  const r = addMonths(date, n);
  if (!wasEom) return r;
  const ry = +r.slice(0, 4), rm = +r.slice(5, 7);
  return makeDate(ry, rm, daysInMonth(ry, rm));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUtcMs(dayOf(b)) - toUtcMs(dayOf(a))) / 86400000);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  const y = +date.slice(0, 4), m = +date.slice(5, 7);
  return makeDate(y, m, daysInMonth(y, m));
}

export const inRange = (date: string, start?: string, end?: string) =>
  (!start || dayOf(date) >= start) && (!end || dayOf(date) <= end);

// ------------------------------------------------------------ formatting

export type DateFormat = 'D MMM YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
let currentFormat: DateFormat = 'D MMM YYYY';
export function setDateFormat(f: DateFormat) {
  currentFormat = f;
}

export function formatDate(date: string | undefined | null, opts: { time?: boolean; format?: DateFormat } = {}): string {
  if (!date) return '';
  const y = +date.slice(0, 4), m = +date.slice(5, 7), d = +date.slice(8, 10);
  if (!y || !m || !d) return date;
  const fmt = opts.format ?? currentFormat;
  let out: string;
  if (fmt === 'DD/MM/YYYY') out = `${pad(d)}/${pad(m)}/${y}`;
  else if (fmt === 'YYYY-MM-DD') out = date.slice(0, 10);
  else out = `${d} ${MONTH_SHORT[m - 1]} ${y}`;
  if (opts.time && date.length > 10) out += ` ${date.slice(11, 16)}`;
  return out;
}

export function formatDateLong(date: string): string {
  const y = +date.slice(0, 4), m = +date.slice(5, 7), d = +date.slice(8, 10);
  return `${d} ${MONTH_LONG[m - 1]} ${y}`;
}

export function formatMonthYear(date: string): string {
  return `${MONTH_SHORT[+date.slice(5, 7) - 1]} ${date.slice(0, 4)}`;
}

export function formatPeriod(start: string, end: string): string {
  return `${formatDateLong(start)} – ${formatDateLong(end)}`;
}

/** Days until a date (negative = overdue). */
export function daysUntil(date: string, today = todayStr()): number {
  return daysBetween(today, date);
}

export function relativeDays(n: number): string {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 0) return n < 60 ? `in ${n} days` : `in ${Math.round(n / 30)} months`;
  const a = -n;
  return a < 60 ? `${a} days ago` : `${Math.round(a / 30)} months ago`;
}

// ------------------------------------------------------------ periods

export interface Period {
  start: string;
  end: string;
  label: string;
}

/** Reporting year containing `date`, where the year starts in `startMonth` (1-12). */
export function reportingYear(date: string, startMonth: number): Period {
  const y = +date.slice(0, 4), m = +date.slice(5, 7);
  const sy = m >= startMonth ? y : y - 1;
  const start = makeDate(sy, startMonth, 1);
  const end = addDays(addMonths(start, 12), -1);
  const label = startMonth === 1 ? `${sy}` : `${sy}/${String(sy + 1).slice(2)}`;
  return { start, end, label };
}

export function periodPresets(today: string, yearStartMonth: number): Array<Period & { key: string }> {
  const y = +today.slice(0, 4);
  const thisRy = reportingYear(today, yearStartMonth);
  const lastRy = reportingYear(addDays(thisRy.start, -1), yearStartMonth);
  const q = Math.floor((+today.slice(5, 7) - 1) / 3);
  const qStart = makeDate(y, q * 3 + 1, 1);
  const lastQStart = addMonths(qStart, -3);
  const ryName = yearStartMonth === 1 ? 'year' : 'reporting year';
  return [
    { key: 'lastRy', ...lastRy, label: `Last ${ryName} (${lastRy.label})` },
    { key: 'thisRy', ...thisRy, label: `This ${ryName} to date (${thisRy.label})`, end: today },
    { key: 'last12', start: addDays(addMonths(today, -12), 1), end: today, label: 'Last 12 months' },
    { key: 'lastQ', start: lastQStart, end: addDays(qStart, -1), label: `Last quarter (Q${((q + 3) % 4) + 1} ${lastQStart.slice(0, 4)})` },
    { key: 'lastCal', start: makeDate(y - 1, 1, 1), end: makeDate(y - 1, 12, 31), label: `Calendar year ${y - 1}` },
    { key: 'ytd', start: makeDate(y, 1, 1), end: today, label: `Calendar year ${y} to date` },
    { key: 'all', start: '1900-01-01', end: '2199-12-31', label: 'All data' },
  ];
}
