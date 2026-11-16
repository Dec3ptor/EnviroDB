// Soil, sediment and leach-test results. A lab reports arsenic in a soil ("Arsenic, 12 mg/kg dry wt") and in the
// extract of a leaching test of it ("TCLP Arsenic, 0.02 mg/L") under the name it uses for arsenic in water. Each is a
// different measurement, with a parameter of its own – the counterpart of the water one – and which a result is for
// is told from its unit (per kilogram: a soil) or the test's name (TCLP, SPLP).

import type { Matrix, Parameter } from '../db/types';
import { buildParamIndex, matchParameter, type ParamIndex, type ParamMatch } from './matching';
import { unitDim } from './units';

const TCLP = /\btclp\b|toxicity\s+characteristic\s+leaching/i;
const SPLP = /\bsplp\b|synthetic\s+precipitation\s+leaching/i;

/** What a result was measured in, from how the file gives it – null: water, as most are. */
export function matrixOf(analyte: string, group: string | undefined, unit: string | undefined): Matrix | null {
  const said = `${analyte} ${group ?? ''}`;
  if (TCLP.test(said)) return 'tclp';
  if (SPLP.test(said)) return 'splp';
  return unitDim(unit) === 'soil' ? 'soil' : null;
}

export const MATRIX_TEXT: Record<Matrix, { label: string; long: string; group: string; unit: string }> = {
  soil: { label: 'soil', long: 'Soil or sediment', group: 'Soil', unit: 'mg/kg' },
  tclp: { label: 'TCLP', long: 'TCLP extract', group: 'Leach tests', unit: 'mg/L' },
  splp: { label: 'SPLP', long: 'SPLP extract', group: 'Leach tests', unit: 'mg/L' },
};

/** An analyte's name without the words that only say what it was measured in: "TCLP Arsenic", "Arsenic (TCLP)", "Lead in soil". */
export function bareAnalyte(name: string): string {
  return name
    .replace(/\(\s*(tclp|splp)(\s+(extract|leachate))?\s*\)/gi, ' ')
    .replace(/\b(tclp|splp)(\s+(extract(able)?|leachate|leachable))?\b\s*[-–:]?/gi, ' ')
    .replace(/\btoxicity\s+characteristic\s+leaching(\s+procedure)?\b\s*[-–:]?/gi, ' ')
    .replace(/\bsynthetic\s+precipitation\s+leaching(\s+procedure)?\b\s*[-–:]?/gi, ' ')
    .replace(/\s*(?:[-–—:,]|\bin)\s*(?:soils?|sediments?|solids?|dry\s*(?:weight|wt|matter))\s*$/i, '')
    .replace(/\s*\(\s*(?:soils?|sediments?|dry\s*(?:weight|wt))\s*\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–:,]+|[\s\-–:,]+$/g, '')
    .trim();
}

/** The id of a water parameter's counterpart. */
export const twinId = (baseId: string, matrix: Matrix): string => `${baseId}-${matrix}`;

/** A water parameter's counterpart in a soil or a leach test, as it's added: "Arsenic (soil)", mg/kg. */
export function twinOf(base: Parameter, matrix: Matrix): Parameter {
  const t = MATRIX_TEXT[matrix];
  // a metal in a soil is the total recoverable metal: "Arsenic (soil)", not "Total Arsenic (soil)"
  const name = base.name.replace(/^Total\s+(?=[A-Z])/, '');
  const short = base.short?.replace(/\s*\((T|D|AS)\)$/, '');
  return {
    id: twinId(base.id, matrix),
    name: `${name} (${t.label})`,
    ...(short ? { short: `${short} (${t.label})` } : {}),
    group: t.group,
    unit: t.unit,
    aliases: [],
    order: base.order,
    ...(base.decimals !== undefined && matrix !== 'soil' ? { decimals: base.decimals } : {}),
    matrix,
    of: base.id,
  };
}

export interface MatrixIndexes {
  water: ParamIndex;
  soil: ParamIndex;
  tclp: ParamIndex;
  splp: ParamIndex;
  all: Parameter[];
}

export function buildIndexes(params: Parameter[]): MatrixIndexes {
  return { water: buildParamIndex(params), soil: buildParamIndex(params, 'soil'), tclp: buildParamIndex(params, 'tclp'), splp: buildParamIndex(params, 'splp'), all: params };
}

/**
 * The parameter a file's analyte goes to. In water, as ever. In a soil or a leach test: the parameter of that kind
 * that goes by the name, else the counterpart of the water parameter the name is for – and where there's none yet,
 * which to add (`twin`).
 */
export function matchAnalyte(analyte: string, group: string | undefined, unit: string | undefined, ix: MatrixIndexes): ParamMatch {
  const matrix = matrixOf(analyte, group, unit);
  if (!matrix) return matchParameter(analyte, ix.water, group);
  const name = bareAnalyte(analyte) || analyte;
  const own = matchParameter(name, ix[matrix], group);
  if (own.parameterId && (own.confidence === 'exact' || own.confidence === 'high')) return own;
  const base = matchParameter(name, ix.water, group);
  // a metal named without its fraction ("Arsenic"): in a soil or its extract, the total
  const baseId = base.parameterId ?? base.candidates.find((id) => id.endsWith('-t')) ?? null;
  if (baseId && (base.parameterId ? base.confidence !== 'low' : true)) {
    const twin = ix.all.find((p) => p.matrix === matrix && p.of === baseId);
    if (twin) return { parameterId: twin.id, confidence: 'high', candidates: [twin.id] };
    return { parameterId: null, confidence: 'none', candidates: own.candidates, twin: { matrix, of: baseId } };
  }
  return { parameterId: null, confidence: own.candidates.length ? 'low' : 'none', candidates: own.candidates, twin: { matrix } };
}
