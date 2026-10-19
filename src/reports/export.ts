import type { ReportBlock, ReportTemplate } from '../db/types';
import { buildReport, type BuildOptions } from './build';
import { cmToPx, renderChartPng } from '../charts/render';
import { downloadBlob } from '../db/backup';
import type { ReportDoc } from './model';

export type ExportKind = 'pdf' | 'docx';

/** Build a report at full resolution (graphs drawn sharp for print). */
export function fullReport(opts: Omit<BuildOptions, 'renderChart'>): ReportDoc {
  return buildReport({ ...opts, renderChart: (o, w, h) => renderChartPng(o, cmToPx(w), cmToPx(h), 3) });
}

/** A report's file: PDF or Word. */
export async function reportFile(kind: ExportKind, doc: ReportDoc): Promise<{ name: string; blob: Blob }> {
  if (kind === 'pdf') {
    const { pdfBlob } = await import('./pdf');
    return { name: `${doc.fileName}.pdf`, blob: await pdfBlob(doc) };
  }
  const { docxBlob } = await import('./docx');
  return { name: `${doc.fileName}.docx`, blob: await docxBlob(doc) };
}

/** Build a report at full resolution and download it as PDF or Word. */
export async function exportReport(kind: ExportKind, opts: Omit<BuildOptions, 'renderChart'>): Promise<void> {
  const file = await reportFile(kind, fullReport(opts));
  downloadBlob(file.blob, file.name);
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
    headerText: '[project]',
    footerText: '[company] · [project code]',
    numbering: true,
    blocks,
    updatedAt: new Date().toISOString(),
  };
}
