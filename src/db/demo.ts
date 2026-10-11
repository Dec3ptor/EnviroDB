import { db } from './db';
import type { ImportBatch, MonitoringSchedule, Project, ReportObligation, Result, Rule, Sample, Site } from './types';
import { newObligation, newProject, newRule, newSchedule, newSite } from './repo';
import { uid } from '../lib/ids';
import { addMonths, makeDate, todayStr } from '../lib/dates';

// Synthetic demonstration project – realistic-looking but entirely made-up data.

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function createDemoProject(): Promise<string> {
  const rand = rng(20240701);
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const lognorm = (median: number, sd: number) => median * Math.exp(gauss() * sd);

  const project: Project = newProject({
    name: 'Demo – Kōwhai Quarry stormwater discharge',
    code: 'DEMO-001',
    client: 'Demo Aggregates Ltd',
    consents: 'AUTH-123456 (demo)',
    regulator: 'Demo Regional Council',
    location: 'Kōwhai Valley (fictional)',
    description: 'Synthetic demonstration project. Stormwater from the quarry pit is treated in a sediment pond and discharged to Kōwhai Stream. Monthly surface water monitoring and quarterly groundwater monitoring.',
    guidelineSetIds: ['anzg-fw-95'],
    hardnessAdjust: true,
    yearStartMonth: 7,
  });

  const sites: Site[] = [
    newSite(project.id, { code: 'US1', name: 'Kōwhai Stream – upstream', type: 'Surface water', role: 'Upstream / control', aliases: ['Upstream', 'U/S'], order: 1, easting: 1812345, northing: 5823456 }),
    newSite(project.id, { code: 'DP1', name: 'Sediment pond outlet', type: 'Discharge', role: 'Discharge point', aliases: ['Pond outlet', 'Discharge'], order: 2, easting: 1812510, northing: 5823390 }),
    newSite(project.id, { code: 'DS1', name: 'Kōwhai Stream – downstream', type: 'Surface water', role: 'Downstream / impact', aliases: ['Downstream', 'D/S'], order: 3, easting: 1812690, northing: 5823301 }),
    newSite(project.id, { code: 'GW1', name: 'Monitoring bore BH1', type: 'Groundwater', role: 'Compliance point', aliases: ['BH1', 'Bore 1'], order: 4, easting: 1812600, northing: 5823500 }),
  ];
  const [US1, DP1, DS1, GW1] = sites;

  const samples: Sample[] = [];
  const results: Result[] = [];
  const imp: ImportBatch = { id: uid('imp'), projectId: project.id, fileName: 'Demo data (synthetic)', kind: 'lab', importedAt: new Date().toISOString(), samples: 0, results: 0, skipped: 0, replaced: 0 };

  const add = (sample: Sample, pid: string, value: number, unit: string, dl?: number, decimals = 4) => {
    const rounded = Number(value.toFixed(decimals));
    const nd = dl !== undefined && rounded < dl;
    results.push({
      id: uid('r'),
      projectId: project.id,
      sampleId: sample.id,
      siteId: sample.siteId,
      date: sample.date,
      parameterId: pid,
      value: nd ? dl! : rounded,
      qualifier: nd ? '<' : '',
      unit,
      text: nd ? `< ${dl}` : String(rounded),
      dl,
      importId: imp.id,
    });
  };

  // Monthly rounds from July 2023 to last month
  const today = todayStr();
  const lastMonth = addMonths(`${today.slice(0, 7)}-01`, -1);
  let job = 3300100;
  for (let m = '2023-07-01'; m <= lastMonth; m = addMonths(m, 1)) {
    const y = +m.slice(0, 4), mo = +m.slice(5, 7);
    const day = 8 + Math.floor(rand() * 12);
    const winter = Math.cos(((mo - 7) / 12) * 2 * Math.PI); // +1 in July, -1 in January
    const storm = rand() < 0.22 ? 1 + rand() * 2.5 : 0; // rain event on sampling day
    const lab = String(job++);
    let n = 1;
    const mk = (site: Site, hh: number, mm: number): Sample => {
      const s: Sample = {
        id: uid('s'), projectId: project.id, siteId: site.id, date: makeDate(y, mo, day, hh, mm), sampleName: `${site.code} ${day}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1]}-${y}`,
        labName: 'Demo Lab', labJob: lab, labNumber: `${lab}.${n++}`, importId: imp.id,
      };
      samples.push(s);
      return s;
    };
    const us = mk(US1, 9, 10), dp = mk(DP1, 9, 45), ds = mk(DS1, 10, 20);

    // Upstream: clean stream
    const usTurb = lognorm(2.2 + 1.2 * winter + storm * 6, 0.35);
    const usHard = lognorm(34, 0.12);
    add(us, 'ph', 7.2 + gauss() * 0.15, 'pH', undefined, 1);
    add(us, 'turbidity', usTurb, 'NTU', undefined, 1);
    add(us, 'tss', lognorm(3 + storm * 8, 0.4), 'g/m³', 3, 0);
    add(us, 'ec', lognorm(11 - 2 * winter, 0.1), 'mS/m', undefined, 1);
    add(us, 'hardness', usHard, 'g/m³', undefined, 0);
    add(us, 'cu-d', lognorm(0.0006, 0.4), 'g/m³', 0.0005);
    add(us, 'zn-d', lognorm(0.0018, 0.45), 'g/m³', 0.001);
    add(us, 'pb-d', lognorm(0.00008, 0.5), 'g/m³', 0.0001, 5);
    add(us, 'nh4-n', lognorm(0.012, 0.5), 'g/m³', 0.01, 3);
    add(us, 'no3-n', lognorm(0.6 + 0.3 * winter, 0.3), 'g/m³', 0.002, 3);
    add(us, 'drp', lognorm(0.007, 0.4), 'g/m³', 0.004, 3);
    add(us, 'ecoli', lognorm(180 + storm * 600, 0.7), 'cfu/100mL', 1, 0);

    // Discharge: sediment pond outlet
    const dpTss = lognorm(22 + storm * 45 + 8 * winter, 0.45);
    const dpTurb = dpTss * lognorm(1.1, 0.15);
    const dpHard = lognorm(85, 0.15);
    add(dp, 'ph', 7.6 + gauss() * 0.35 + (rand() < 0.04 ? 1.8 : 0), 'pH', undefined, 1);
    add(dp, 'tss', dpTss, 'g/m³', 3, 0);
    add(dp, 'turbidity', dpTurb, 'NTU', undefined, 1);
    add(dp, 'ec', lognorm(32, 0.15), 'mS/m', undefined, 1);
    add(dp, 'hardness', dpHard, 'g/m³', undefined, 0);
    add(dp, 'cu-d', lognorm(0.0019, 0.35), 'g/m³', 0.0005);
    add(dp, 'zn-d', lognorm(0.009 + storm * 0.006, 0.4), 'g/m³', 0.001);
    add(dp, 'pb-d', lognorm(0.0004, 0.5), 'g/m³', 0.0001, 5);
    add(dp, 'ni-d', lognorm(0.0012, 0.4), 'g/m³', 0.0005);
    add(dp, 'nh4-n', lognorm(0.06, 0.6), 'g/m³', 0.01, 3);
    add(dp, 'no3-n', lognorm(2.1 + 0.6 * winter, 0.3), 'g/m³', 0.002, 3);
    if (mo % 3 === 1) add(dp, 'tph-total', lognorm(0.4, 0.7), 'g/m³', 0.7, 1);

    // Downstream: mix of upstream and discharge
    const mix = 0.18 + storm * 0.06;
    add(ds, 'ph', 7.3 + gauss() * 0.15, 'pH', undefined, 1);
    add(ds, 'turbidity', usTurb * (1 - mix) + dpTurb * mix * lognorm(0.9, 0.2), 'NTU', undefined, 1);
    add(ds, 'tss', lognorm(4 + storm * 12 + dpTss * mix * 0.6, 0.35), 'g/m³', 3, 0);
    add(ds, 'ec', lognorm(14 - 2 * winter, 0.1), 'mS/m', undefined, 1);
    add(ds, 'hardness', usHard * (1 - mix) + dpHard * mix, 'g/m³', undefined, 0);
    add(ds, 'cu-d', lognorm(0.0009, 0.35), 'g/m³', 0.0005);
    add(ds, 'zn-d', lognorm(0.0042 + storm * 0.004, 0.45), 'g/m³', 0.001);
    add(ds, 'pb-d', lognorm(0.00015, 0.5), 'g/m³', 0.0001, 5);
    add(ds, 'nh4-n', lognorm(0.018, 0.5), 'g/m³', 0.01, 3);
    add(ds, 'no3-n', lognorm(1.05 + 0.6 * winter + (y >= 2025 ? 0.35 : 0), 0.3), 'g/m³', 0.002, 3);
    add(ds, 'drp', lognorm(0.009, 0.4), 'g/m³', 0.004, 3);
    add(ds, 'ecoli', lognorm(220 + storm * 700, 0.7), 'cfu/100mL', 1, 0);

    // Groundwater: quarterly (Jul, Oct, Jan, Apr)
    if (mo % 3 === 1) {
      const gw = mk(GW1, 11, 30);
      add(gw, 'ph-field', 6.6 + gauss() * 0.12, 'pH', undefined, 1);
      add(gw, 'ec', lognorm(28, 0.08), 'mS/m', undefined, 1);
      add(gw, 'swl', 4.2 - 0.8 * winter + gauss() * 0.2, 'm', undefined, 2);
      add(gw, 'nh4-n', lognorm(0.45 + (y >= 2025 ? 0.4 : 0), 0.45), 'g/m³', 0.01, 3);
      add(gw, 'no3-n', lognorm(3.2, 0.25), 'g/m³', 0.002, 3);
      add(gw, 'fe-d', lognorm(0.8, 0.5), 'g/m³', 0.02, 3);
      add(gw, 'mn-d', lognorm(0.35, 0.4), 'g/m³', 0.0005);
      add(gw, 'as-d', lognorm(0.0015, 0.4), 'g/m³', 0.001);
      add(gw, 'b-d', lognorm(0.05, 0.3), 'g/m³', 0.005, 3);
    }
  }
  imp.samples = samples.length;
  imp.results = results.length;

  const rules: Rule[] = [
    newRule(project.id, { name: 'Discharge TSS limit', condition: 'Condition 8(a)', level: 'Limit', kind: 'threshold', parameterId: 'tss', siteIds: [DP1.id], operator: '>', value: 100, unit: 'mg/L', order: 1, action: 'Notify the Council within 24 hours, investigate the cause and re-sample within 7 days.' }),
    newRule(project.id, { name: 'Discharge pH range', condition: 'Condition 8(b)', level: 'Limit', kind: 'threshold', parameterId: 'ph', siteIds: [DP1.id], operator: 'outside', min: 6, max: 9, unit: 'pH', order: 2, action: 'Notify the Council within 24 hours and adjust pond treatment.' }),
    newRule(project.id, { name: 'TSS trigger – two consecutive results', condition: 'Condition 9', level: 'Trigger 1', kind: 'consecutive', parameterId: 'tss', siteIds: [DP1.id], operator: '>', value: 50, unit: 'mg/L', consecutive: 2, order: 3, action: 'Inspect the sediment pond and flocculation system.' }),
    newRule(project.id, { name: 'Turbidity increase downstream', condition: 'Condition 10', level: 'Limit', kind: 'change', parameterId: 'turbidity', siteIds: [DS1.id], referenceSiteId: US1.id, changeType: 'percent', operator: '>', value: 50, pairingDays: 0, order: 4, action: 'Notify the Council and review discharge rate.' }),
    newRule(project.id, { name: 'Downstream dissolved metals vs ANZG 95%', condition: 'Condition 11', level: 'Trigger', kind: 'guideline', guidelineSetId: 'anzg-fw-95', hardnessAdjust: true, siteIds: [DS1.id], operator: '>', order: 5, action: 'Re-sample and assess whether the exceedance is attributable to the discharge.' }),
    newRule(project.id, { name: 'Downstream nitrate – annual median', condition: 'NPS-FM national bottom line', level: 'Trigger', kind: 'statistic', parameterId: 'no3-n', siteIds: [DS1.id], statistic: 'median', window: 'year', operator: '>', value: 2.4, unit: 'mg/L', minSamples: 4, order: 6 }),
    newRule(project.id, { name: 'Groundwater ammoniacal-N trigger', condition: 'Condition 14', level: 'Trigger', kind: 'threshold', parameterId: 'nh4-n', siteIds: [GW1.id], operator: '>', value: 1, unit: 'mg/L', order: 7, action: 'Increase groundwater monitoring to monthly and report to the Council.' }),
  ];

  const schedules: MonitoringSchedule[] = [
    newSchedule(project.id, { name: 'Monthly surface water & discharge', siteIds: [US1.id, DP1.id, DS1.id], every: 1, unit: 'month', startDate: '2023-07-01' }),
    newSchedule(project.id, { name: 'Quarterly groundwater', siteIds: [GW1.id], every: 3, unit: 'month', startDate: '2023-07-01' }),
  ];

  const obligations: ReportObligation[] = [
    newObligation(project.id, {
      name: 'Annual monitoring report', recipient: 'Demo Regional Council', every: 1, unit: 'year',
      firstPeriodStart: '2023-07-01', firstPeriodEnd: '2024-06-30', firstDueDate: '2024-10-31', templateId: 'tpl-annual',
      submissions: [
        { periodStart: '2023-07-01', periodEnd: '2024-06-30', submittedOn: '2024-10-25' },
        { periodStart: '2024-07-01', periodEnd: '2025-06-30', submittedOn: '2025-10-29' },
      ],
    }),
    newObligation(project.id, {
      name: 'Quarterly data summary', recipient: 'Demo Regional Council', every: 3, unit: 'month',
      firstPeriodStart: '2023-07-01', firstPeriodEnd: '2023-09-30', firstDueDate: '2023-10-31', templateId: 'tpl-quarterly',
      submissions: [],
    }),
  ];
  // mark all past quarterly summaries except the latest as submitted
  for (let k = 0; k < 40; k++) {
    const ps = addMonths('2023-07-01', k * 3);
    const pe = addMonths('2023-09-30', k * 3);
    const end = makeDate(+pe.slice(0, 4), +pe.slice(5, 7), new Date(Date.UTC(+pe.slice(0, 4), +pe.slice(5, 7), 0)).getUTCDate());
    if (addMonths(end, 1) >= addMonths(today, -1)) break;
    obligations[1].submissions.push({ periodStart: ps, periodEnd: end, submittedOn: addMonths(end, 1) });
  }

  await db.transaction('rw', [db.projects, db.sites, db.samples, db.results, db.rules, db.schedules, db.obligations, db.imports], async () => {
    await db.projects.put(project);
    await db.sites.bulkPut(sites);
    await db.samples.bulkPut(samples);
    await db.results.bulkPut(results);
    await db.rules.bulkPut(rules);
    await db.schedules.bulkPut(schedules);
    await db.obligations.bulkPut(obligations);
    await db.imports.put(imp);
  });
  return project.id;
}
