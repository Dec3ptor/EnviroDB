import { describe, expect, it } from 'vitest';
import type { EcoRecord, EcoSurvey, Taxon } from '../src/db/types';
import { CODE_COUNT, countsOf, ecoIndices, indicesCsv, indicesTable, isEpt, mergedRecords, parseRecords, parseTable, parseTaxa, recordCount, recordsCsv, scoreOf, surveysIn, taxaTable, taxonKey } from '../src/lib/ecology';

const taxa = (list: Array<Partial<Taxon> & { name: string }>) => new Map(list.map((t) => [taxonKey(t.name), { id: taxonKey(t.name), ...t } as Taxon]));
const LIST = taxa([
  { name: 'Deleatidium', group: 'Ephemeroptera', mci: 8, mciSb: 5.6 },
  { name: 'Aoteapsyche', group: 'Trichoptera', mci: 4 },
  { name: 'Oxyethira', group: 'Trichoptera', mci: 2, ept: false },
  { name: 'Potamopyrgus', group: 'Mollusca', mci: 4, mciSb: 2.1 },
  { name: 'Chironomus', group: 'Diptera', mci: 1 },
  { name: 'Zelandoperla', group: 'Plecoptera', mci: 10 },
]);
const rec = (taxon: string, n?: number, code?: EcoRecord['code']): EcoRecord => ({ taxon, ...(n !== undefined ? { n } : {}), ...(code ? { code } : {}) });

describe('how a survey is counted', () => {
  it('numbers, coded abundances (as the numbers they stand for), or only noted as present', () => {
    expect(CODE_COUNT).toEqual({ R: 1, C: 5, A: 20, VA: 100, VVA: 500 });
    expect(recordCount(rec('a', 12))).toBe(12);
    expect(recordCount(rec('a', undefined, 'VA'))).toBe(100);
    expect(recordCount(rec('a'))).toBe(1);
    expect(recordCount(rec('a', -3))).toBe(0);
    expect(countsOf([rec('a', 1), rec('b', 2)])).toBe('counts');
    expect(countsOf([rec('a', undefined, 'R'), rec('b', undefined, 'C')])).toBe('coded');
    expect(countsOf([rec('a'), rec('b')])).toBe('presence');
    expect(countsOf([rec('a', 1), rec('b', undefined, 'C')])).toBe('mixed');
    expect(countsOf([])).toBe('none');
  });

  it('a taxon entered twice is one line: numbers add, the higher code stands', () => {
    expect(mergedRecords([rec('Deleatidium', 4), rec(' deleatidium ', 6), rec('Chironomus', 1)])).toEqual([rec('Deleatidium', 10), rec('Chironomus', 1)]);
    expect(mergedRecords([rec('A', undefined, 'C'), rec('a', undefined, 'VA'), rec('a', undefined, 'R')])).toEqual([rec('A', undefined, 'VA')]);
    // a number and a code: the code as its number
    expect(mergedRecords([rec('A', 3), rec('A', undefined, 'C')])).toEqual([{ taxon: 'A', n: 8, code: undefined }]);
    expect(mergedRecords([rec('  ', 3)])).toEqual([]);
  });
});

describe('diversity', () => {
  it('Shannon, evenness and Simpson – worked by hand', () => {
    const two = ecoIndices({ records: [rec('a', 10), rec('b', 10)] }, new Map());
    expect(two.richness).toBe(2);
    expect(two.total).toBe(20);
    expect(two.shannon).toBeCloseTo(Math.LN2, 12);
    expect(two.evenness).toBeCloseTo(1, 12);
    expect(two.simpson).toBeCloseTo(0.5, 12);
    // 50, 30, 20: H′ = 1.0297, J′ = 0.9372, 1 − D = 0.62
    const three = ecoIndices({ records: [rec('a', 50), rec('b', 30), rec('c', 20)] }, new Map());
    expect(three.shannon).toBeCloseTo(1.0297, 4);
    expect(three.evenness).toBeCloseTo(0.9372, 3);
    expect(three.simpson).toBeCloseTo(0.62, 12);
    expect(three.dominant).toEqual({ taxon: 'a', share: 0.5 });
    expect(three.approximate).toBe(false);
  });

  it('one taxon has no evenness; taxa only noted as present have no numbers', () => {
    const one = ecoIndices({ records: [rec('a', 7)] }, new Map());
    expect(one).toMatchObject({ richness: 1, total: 7, evenness: null });
    expect(one.shannon).toBeCloseTo(0, 12);
    const seen = ecoIndices({ records: [rec('a'), rec('b'), rec('c')] }, new Map());
    expect(seen).toMatchObject({ richness: 3, total: null, shannon: null, simpson: null, dominant: null, qmci: null });
    expect(ecoIndices({ records: [] }, new Map())).toMatchObject({ richness: 0, total: null, mci: null, ept: null });
  });
});

describe('stream invertebrates', () => {
  it('MCI from which taxa are there; QMCI from how many of each', () => {
    // scores 8, 4, 1: MCI = 20 × 13 / 3 = 86.67; QMCI = (10×8 + 30×4 + 60×1) / 100 = 2.6
    const x = ecoIndices({ records: [rec('Deleatidium', 10), rec('Aoteapsyche', 30), rec('Chironomus', 60)] }, LIST);
    expect(x.mci).toBeCloseTo(86.667, 3);
    expect(x.qmci).toBeCloseTo(2.6, 12);
    expect(x.qmciKind).toBe('QMCI');
    expect(x.scored).toBe(3);
    expect(x.unscored).toEqual([]);
  });

  it('SQMCI from coded abundances: rare 1, common 5, abundant 20, very abundant 100', () => {
    // R×8, A×4, VA×1 → (8 + 80 + 100) / 121 = 1.5537
    const x = ecoIndices({ records: [rec('Deleatidium', undefined, 'R'), rec('Aoteapsyche', undefined, 'A'), rec('Chironomus', undefined, 'VA')] }, LIST);
    expect(x.qmci).toBeCloseTo(188 / 121, 10);
    expect(x.qmciKind).toBe('SQMCI');
    expect(x.mci).toBeCloseTo(86.667, 3);
    expect(x.approximate).toBe(true);
  });

  it('a taxon with no score is left out of both – and said', () => {
    const x = ecoIndices({ records: [rec('Deleatidium', 10), rec('Mystery worm', 90)] }, LIST);
    expect(x.mci).toBeCloseTo(160, 10);
    expect(x.qmci).toBeCloseTo(8, 10);
    expect(x.scored).toBe(1);
    expect(x.unscored).toEqual(['Mystery worm']);
    expect(x.richness).toBe(2);
    // no scores at all: no index
    expect(ecoIndices({ records: [rec('Mystery worm', 90)] }, LIST)).toMatchObject({ mci: null, qmci: null, scored: 0 });
  });

  it('a soft-bottomed stream takes the soft-bottom scores (the hard-bottom one where a taxon has no other)', () => {
    expect(scoreOf(LIST.get('deleatidium'), 'soft')).toBe(5.6);
    expect(scoreOf(LIST.get('aoteapsyche'), 'soft')).toBe(4);
    expect(scoreOf(LIST.get('deleatidium'))).toBe(8);
    expect(scoreOf(undefined)).toBeUndefined();
    const x = ecoIndices({ bed: 'soft', records: [rec('Deleatidium', 1), rec('Potamopyrgus', 1)] }, LIST);
    expect(x.mci).toBeCloseTo((20 * (5.6 + 2.1)) / 2, 10);
  });

  it('EPT: mayflies, stoneflies and caddisflies by their group – unless the list says otherwise', () => {
    expect(isEpt(LIST.get('deleatidium'))).toBe(true);
    expect(isEpt(LIST.get('zelandoperla'))).toBe(true);
    expect(isEpt(LIST.get('oxyethira'))).toBe(false); // marked not EPT in the list
    expect(isEpt(LIST.get('chironomus'))).toBe(false);
    expect(isEpt({ group: 'Caddisflies' })).toBe(true);
    expect(isEpt(undefined)).toBe(false);
    const x = ecoIndices({ records: [rec('Deleatidium', 30), rec('Zelandoperla', 10), rec('Oxyethira', 20), rec('Chironomus', 40)] }, LIST);
    expect(x.ept).toEqual({ taxa: 2, taxaShare: 0.5, share: 0.4 });
    // nothing known about the taxa: no EPT figure rather than a nought
    expect(ecoIndices({ records: [rec('x', 1), rec('y', 2)] }, new Map()).ept).toBeNull();
  });
});

describe('records pasted in', () => {
  it('from a spreadsheet: a taxon, then a number, a coded abundance or nothing, then a note', () => {
    const got = parseRecords('Taxon\tCount\tNote\nDeleatidium\t42\n Aoteapsyche \tVA\tlarge\nPotamopyrgus\t\nChironomus\tpresent\nElmidae\t3 larvae\n\n12\t5\n');
    expect(got.records).toEqual([
      { taxon: 'Deleatidium', n: 42 },
      { taxon: 'Aoteapsyche', code: 'VA', note: 'large' },
      { taxon: 'Potamopyrgus' },
      { taxon: 'Chironomus' },
      // words with the number: kept as written, not guessed at
      { taxon: 'Elmidae', note: '3 larvae' },
    ]);
    expect(got.skipped).toEqual(['12']);
  });

  it('typed a line each: a comma, or the number at the end', () => {
    expect(parseRecords('Longfin eel 3\nCommon bully, 12\nKōura\nInanga  a\n').records).toEqual([{ taxon: 'Longfin eel', n: 3 }, { taxon: 'Common bully', n: 12 }, { taxon: 'Kōura' }, { taxon: 'Inanga', code: 'A' }]);
    expect(parseRecords('').records).toEqual([]);
    // words that aren't a count are kept as a note
    expect(parseRecords('Tūī\theard only').records).toEqual([{ taxon: 'Tūī', note: 'heard only' }]);
  });
});

describe('a taxa list pasted in', () => {
  it('under headings, in any order', () => {
    const got = parseTaxa('Order\tTaxon\tMCI-sb\tMCI\tCommon name\nEphemeroptera\tDeleatidium\t5.6\t8\tmayfly\nDiptera\tChironomus\t\t1\t\n\t\t\t\t\n');
    expect(got.taxa).toEqual([
      { id: 'deleatidium', name: 'Deleatidium', group: 'Ephemeroptera', mci: 8, mciSb: 5.6, common: 'mayfly' },
      { id: 'chironomus', name: 'Chironomus', group: 'Diptera', mci: 1 },
    ]);
  });

  it('without headings: the taxon, its hard-bottom score, its soft-bottom score', () => {
    expect(parseTaxa('Deleatidium\t8\t5.6\nPotamopyrgus\t4\n99\t1\nOdd one\t42').taxa).toEqual([
      { id: 'deleatidium', name: 'Deleatidium', mci: 8, mciSb: 5.6 },
      { id: 'potamopyrgus', name: 'Potamopyrgus', mci: 4 },
      // a score outside 1–10 isn't one
      { id: 'odd one', name: 'Odd one' },
    ]);
    expect(parseTaxa('Deleatidium, 8, 5.6').taxa).toEqual([{ id: 'deleatidium', name: 'Deleatidium', mci: 8, mciSb: 5.6 }]);
    expect(parseTaxa('').taxa).toEqual([]);
  });
});

describe('a worked example from a published guide', () => {
  it('NIWA’s stream health kit manual: five kinds, scores 8, 9, 10, 2, 4 – 132, and 5.3 by abundance', () => {
    // (the same arithmetic as the MCI and QMCI: the mean score × 20, and the mean score weighted by the numbers)
    const kit = taxa([{ name: 'Flat mayfly', mci: 8 }, { name: 'Smooth caddisfly', mci: 9 }, { name: 'Green stonefly', mci: 10 }, { name: 'Midge', mci: 2 }, { name: 'Mud snail', mci: 4 }]);
    const x = ecoIndices({ records: [rec('Flat mayfly', 5), rec('Smooth caddisfly', 20), rec('Green stonefly', 1), rec('Midge', 20), rec('Mud snail', 20)] }, kit);
    expect(x.mci).toBeCloseTo(132, 10);
    expect(x.qmci).toBeCloseTo(350 / 66, 10);
    expect(x.qmci!.toFixed(1)).toBe('5.3');
  });
});

describe('a results table pasted in: taxa down, samples across', () => {
  it('a taxonomist’s table: a column a site, totals and indices at the foot left out', () => {
    const got = parseTable('Taxon\tOrder\tUS1\tDS1\tNotes\nDeleatidium\tEphemeroptera\t42\t3\t\nAoteapsyche\tTrichoptera\t18\t\tlarge\nPotamopyrgus\tMollusca\t0\t260\t\nChironomus\tDiptera\tP\tVA\t\n\t\t\t\t\nNumber of taxa\t\t4\t3\t\nMCI\t\t97\t64\t\n')!;
    expect(got.columns.map((c) => c.header)).toEqual(['US1', 'DS1']);
    expect(got.columns[0].records).toEqual([{ taxon: 'Deleatidium', n: 42 }, { taxon: 'Aoteapsyche', n: 18 }, { taxon: 'Chironomus' }]);
    expect(got.columns[1].records).toEqual([{ taxon: 'Deleatidium', n: 3 }, { taxon: 'Potamopyrgus', n: 260 }, { taxon: 'Chironomus', code: 'VA' }]);
    expect(got.taxa).toEqual([
      { id: 'deleatidium', name: 'Deleatidium', group: 'Ephemeroptera' },
      { id: 'aoteapsyche', name: 'Aoteapsyche', group: 'Trichoptera' },
      { id: 'potamopyrgus', name: 'Potamopyrgus', group: 'Mollusca' },
      { id: 'chironomus', name: 'Chironomus', group: 'Diptera' },
    ]);
    expect(got.skipped).toBe(2);
  });

  it('an eDNA lab’s table: a row a sequence, a column a sample number – a taxon’s rows added up', () => {
    const got = parseTable(
      'Sequence\tTarget\tScientificName\tRank\tTaxID\tCommonName\tGroup\t518902\t518903\n' +
        'ATCC\tCI\tDeleatidium lillii\tspecies\t1968926\tNZ mayfly\tInsects\t761\t0\n' +
        'ATCG\tCI\tDeleatidium lillii\tspecies\t1968926\tNZ mayfly\tInsects\t40\t12\n' +
        'GGTA\tWV\tGalaxias brevipinnis\tspecies\t66447\tKoaro\tFish\t121\t\n' +
        'TTTT\tRV\t\t\t\t\t\t55\t9\n',
    )!;
    expect(got.columns.map((c) => c.header)).toEqual(['518902', '518903']);
    expect(got.columns[0].records).toEqual([{ taxon: 'Deleatidium lillii', n: 801 }, { taxon: 'Galaxias brevipinnis', n: 121 }]);
    expect(got.columns[1].records).toEqual([{ taxon: 'Deleatidium lillii', n: 12 }]);
    expect(got.taxa.map((t) => [t.name, t.group, t.common])).toEqual([['Deleatidium lillii', 'Insects', 'NZ mayfly'], ['Galaxias brevipinnis', 'Fish', 'Koaro']]);
    // the sequence with no name is left out
    expect(got.skipped).toBe(1);
  });

  it('not a table of counts: nothing', () => {
    expect(parseTable('Deleatidium')).toBeNull();
    expect(parseTable('Taxon\tNotes\nDeleatidium\tsmall ones\nAoteapsyche\tin riffles')).toBeNull();
    expect(parseTable('')).toBeNull();
    // a column with nothing found in it isn't a survey
    expect(parseTable('Taxon\tA\tB\nDeleatidium\t4\t0\nAoteapsyche\t2\t')!.columns.map((c) => c.header)).toEqual(['A']);
  });
});

describe('out to a spreadsheet', () => {
  const surveys = [
    { id: 's2', projectId: 'p', siteId: 'a', date: '2026-03-02', kind: 'Stream invertebrates' as const, method: 'Kick net', records: [rec('Deleatidium', 10), rec('Chironomus', 30)], updatedAt: '' },
    { id: 's1', projectId: 'p', place: 'Wetland edge', date: '2026-01-15', kind: 'Birds' as const, records: [{ taxon: 'Pūkeko', n: 4, note: 'two juveniles, "tame"' }], updatedAt: '' },
  ];
  const code = (id: string | undefined) => (id === 'a' ? 'DS1' : '');
  it('every record a line, the earliest survey first', () => {
    expect(recordsCsv(surveys, code, LIST).split('\r\n')).toEqual([
      'Date,Site,Survey,Method,Taxon,Group,Count,Coded abundance,Note',
      '2026-01-15,Wetland edge,Birds,,Pūkeko,,4,,"two juveniles, ""tame"""',
      '2026-03-02,DS1,Stream invertebrates,Kick net,Deleatidium,Ephemeroptera,10,,',
      '2026-03-02,DS1,Stream invertebrates,Kick net,Chironomus,Diptera,30,,',
      '',
    ]);
  });
  it('and each survey’s indices', () => {
    const lines = indicesCsv(surveys, code, LIST).split('\r\n');
    expect(lines[0]).toBe('Date,Site,Survey,Method,Taxa,Individuals,Shannon H,Evenness J,Simpson 1-D,EPT taxa,% EPT taxa,% EPT individuals,MCI,QMCI / SQMCI,Taxa scored,Scores from');
    // scores 8 and 1: MCI 90, QMCI (80 + 30) / 40 = 2.75
    expect(lines[2]).toBe('2026-03-02,DS1,Stream invertebrates,Kick net,2,40,0.562,0.811,0.375,1,50,25,90,2.75,2,');
    expect(lines[1]).toBe('2026-01-15,Wetland edge,Birds,,1,4,0,,0,,,,,,0,');
  });
});

describe('for a report', () => {
  const list = taxa([
    { name: 'Deleatidium', group: 'Ephemeroptera', mci: 8 },
    { name: 'Aoteapsyche', group: 'Trichoptera', mci: 4 },
    { name: 'Potamopyrgus', group: 'Mollusca', mci: 4 },
    { name: 'Oligochaeta', mci: 1 },
  ]);
  const code = (id: string | undefined) => ({ a: 'US1', b: 'DS1' })[id ?? ''] ?? '';
  const survey = (over: Partial<EcoSurvey>): EcoSurvey => ({ id: 'x', projectId: 'p', date: '2026-03-02', kind: 'Stream invertebrates', records: [], updatedAt: '', ...over });
  const up = survey({ id: 's1', siteId: 'a', scores: 'Stark & Maxted 2007', records: [rec('Deleatidium', 60), rec('Aoteapsyche', 30), rec('Potamopyrgus', 10)] });
  const down = survey({ id: 's2', siteId: 'b', scores: 'Stark & Maxted 2007', records: [rec('Potamopyrgus', undefined, 'VA'), rec('Oligochaeta', undefined, 'A'), rec('Mystery worm', undefined, 'R')] });
  const birds = survey({ id: 's3', place: 'Wetland', kind: 'Birds', date: '2026-04-10', records: [rec('Pūkeko', 3), rec('Kōtare')] });
  const earlier = survey({ id: 's0', siteId: 'b', date: '2025-03-01', records: [rec('Deleatidium', 5)] });

  it('the surveys of a period, the earliest first and by site within a day; of some kinds', () => {
    const all = [birds, down, earlier, up];
    expect(surveysIn(all, '2026-01-01', '2026-12-31', [], code).map((s) => s.id)).toEqual(['s2', 's1', 's3']); // DS1 before US1
    expect(surveysIn(all, '2026-01-01', '2026-12-31', ['Birds'], code).map((s) => s.id)).toEqual(['s3']);
    expect(surveysIn(all, '2025-01-01', '2025-12-31', undefined, code).map((s) => s.id)).toEqual(['s0']);
    expect(surveysIn(all, '2027-01-01', '2027-12-31', [], code)).toEqual([]);
  });

  it('a line a survey with its indices; what the abbreviations mean and where the scores are from underneath', () => {
    const t = indicesTable([up, down], code, list);
    expect(t.head).toEqual(['Date', 'Site', 'Taxa', 'Individuals', 'H′', 'EPT taxa', '% EPT taxa', 'MCI', 'QMCI']);
    expect(t.numeric).toEqual([false, false, true, true, true, true, true, true, true]);
    // upstream: 3 taxa, 100 animals; scores 8, 4, 4 → MCI 107; QMCI (480 + 120 + 40) / 100 = 6.40
    expect(t.rows[0]).toEqual(['2 Mar 2026', 'US1', '3', '100', '0.90', '2', '67%', '107', '6.40']);
    // downstream, coded: 100 + 20 + 1; the unknown worm has no score – MCI 20 × (4 + 1) / 2 = 50; SQMCI (400 + 20) / 120 = 3.50
    expect(t.rows[1]).toEqual(['2 Mar 2026', 'DS1', '3', '121', '0.49', '0', '0%', '50', '3.50*']);
    expect(t.notes[0]).toMatch(/^Taxa: how many kinds were found\. H′: Shannon’s diversity index/);
    expect(t.notes).toContain('* SQMCI. Individuals and H′ are approximate where abundances were coded.');
    expect(t.notes).toContain('Tolerance scores: Stark & Maxted 2007.');
    expect(t.notes).toContain('Left out of the MCI and QMCI, having no tolerance score: Mystery worm.');
    expect(t.notes.some((n) => n.startsWith('EPT: mayflies, stoneflies and caddisflies'))).toBe(true);
    expect(t.notes.some((n) => n.startsWith('Where abundances were coded (R, C, A, VA, VVA – taken as 1, 5, 20, 100 and 500)'))).toBe(true);
  });

  it('surveys of more than one kind: which kind is said, and the stream columns are for the stream surveys only', () => {
    const t = indicesTable([up, birds], code, list);
    expect(t.head.slice(0, 3)).toEqual(['Date', 'Site', 'Survey']);
    // the birds: one counted and one only noted as there – 3 + 1
    expect(t.rows[1]).toEqual(['10 Apr 2026', 'Wetland', 'Birds', '2', '4', '0.56', '–', '–', '–', '–']);
    // birds alone: no stream columns, no stream notes
    const only = indicesTable([birds], code, list);
    expect(only.head).toEqual(['Date', 'Site', 'Taxa', 'Individuals', 'H′']);
    expect(only.notes).toEqual([only.notes[0], 'Individuals and H′ are approximate where a taxon was only noted as present (counted as one).']);
  });

  it('the taxa found, a column a survey: by group then name, with the indices at the foot', () => {
    const t = taxaTable([up, down], code, list);
    expect(t.head).toEqual(['Taxon', 'Group', 'US1\n2 Mar 2026', 'DS1\n2 Mar 2026']);
    expect(t.rows).toEqual([
      ['Deleatidium', 'Ephemeroptera', '60', ''],
      ['Potamopyrgus', 'Mollusca', '10', 'VA'],
      ['Aoteapsyche', 'Trichoptera', '30', ''],
      ['Mystery worm', '', '', 'R'],
      ['Oligochaeta', '', '', 'A'],
    ]);
    expect(t.foot).toEqual([
      ['Number of taxa', '', '3', '3'],
      ['EPT taxa', '', '2', '0'],
      ['MCI', '', '107', '50'],
      ['QMCI', '', '6.40', '3.50*'],
    ]);
    expect(t.notes[0]).toMatch(/^Coded abundances: R rare \(1–4\)/);
    expect(t.notes).toContain('* SQMCI.');
    // birds: no groups, one only noted as there; nothing about streams
    const b = taxaTable([birds], code, list);
    expect(b.head).toEqual(['Taxon', 'Wetland\n10 Apr 2026']);
    expect(b.rows).toEqual([['Kōtare', 'P'], ['Pūkeko', '3']]);
    expect(b.foot).toEqual([['Number of taxa', '2']]);
    expect(b.notes).toEqual(['P: present (not counted).']);
  });

  it('the indices to a spreadsheet say where the scores are from', () => {
    const lines = indicesCsv([up], code, list).trim().split('\r\n');
    expect(lines[0].endsWith(',Taxa scored,Scores from')).toBe(true);
    expect(lines[1].endsWith(',3,Stark & Maxted 2007')).toBe(true);
  });
});
