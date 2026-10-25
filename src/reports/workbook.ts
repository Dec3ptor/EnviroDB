// The whole project as one Excel workbook, laid out the way monitoring spreadsheets are: a sheet for each site
// with the dates down and the parameters across (units under the names), plus the sites, the limits and triggers,
// and a note of where it came from. For handing the data on, or for anyone who'd rather have it in Excel.

import type { Parameter, Result, Sample, Site } from '../db/types';
import type { ProjectBundle } from '../lib/analysis';
import { displayValue } from '../lib/analysis';
import { describeRule } from '../lib/compliance';
import { compareParams } from '../data/parameters';
import { formatDate, todayStr } from '../lib/dates';
import { unitLabel } from '../lib/units';
import { MADE_BY } from '../lib/version';
import { downloadBlob, safeFileName } from '../db/backup';
import { boreSummary } from '../lib/bore';

export interface WorkbookSheet {
  site: Site;
  params: Parameter[];
  rows: Array<{ sample: Sample; cells: Map<string, Result> }>;
}

/** A sheet name Excel accepts (31 characters, none of []:*?/\), unique in the workbook. */
export function sheetName(code: string, taken: Set<string>): string {
  const base = (code.replace(/[[\]:*?/\\]/g, '-').trim() || 'Site').slice(0, 28);
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} (${i})`;
  taken.add(name.toLowerCase());
  return name;
}

/** What goes on each site's sheet: its samples by date, and the parameters it has results for. */
export function workbookSheets(b: ProjectBundle, siteIds?: string[]): WorkbookSheet[] {
  const sites = (siteIds?.length ? b.sites.filter((s) => siteIds.includes(s.id)) : b.sites).slice().sort((x, y) => x.order - y.order);
  return sites.map((site) => {
    const samples = b.samples.filter((s) => s.siteId === site.id).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    const used = new Set<string>();
    const rows = samples.map((sample) => {
      const cells = new Map<string, Result>();
      for (const r of b.index.bySample.get(sample.id) ?? []) {
        if (r.excluded) continue;
        cells.set(r.parameterId, r);
        used.add(r.parameterId);
      }
      return { sample, cells };
    });
    const params = b.params.filter((p) => used.has(p.id)).sort(compareParams);
    return { site, params, rows: rows.filter((r) => r.cells.size) };
  });
}

/** Download the project as a workbook. */
export async function exportProjectWorkbook(b: ProjectBundle, siteIds?: string[]): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = MADE_BY;
  const head = { font: { bold: true }, fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE6F2F0' } } };
  const dim = { font: { color: { argb: 'FF666666' }, italic: true } };
  const taken = new Set<string>(['sites', 'limits & triggers', 'about']);

  // the sites
  const sitesWs = wb.addWorksheet('Sites');
  sitesWs.addRow(['Code', 'Name', 'Type', 'Role', 'NZTM easting', 'NZTM northing', 'Bore', 'Description']).eachCell((c) => Object.assign(c, head));
  for (const s of b.sites.slice().sort((x, y) => x.order - y.order)) sitesWs.addRow([s.code, s.name ?? '', s.type, s.role, s.easting ?? '', s.northing ?? '', s.bore ? boreSummary(s.bore) : '', s.description ?? '']);
  [10, 32, 14, 20, 14, 14, 36, 50].forEach((w, i) => (sitesWs.getColumn(i + 1).width = w));
  sitesWs.views = [{ state: 'frozen', ySplit: 1 }];

  // a sheet for each site
  for (const sh of workbookSheets(b, siteIds)) {
    const ws = wb.addWorksheet(sheetName(sh.site.code, taken));
    const title = ws.addRow([`${sh.site.code}${sh.site.name ? ` – ${sh.site.name}` : ''}`]);
    title.font = { bold: true, size: 12 };
    ws.addRow(['Date', 'Time', 'Lab number', ...sh.params.map((p) => p.name)]).eachCell((c) => Object.assign(c, head));
    ws.addRow(['', '', '', ...sh.params.map((p) => unitLabel(p.unit))]).eachCell((c, i) => i > 3 && Object.assign(c, dim));
    for (const row of sh.rows) {
      const xr = ws.addRow([formatDate(row.sample.date), row.sample.date.length > 10 ? row.sample.date.slice(11, 16) : '', row.sample.labNumber ?? '']);
      sh.params.forEach((p, i) => {
        const r = row.cells.get(p.id);
        if (!r) return;
        const dv = displayValue(r, p);
        const cell = xr.getCell(4 + i);
        cell.value = r.qualifier || dv.value === null ? dv.text : dv.value;
        if (typeof cell.value === 'number' && cell.value !== 0 && Math.abs(cell.value) < 0.001) {
          const places = dv.text.split('.')[1]?.length ?? 0;
          if (places) cell.numFmt = `0.${'0'.repeat(places)}`;
        }
        cell.alignment = { horizontal: 'right' };
        if (r.comment) cell.note = r.comment;
      });
    }
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }];
    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 7;
    ws.getColumn(3).width = 13;
    sh.params.forEach((_, i) => (ws.getColumn(4 + i).width = 13));
  }

  // the limits and triggers
  const rulesWs = wb.addWorksheet('Limits & triggers');
  rulesWs.addRow(['Name', 'Condition', 'Level', 'Applies to', 'Rule', 'Active']).eachCell((c) => Object.assign(c, head));
  for (const r of b.rules.slice().sort((x, y) => x.order - y.order)) {
    const sites = r.siteIds.length ? r.siteIds.map((id) => b.siteMap.get(id)?.code ?? id).join(', ') : 'All sites';
    rulesWs.addRow([r.name, r.condition ?? '', r.level, sites, describeRule(r, b.paramMap, b.sites, b.setMap), r.active ? 'Yes' : 'No']);
  }
  [34, 14, 10, 24, 70, 8].forEach((w, i) => (rulesWs.getColumn(i + 1).width = w));
  rulesWs.views = [{ state: 'frozen', ySplit: 1 }];

  // where it came from
  const about = wb.addWorksheet('About');
  const p = b.project;
  for (const [k, v] of [
    ['Project', p.name],
    ['Code', p.code ?? ''],
    ['Client', p.client ?? ''],
    ['Consents', p.consents ?? ''],
    ['Made', `${formatDate(todayStr())} with ${MADE_BY}`],
    ['Layout', 'A sheet for each site: dates down, parameters across, units under the names. Results left out in QA/QC are not included; a result’s comment is a cell note.'],
  ])
    about.addRow([k, v]).getCell(1).font = { bold: true };
  about.getColumn(1).width = 12;
  about.getColumn(2).width = 90;

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeFileName(p.code || p.name)} workbook ${todayStr()}.xlsx`);
}
