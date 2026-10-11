import type { ReportBlock, ReportTemplate } from '../db/types';
import { buildReport, type BuildOptions } from './build';
import { cmToPx, renderChartPng } from '../charts/render';
import { downloadBlob } from '../db/backup';

export type ExportKind = 'pdf' | 'docx';

/** Build a report at full resolution and download it as PDF or Word. */
export async function exportReport(kind: ExportKind, opts: Omit<BuildOptions, 'renderChart'>): Promise<void> {
  const doc = buildReport({ ...opts, renderChart: (o, w, h) => renderChartPng(o, cmToPx(w), cmToPx(h), 3) });
  if (kind === 'pdf') {
    const { downloadPdf } = await import('./pdf');
    await downloadPdf(doc);
  } else {
    const { docxBlob } = await import('./docx');
    downloadBlob(await docxBlob(doc), `${doc.fileName}.docx`);
  }
}

/** A one-off template (not saved) for quick exports such as "this table to Word". */
export function adhocTemplate(name: string, blocks: ReportBlock[], orientation: 'portrait' | 'landscape' = 'landscape'): ReportTemplate {
  return {
    id: 'adhoc',
    name,
    orientation,
    pageSize: 'A4',
    marginMm: 15,
    fontSize: 9.5,
    accent: '#0f766e',
    headerText: '{{project.name}}',
    footerText: '{{company}} · {{project.code}}',
    numbering: true,
    blocks,
    updatedAt: new Date().toISOString(),
  };
}
