// How you'd like a graph: the settings behind the Graphs tab's Customise panel. Each graph's own settings sit over
// the ones shared by all the graphs; a setting left alone on a graph follows the shared one, so changing it for all
// graphs changes it there too.

import type { ChartEvent, ChartLook, ChartNote, ChartSpec } from './timeSeries';

export interface GraphSettings {
  /** Lines on the graph. */
  rules: boolean;
  trends: boolean;
  /** How it looks. */
  look: ChartLook;
  legend: 'top' | 'none';
  log: boolean;
  /** The value axis: fitted to the data, or a range of your own (either end may be left open). */
  yAxis: 'auto' | 'zero' | 'set';
  yMin?: number;
  yMax?: number;
  yLabel?: string;
  fontScale: 1 | 1.25;
  /** This graph only. */
  title?: string;
  subtitle?: string;
  /** Sites left off this graph. */
  hidden: string[];
  refLines: ChartNote[];
  events: ChartEvent[];
}

export const DEFAULT_GRAPH: GraphSettings = { rules: true, trends: false, look: { kind: 'lines', weight: 'normal' }, legend: 'top', log: false, yAxis: 'auto', fontScale: 1, hidden: [], refLines: [], events: [] };

/** The settings that "Apply the look to all graphs" copies: the look, not the graph's own text, sites and notes. */
export const SHARED_KEYS = ['rules', 'trends', 'look', 'legend', 'log', 'yAxis', 'yMin', 'yMax', 'fontScale'] as const satisfies ReadonlyArray<keyof GraphSettings>;
export type SharedKey = (typeof SHARED_KEYS)[number];

export type GraphOverrides = Partial<GraphSettings>;

/** A graph's settings: its own over the shared ones over the defaults. */
export function graphSettings(shared: Partial<GraphSettings>, own: GraphOverrides | undefined): GraphSettings {
  return { ...DEFAULT_GRAPH, ...stripUndefined(shared), ...stripUndefined(own ?? {}) };
}

const stripUndefined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** The look of one graph, as the shared settings for all: its own keep anything else (titles, notes, sites). */
export function shareLook(g: GraphSettings): Pick<GraphSettings, SharedKey> {
  return Object.fromEntries(SHARED_KEYS.map((k) => [k, g[k]])) as Pick<GraphSettings, SharedKey>;
}

/** A graph's own settings with the shared keys dropped, so it follows the shared look again. */
export function followShared(own: GraphOverrides): GraphOverrides {
  const out: GraphOverrides = { ...own };
  for (const k of SHARED_KEYS) delete out[k];
  return out;
}

/** Whether a graph has anything of its own. */
export const hasOwn = (own: GraphOverrides | undefined) => !!own && Object.values(own).some((v) => v !== undefined && !(Array.isArray(v) && !v.length));

/** The spec with the settings applied (the data, consent lines and trends are the caller's: they need the project). */
export function applyGraphSettings(spec: ChartSpec, g: GraphSettings): ChartSpec {
  const hidden = new Set(g.hidden);
  const yRange = g.yAxis === 'set' ? { min: g.yMin, max: g.yMax } : g.yAxis === 'zero' ? { min: 0 } : undefined;
  return {
    ...spec,
    title: g.title?.trim() || spec.title,
    subtitle: g.subtitle?.trim() || undefined,
    series: spec.series.filter((s) => !hidden.has(s.id)),
    trends: spec.trends?.filter((t) => !hidden.has(t.seriesId)),
    look: g.look,
    legend: g.legend,
    fontScale: g.fontScale,
    yLabel: g.yLabel?.trim() || undefined,
    ...(yRange && (yRange.min !== undefined || yRange.max !== undefined) ? { yRange } : {}),
    refLines: g.refLines.filter((n) => Number.isFinite(n.value)),
    events: g.events.filter((e) => /^\d{4}-\d{2}-\d{2}/.test(e.date)),
  };
}

/** Saved settings read back: only what's known, each of the right shape. */
export function reviveGraphs(v: unknown): Record<string, GraphOverrides> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, GraphOverrides> = {};
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    const o = reviveOne(raw);
    if (o) out[id] = o;
  }
  return out;
}

export function reviveOne(raw: unknown): GraphOverrides | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: GraphOverrides = {};
  const bool = (k: 'rules' | 'trends' | 'log') => typeof r[k] === 'boolean' && (out[k] = r[k] as boolean);
  bool('rules');
  bool('trends');
  bool('log');
  const lk = r.look as Partial<ChartLook> | undefined;
  if (lk && typeof lk === 'object' && ['lines', 'points', 'linesOnly'].includes(lk.kind as string) && ['light', 'normal', 'bold'].includes(lk.weight as string)) out.look = { kind: lk.kind!, weight: lk.weight! };
  if (r.legend === 'top' || r.legend === 'none') out.legend = r.legend;
  if (r.yAxis === 'auto' || r.yAxis === 'zero' || r.yAxis === 'set') out.yAxis = r.yAxis;
  if (typeof r.yMin === 'number' && Number.isFinite(r.yMin)) out.yMin = r.yMin;
  if (typeof r.yMax === 'number' && Number.isFinite(r.yMax)) out.yMax = r.yMax;
  if (r.fontScale === 1 || r.fontScale === 1.25) out.fontScale = r.fontScale;
  for (const k of ['yLabel', 'title', 'subtitle'] as const) if (typeof r[k] === 'string') out[k] = (r[k] as string).slice(0, 200);
  if (Array.isArray(r.hidden)) out.hidden = r.hidden.filter((x): x is string => typeof x === 'string').slice(0, 200);
  if (Array.isArray(r.refLines))
    out.refLines = r.refLines
      .filter((n): n is ChartNote => !!n && typeof n === 'object' && typeof (n as ChartNote).value === 'number' && Number.isFinite((n as ChartNote).value))
      .map((n) => ({ value: n.value, label: String(n.label ?? '').slice(0, 80), ...(typeof n.color === 'string' ? { color: n.color } : {}), ...(typeof n.dash === 'boolean' ? { dash: n.dash } : {}) }))
      .slice(0, 20);
  if (Array.isArray(r.events))
    out.events = r.events
      .filter((e): e is ChartEvent => !!e && typeof e === 'object' && typeof (e as ChartEvent).date === 'string')
      .map((e) => ({ date: e.date.slice(0, 10), label: String(e.label ?? '').slice(0, 80), ...(typeof e.color === 'string' ? { color: e.color } : {}) }))
      .slice(0, 20);
  return out;
}
