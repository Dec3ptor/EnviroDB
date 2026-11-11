// Purging a monitoring bore before it's sampled: how much water stands in the casing, how much to take out, and
// whether the readings taken as it's purged have settled. Worked out on the phone at the bore; the log comes back to
// the computer with the sample.

/** Litres of water in a metre of casing of this inside diameter (mm): 1.96 L in 50 mm casing. */
export const litresPerMetre = (diameterMm: number): number => (Math.PI * diameterMm * diameterMm) / 4000;

/**
 * The water standing in a bore (L): from its depth and the depth to water (both m below the top of the casing) and
 * the casing's inside diameter (mm). Null when one is missing, or the water level is at or below the bottom.
 */
export function casingVolume(depth: number | undefined, depthToWater: number | undefined, diameterMm: number | undefined): number | null {
  if (depth === undefined || depthToWater === undefined || diameterMm === undefined) return null;
  if (![depth, depthToWater, diameterMm].every(Number.isFinite) || diameterMm <= 0) return null;
  const column = depth - depthToWater;
  return column > 0 ? litresPerMetre(diameterMm) * column : null;
}

/** A reading taken as the bore is purged. */
export interface PurgeReading {
  /** 'HH:mm' */
  time: string;
  /** Litres taken out so far. */
  litres?: number;
  /** The depth to water as it's pumped (m below the top of the casing) – for the drawdown. */
  level?: number;
  /** The meter's readings, by parameter. */
  values: Record<string, number>;
}

/** A bore's purge, as recorded on the phone and kept with its sample. */
export interface PurgeLog {
  /** What the volumes were worked out from: the bore's depth and the depth to water before purging (m below the top of the casing), the casing's inside diameter (mm). */
  depth?: number;
  swl?: number;
  diameter?: number;
  /** The casing volumes aimed for (3 unless changed). */
  volumes?: number;
  readings: PurgeReading[];
  /** The criteria the readings were judged by on the phone, where they weren't the usual ones. */
  rules?: StableRule[];
}

/** How close a reading's last few values are to be for it to count as settled. */
export interface StableRule {
  /** The parameter. */
  id: string;
  label: string;
  /** Within this much of each other … */
  tol: number;
  /** … in the reading's own unit, or as a percentage of their mean. */
  kind: 'abs' | 'pct';
  unit?: string;
}

/**
 * The criteria for a bore's readings to have settled that the helper starts with: each of the last three readings
 * within these of each other. They're values in common use for low-flow sampling, not taken from one standard – a
 * sampling plan sets its own, and they can be changed where they're used.
 */
export const STABLE_RULES: StableRule[] = [
  { id: 'ph-field', label: 'pH', tol: 0.1, kind: 'abs' },
  { id: 'ec-field', label: 'EC', tol: 3, kind: 'pct' },
  { id: 'temp', label: 'Temperature', tol: 0.2, kind: 'abs', unit: '°C' },
  { id: 'do', label: 'DO', tol: 0.3, kind: 'abs', unit: 'mg/L' },
  { id: 'do-sat', label: 'DO %', tol: 10, kind: 'pct' },
  { id: 'orp', label: 'ORP', tol: 10, kind: 'abs', unit: 'mV' },
  { id: 'turbidity-field', label: 'Turbidity', tol: 10, kind: 'pct' },
];

/** The usual criteria with tolerances of one's own over them (by parameter) – a tolerance that isn't a positive number is left as usual. */
export function withTolerances(own: Record<string, number> | undefined, rules: StableRule[] = STABLE_RULES): StableRule[] {
  return rules.map((r) => {
    const t = own?.[r.id];
    return typeof t === 'number' && Number.isFinite(t) && t > 0 ? { ...r, tol: t } : r;
  });
}

/** Whether some criteria are the usual ones. */
export const usualRules = (rules: StableRule[]): boolean => rules.length === STABLE_RULES.length && rules.every((r, i) => r.id === STABLE_RULES[i].id && r.tol === STABLE_RULES[i].tol && r.kind === STABLE_RULES[i].kind);

/** A rule in words: "within 0.1", "within 3%". */
export const ruleText = (r: Pick<StableRule, 'tol' | 'kind' | 'unit'>): string => `within ${r.tol}${r.kind === 'pct' ? '%' : r.unit ? ` ${r.unit}` : ''}`;

export interface StableCheck {
  id: string;
  label: string;
  /** The last few values, oldest first. */
  values: number[];
  /** How far apart they are (largest − smallest), and how far they may be. */
  spread: number;
  allowed: number;
  ok: boolean;
}

export interface Stability {
  /** Every reading that has a rule is settled. */
  stable: boolean;
  /** There are enough readings to say (three of at least one reading with a rule). */
  enough: boolean;
  checks: StableCheck[];
}

/**
 * Whether the readings have settled: for each parameter with a rule, its last `n` values (in the readings that have
 * it) are within the rule's tolerance of each other – largest less smallest, against the tolerance itself or that
 * percentage of their mean. A parameter with fewer than `n` values isn't judged yet.
 */
export function stability(readings: PurgeReading[], rules: StableRule[] = STABLE_RULES, n = 3): Stability {
  const checks: StableCheck[] = [];
  for (const rule of rules) {
    const all = readings.map((r) => r.values[rule.id]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (all.length < n) continue;
    const values = all.slice(-n);
    const spread = Math.max(...values) - Math.min(...values);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const allowed = rule.kind === 'pct' ? (Math.abs(mean) * rule.tol) / 100 : rule.tol;
    // (a hair's allowance for decimal arithmetic: 7.1 − 7.0 is a little over 0.1 in floating point)
    checks.push({ id: rule.id, label: rule.label, values, spread, allowed, ok: spread <= allowed + 1e-9 });
  }
  return { stable: checks.length > 0 && checks.every((c) => c.ok), enough: checks.length > 0, checks };
}

export interface PurgeProgress {
  /** The water standing in the casing (L) – null when it can't be worked out. */
  casing: number | null;
  /** How much to take out (L): the casing volumes aimed for. */
  target: number | null;
  /** How much has been taken out (the last reading's litres). */
  purged: number | null;
  /** That as casing volumes. */
  volumesPurged: number | null;
  /** How far the water level has dropped from where it started (m) – the last reading with a level. */
  drawdown: number | null;
}

export const DEFAULT_PURGE_VOLUMES = 3;

/** Where a purge has got to. */
export function purgeProgress(log: PurgeLog): PurgeProgress {
  const casing = casingVolume(log.depth, log.swl, log.diameter);
  const volumes = log.volumes && log.volumes > 0 ? log.volumes : DEFAULT_PURGE_VOLUMES;
  const litres = [...log.readings].reverse().find((r) => r.litres !== undefined)?.litres ?? null;
  const level = [...log.readings].reverse().find((r) => r.level !== undefined)?.level;
  return {
    casing,
    target: casing === null ? null : casing * volumes,
    purged: litres,
    volumesPurged: casing && litres !== null ? litres / casing : null,
    drawdown: level !== undefined && log.swl !== undefined ? level - log.swl : null,
  };
}

const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

/** The purge in a line, for the sample's notes and reports: "Purged 29.5 L (3.0 casing volumes of 9.8 L); readings settled after 5". */
export function purgeSummary(log: PurgeLog, rules: StableRule[] = log.rules ?? STABLE_RULES): string {
  const p = purgeProgress(log);
  const parts: string[] = [];
  if (p.purged !== null) parts.push(`Purged ${n1(p.purged)} L${p.volumesPurged !== null && p.casing !== null ? ` (${n1(p.volumesPurged)} casing volume${Math.abs(p.volumesPurged - 1) < 0.05 ? '' : 's'} of ${n1(p.casing)} L)` : ''}`);
  else if (p.casing !== null) parts.push(`Casing volume ${n1(p.casing)} L`);
  if (log.readings.length) {
    const s = stability(log.readings, rules);
    parts.push(s.enough ? (s.stable ? `readings settled after ${log.readings.length}` : `readings not settled after ${log.readings.length} (${s.checks.filter((c) => !c.ok).map((c) => c.label).join(', ')})`) : `${log.readings.length} reading${log.readings.length === 1 ? '' : 's'} taken`);
  }
  if (p.drawdown !== null && Math.abs(p.drawdown) >= 0.005) parts.push(`drawdown ${(Math.round(p.drawdown * 100) / 100).toString()} m`);
  const text = parts.join('; ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/** A purge log read from a file, checked: numbers only, a sensible size (anything else is dropped). */
export function checkPurge(x: unknown): PurgeLog | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const readings: PurgeReading[] = (Array.isArray(o.readings) ? o.readings : [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .slice(0, 60)
    .map((r) => ({
      time: typeof r.time === 'string' ? r.time.slice(0, 16) : '',
      ...(num(r.litres) !== undefined ? { litres: num(r.litres) } : {}),
      ...(num(r.level) !== undefined ? { level: num(r.level) } : {}),
      values: r.values && typeof r.values === 'object' ? (Object.fromEntries(Object.entries(r.values as Record<string, unknown>).filter(([k, v]) => k.length <= 80 && num(v) !== undefined).slice(0, 20)) as Record<string, number>) : {},
    }));
  const log: PurgeLog = { readings };
  for (const k of ['depth', 'swl', 'diameter', 'volumes'] as const) if (num(o[k]) !== undefined) log[k] = num(o[k]);
  const rules = (Array.isArray(o.rules) ? o.rules : [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .slice(0, 20)
    .flatMap((r): StableRule[] => {
      const tol = num(r.tol);
      return typeof r.id === 'string' && r.id.length <= 80 && tol !== undefined && tol >= 0 ? [{ id: r.id, label: typeof r.label === 'string' ? r.label.slice(0, 40) : r.id, tol, kind: r.kind === 'pct' ? 'pct' : 'abs', ...(typeof r.unit === 'string' ? { unit: r.unit.slice(0, 20) } : {}) }] : [];
    });
  if (rules.length) log.rules = rules;
  return readings.length || log.depth !== undefined || log.swl !== undefined || log.diameter !== undefined ? log : undefined;
}
