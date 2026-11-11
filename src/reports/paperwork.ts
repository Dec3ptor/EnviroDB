// A sampling round's paperwork as PDFs: the sample list (what's taken where, and what the lab analyses each sample
// for – with sign-off boxes, it's the chain of custody), a sheet to write the field readings on, the lab's own forms
// kept with the project (its chain of custody, filled in for the project) printed after them – and the bottle
// labels, as their own PDF for the label sheets.

import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { loadPdfMake } from './pdf';
import { MADE_BY } from '../lib/version';
import { formatDate, type DateFormat } from '../lib/dates';
import { BORE_ONLY, bottleLabels, type LabelSheet, type RoundPlan } from '../lib/paperwork';
import { fitPage, type PageImage } from '../lib/pdfPages';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 34;
const FOOT = 34;
const GREY = '#5c5b57';
const LINE = '#8a8983';
const MM = 2.834645669;

export interface PaperworkInput {
  project: { name: string; code?: string; client?: string; consents?: string; purchaseOrder?: string };
  /** The round, in words: "October 2026", "the Monthly round of October 2026". */
  round: string;
  /** The day it's sampled ('YYYY-MM-DD') – none: the dates are written in. */
  date?: string;
  plan: RoundPlan;
  paramName: (id: string) => string;
  paramUnit?: (id: string) => string;
  sampler?: string;
  company?: string;
  lab?: string;
  quote?: string;
  /** The lab's job or chain of custody number, when it's known. */
  cocNumber?: string;
  notes?: string;
  /** What's in it. */
  list: boolean;
  /** Sign-off boxes under the sample list: relinquished by, received by. */
  custody: boolean;
  fieldSheet: boolean;
  /** The lab's own forms, each page a picture – printed last. */
  forms: Array<{ name: string; pages: PageImage[] }>;
  /** 'YYYY-MM-DD' */
  printed: string;
  dateFormat?: DateFormat;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const projectLine = (p: PaperworkInput['project']) => [p.code, p.name].filter(Boolean).join(' – ');
/** A line to write on, `w` characters long. */
const blank = (w: number) => ({ text: '_'.repeat(w), color: LINE });

const thinLines = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => LINE,
  vLineColor: () => LINE,
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 3,
  paddingBottom: () => 3,
};

const head = (text: string): TableCell => ({ text, bold: true, fontSize: 8.5, fillColor: '#eeede8' });

/** The details at the top: two columns of "Label  value" (a blank to write on where there's no value). */
function details(input: PaperworkInput): Content {
  const d = (date?: string) => (date ? formatDate(date, { format: input.dateFormat }) : '');
  const rows: Array<[string, string | undefined]> = [
    ['Project', projectLine(input.project)],
    ['Round', input.round],
    ['Client', input.project.client],
    ['Sampled on', d(input.date) || undefined],
    ['Consent', input.project.consents],
    ['Sampled by', [input.sampler, input.company].filter(Boolean).join(', ') || undefined],
    ['Purchase order', input.project.purchaseOrder],
    ['Laboratory', input.lab],
    ['Lab quote', input.quote],
    ['Lab job / CoC no.', input.cocNumber],
  ];
  // what must be on a submission is kept even when blank; the rest only when it's known
  const keep = new Set(['Project', 'Round', 'Sampled on', 'Sampled by', 'Laboratory', 'Lab job / CoC no.']);
  const shown = rows.filter(([k, v]) => v || keep.has(k));
  const cell = ([k, v]: [string, string | undefined]): Content => ({
    columns: [
      { text: k, width: 92, color: GREY, fontSize: 8.5 },
      v ? { text: v, width: '*', fontSize: 9.5 } : { ...blank(30), width: '*', fontSize: 9.5 },
    ],
    margin: [0, 1.5, 0, 1.5],
  });
  // read across: left, then right
  const left: Content[] = [];
  const right: Content[] = [];
  shown.forEach((r, i) => (i % 2 === 0 ? left : right).push(cell(r)));
  return { columns: [{ width: '*', stack: left }, { width: 16, text: '' }, { width: '*', stack: right }] };
}

/** The sample list: each sample with its date and time (to write in), what it's analysed for, and room for notes. */
function sampleList(input: PaperworkInput): Content[] {
  const { plan } = input;
  const day = input.date ? formatDate(input.date, { format: input.dateFormat }) : '';
  const anyLast = plan.samples.some((s) => s.from === 'last');
  const body: TableCell[][] = [[head('#'), head('Sample'), head('Site'), head('Date'), head('Time'), head('Analysis'), head('Bottles / notes')]];
  plan.samples.forEach((s, i) => {
    body.push([
      { text: String(i + 1), color: GREY, fontSize: 8.5 },
      { text: s.name, bold: true, fontSize: 10.5 },
      { text: [s.siteName ?? (s.extra ? 'Extra sample' : ''), s.type ? { text: `${s.siteName ? '\n' : ''}${s.type}`, color: GREY, fontSize: 7.5 } : ''], fontSize: 8.5 },
      { text: day, fontSize: 8.5 },
      { text: '' },
      { text: s.suite ? `${s.suite}${s.from === 'last' ? ' †' : ''}` : '', bold: true, fontSize: 10.5, alignment: 'center' },
      { text: '' },
    ]);
  });
  const out: Content[] = [
    { text: input.custody ? 'Chain of custody and analysis request' : 'Sample list and analysis request', fontSize: 16, bold: true },
    { text: `${plan.samples.length} sample${plan.samples.length === 1 ? '' : 's'}`, fontSize: 9, color: GREY, margin: [0, 1, 0, 8] },
    details(input),
    {
      margin: [0, 10, 0, 0],
      table: { headerRows: 1, dontBreakRows: true, widths: [14, 62, '*', 56, 40, 48, 110], heights: (row: number) => (row === 0 ? 14 : 24), body },
      layout: thinLines,
    } as Content,
  ];
  if (plan.suites.length) {
    out.push({ text: 'Analysis', fontSize: 11, bold: true, margin: [0, 12, 0, 3] });
    out.push({
      table: {
        widths: [18, '*', 130],
        dontBreakRows: true,
        body: plan.suites.map((u) => [
          { text: u.letter, bold: true, fontSize: 10.5, alignment: 'center' },
          { text: u.analytes.map(input.paramName).join(', '), fontSize: 8.5 },
          { text: u.samples.join(', '), fontSize: 8, color: GREY },
        ]),
      },
      layout: thinLines,
    } as Content);
  }
  const without = plan.samples.filter((s) => !s.suite).map((s) => s.name);
  const footnotes = [
    anyLast ? '† As the lab reported for the site last time – its sampling schedule names no analytes.' : '',
    without.length && plan.suites.length ? `Write in what ${without.join(', ')} ${without.length === 1 ? 'is' : 'are'} analysed for.` : '',
    !plan.suites.length && plan.samples.length ? 'The sampling schedules name no analytes: write in what each sample is analysed for, or give the lab’s quote.' : '',
  ].filter(Boolean);
  if (footnotes.length) out.push({ text: footnotes.join('\n'), fontSize: 8, color: GREY, margin: [0, 4, 0, 0] });
  if (input.notes?.trim()) out.push({ text: [{ text: 'Notes  ', color: GREY, fontSize: 8.5 }, input.notes.trim()], fontSize: 9.5, margin: [0, 10, 0, 0] });
  if (input.custody) {
    const box = (label: string): TableCell => ({ stack: [{ text: label, fontSize: 7.5, color: GREY }, { text: ' ', fontSize: 15 }] });
    out.push({
      unbreakable: true,
      margin: [0, 14, 0, 0],
      stack: [
        {
          table: {
            widths: ['*', 96, '*', 96],
            body: [
              [box('Relinquished by (name, signature)'), box('Date and time'), box('Received by (name, signature)'), box('Date and time')],
              [box('Relinquished by (name, signature)'), box('Date and time'), box('Received by the laboratory'), box('Date and time')],
            ],
          },
          layout: thinLines,
        },
        {
          margin: [0, 6, 0, 0],
          fontSize: 8.5,
          columnGap: 14,
          columns: [
            { text: ['Chilly bins ', blank(6)], width: 'auto' },
            { text: 'Samples on ice   Yes / No', width: 'auto' },
            { text: ['Sent by ', blank(20)], width: 'auto' },
            { text: ['Results to ', blank(28)], width: '*' },
          ],
        },
      ],
    } as Content);
  }
  return out;
}

/** A sheet to write the readings on: a row for each sample, a column for each field reading. */
function fieldSheet(input: PaperworkInput, first: boolean): Content[] {
  const { plan } = input;
  const cols = plan.field;
  const day = input.date ? formatDate(input.date, { format: input.dateFormat }) : '';
  const w = cols.length > 9 ? 34 : cols.length > 6 ? 42 : 52;
  const header: TableCell[] = [
    head('Sample'),
    head('Time'),
    ...cols.map((id): TableCell => {
      const unit = input.paramUnit?.(id);
      return { text: [{ text: input.paramName(id).replace(/\s*\(field\)\s*/i, ''), bold: true }, unit ? { text: `\n${unit}`, color: GREY } : ''], fontSize: 7.5, fillColor: '#eeede8', alignment: 'center' };
    }),
    head('Weather, flow, appearance, notes'),
  ];
  const body: TableCell[][] = [header];
  for (const s of plan.samples) {
    body.push([
      { stack: [{ text: s.name, bold: true, fontSize: 10.5 }, s.siteName ? { text: clip(s.siteName, 34), fontSize: 7, color: GREY } : ''] },
      { text: '' },
      // a reading that isn't taken here (a bore's, at a stream) is greyed out
      ...cols.map((id): TableCell => (s.extra || (BORE_ONLY.has(id) && s.type !== 'Groundwater') || (s.siteId && !s.field.includes(id)) ? { text: '', fillColor: '#e3e2dc' } : { text: '' })),
      { text: '' },
    ]);
  }
  return [
    { text: 'Field record', fontSize: 16, bold: true, ...(first ? {} : { pageOrientation: 'landscape' as const, pageBreak: 'before' as const }) },
    {
      margin: [0, 2, 0, 8],
      fontSize: 9,
      columns: [
        { text: [{ text: `${projectLine(input.project)} · ${input.round}`, color: GREY }], width: '*' },
        { text: ['Date ', day || blank(14), '      Sampled by ', input.sampler || blank(18), '      Meter ', blank(18)], width: 'auto' },
      ],
    },
    {
      table: { headerRows: 1, dontBreakRows: true, widths: [78, 36, ...cols.map(() => w), '*'], heights: (row: number) => (row === 0 ? 22 : 30), body },
      layout: thinLines,
    } as Content,
    { text: 'Calibrated  Yes / No      Weather over the last 24 hours:', fontSize: 8.5, color: GREY, margin: [0, 8, 0, 0] },
  ];
}

/** A page of a lab's form, filling the paper (the page turns to suit it). */
function formPage(page: PageImage, first: boolean): Content {
  const landscape = page.width > page.height;
  const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
  const size = fitPage(page, pw, ph);
  return {
    image: page.dataUrl,
    width: size.width,
    height: size.height,
    absolutePosition: { x: (pw - size.width) / 2, y: (ph - size.height) / 2 },
    ...(first ? {} : { pageOrientation: landscape ? ('landscape' as const) : ('portrait' as const), pageBreak: 'before' as const }),
  } as Content;
}

/** How many pages of the lab's forms the paperwork ends with. */
export const formPageCount = (input: Pick<PaperworkInput, 'forms'>): number => input.forms.reduce((n, f) => n + f.pages.length, 0);

/** Whether there's anything to print. */
export const paperworkEmpty = (input: Pick<PaperworkInput, 'list' | 'fieldSheet' | 'forms' | 'plan'>): boolean =>
  !((input.list || input.fieldSheet) && input.plan.samples.length) && !formPageCount(input);

export function paperworkDefinition(input: PaperworkInput): TDocumentDefinitions {
  const content: Content[] = [];
  const any = input.plan.samples.length > 0;
  if (input.list && any) content.push(...sampleList(input));
  if (input.fieldSheet && any) content.push(...fieldSheet(input, !content.length));
  for (const f of input.forms) for (const p of f.pages) content.push(formPage(p, !content.length));
  // the first page's way up is the document's: the sample list is upright, the field record on its side, a form as it is
  const firstForm = input.forms.find((f) => f.pages.length)?.pages[0];
  const sideways = input.list && any ? false : input.fieldSheet && any ? true : !!firstForm && firstForm.width > firstForm.height;
  if (!content.length) content.push({ text: 'Nothing to print: choose a schedule with sites, or a form.', color: GREY });
  const forms = formPageCount(input);
  const label = [projectLine(input.project), input.round, `printed ${formatDate(input.printed, { format: input.dateFormat })}`, MADE_BY].filter(Boolean).join(' · ');
  return {
    pageSize: 'A4',
    pageOrientation: sideways ? 'landscape' : 'portrait',
    pageMargins: [MARGIN, MARGIN, MARGIN, FOOT],
    info: { title: `Sampling paperwork – ${input.project.name} – ${input.round}`, creator: MADE_BY },
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#1d1d1b' },
    content,
    // the lab's own forms are printed as they are: no footer over them
    footer: (page: number, pages: number) =>
      page > pages - forms
        ? { text: '' }
        : {
            margin: [MARGIN, 10, MARGIN, 0],
            columns: [
              { text: label, fontSize: 7.5, color: GREY },
              { text: `Page ${page} of ${pages - forms}`, fontSize: 7.5, color: GREY, alignment: 'right', width: 'auto' },
            ],
          },
  };
}

// ------------------------------------------------------------ bottle labels

export interface LabelsInput {
  project: { name: string; code?: string };
  plan: RoundPlan;
  sheet: LabelSheet;
  /** Labels for each sample (one a bottle). */
  each: number;
  /** Labels already used at the top of the first sheet. */
  skip?: number;
  /** The day, printed on the labels – none: written in. */
  date?: string;
  sampler?: string;
  /** What each suite is, to print on big labels. */
  paramName?: (id: string) => string;
  /** A faint outline of each label (to check the fit on plain paper). */
  outlines?: boolean;
  dateFormat?: DateFormat;
}

/** One label's contents, sized to the label. */
function labelBody(l: { name: string; siteName?: string; suite?: string; count?: string }, input: LabelsInput, w: number, h: number): Content[] {
  const small = h < 26 * MM; // the 65-a-sheet ones
  const big = h > 50 * MM;
  const day = input.date ? formatDate(input.date, { format: input.dateFormat }) : '';
  const nameSize = small ? (l.name.length > 9 ? 9 : 11.5) : l.name.length > 14 ? 12 : l.name.length > 9 ? 15 : big ? 22 : 18;
  const fine = small ? 6 : big ? 9 : 7.5;
  const chars = Math.floor(w / (fine * 0.5));
  const suite = l.suite ? input.plan.suites.find((u) => u.letter === l.suite) : undefined;
  const top: Content = {
    columns: [
      { text: l.name, bold: true, fontSize: nameSize, width: '*', noWrap: true },
      l.suite && !small ? { text: l.suite, bold: true, fontSize: big ? 14 : 11, width: 'auto', color: GREY, margin: [0, 2, 0, 0] } : { text: '', width: 0 },
    ],
  };
  if (small) return [top, { text: day ? `${day}   ____:____` : 'Date ________  ____:____', fontSize: fine, margin: [0, 1, 0, 0] }, { text: clip([input.project.code || input.project.name, l.count].filter(Boolean).join(' · '), chars), fontSize: 5.5, color: GREY }];
  return [
    top,
    l.siteName ? { text: clip(l.siteName, chars), fontSize: fine } : '',
    { text: clip(projectLine(input.project), chars), fontSize: fine - 0.5, color: GREY },
    { text: [day ? `Date ${day}` : 'Date ______________', '    Time ____:____'], fontSize: fine + 0.5, margin: [0, big ? 8 : 4, 0, 0] },
    { text: [input.sampler ? `By ${clip(input.sampler, 22)}` : 'By ____________', '    Preserved ________'], fontSize: fine + 0.5, margin: [0, big ? 6 : 3, 0, 0] },
    big && suite && input.paramName ? { text: clip(suite.analytes.map(input.paramName).join(', '), chars * 4), fontSize: fine - 0.5, color: GREY, margin: [0, 6, 0, 0] } : '',
    l.count ? { text: `Bottle ${l.count}`, fontSize: fine - 0.5, color: GREY, margin: [0, big ? 6 : 2, 0, 0] } : '',
  ].filter((x) => x !== '') as Content[];
}

/** The labels, laid out on their sheets: every label at its place, whatever is on it. */
export function labelsDefinition(input: LabelsInput): TDocumentDefinitions {
  const { sheet } = input;
  const labels = bottleLabels(input.plan.samples, input.each, input.skip);
  const per = sheet.cols * sheet.rows;
  const pad = sheet.height < 26 ? 1.5 * MM : 2.5 * MM;
  const w = sheet.width * MM;
  const h = sheet.height * MM;
  const content: Content[] = [];
  labels.forEach((l, i) => {
    const at = i % per;
    const x = (sheet.left + (at % sheet.cols) * (sheet.width + sheet.gapX)) * MM;
    const y = (sheet.top + Math.floor(at / sheet.cols) * (sheet.height + sheet.gapY)) * MM;
    const breakBefore = at === 0 && i > 0 ? { pageBreak: 'before' as const } : {};
    if (input.outlines) content.push({ absolutePosition: { x, y }, canvas: [{ type: 'rect', x: 0, y: 0, w, h, r: 5, lineWidth: 0.4, lineColor: '#b5b3ab' }], ...breakBefore } as Content);
    if (!l) {
      if (!input.outlines && at === 0 && i > 0) content.push({ text: '', pageBreak: 'before' });
      return;
    }
    content.push({
      absolutePosition: { x: x + pad, y: y + pad },
      table: { widths: [w - 2 * pad], body: [[{ stack: labelBody(l, input, w - 2 * pad, h) }]] },
      layout: 'noBorders',
      ...(input.outlines ? {} : breakBefore),
    } as Content);
  });
  if (!content.length) content.push({ text: 'No labels: choose some sites, and how many labels each sample needs.', color: GREY, margin: [MARGIN, MARGIN, MARGIN, 0] });
  return {
    pageSize: 'A4',
    pageMargins: [0, 0, 0, 0],
    info: { title: `Bottle labels – ${input.project.name}`, creator: MADE_BY },
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#1d1d1b' },
    content,
  };
}

const bytesOf = async (dd: TDocumentDefinitions): Promise<Uint8Array> => {
  const pdfMake = await loadPdfMake();
  return new Promise((resolve) => pdfMake.createPdf(dd).getBuffer(resolve));
};

export const paperworkPdfBytes = (input: PaperworkInput): Promise<Uint8Array> => bytesOf(paperworkDefinition(input));
export const labelsPdfBytes = (input: LabelsInput): Promise<Uint8Array> => bytesOf(labelsDefinition(input));

/** The sample list as text, to paste into an email to the lab or a bottle order. */
export function sampleListText(input: Pick<PaperworkInput, 'project' | 'round' | 'date' | 'plan' | 'paramName' | 'lab' | 'quote' | 'dateFormat'>): string {
  const { plan } = input;
  const L: string[] = [`${projectLine(input.project)} – ${input.round}`];
  if (input.date) L.push(`Sampling ${formatDate(input.date, { format: input.dateFormat })}`);
  if (input.lab || input.quote) L.push([input.lab, input.quote ? `quote ${input.quote}` : ''].filter(Boolean).join(', '));
  L.push('', `${plan.samples.length} sample${plan.samples.length === 1 ? '' : 's'}:`);
  for (const s of plan.samples) L.push(`- ${s.name}${s.siteName ? ` (${s.siteName})` : ''}${s.type ? `, ${s.type.toLowerCase()}` : ''}${s.suite ? ` – analysis ${s.suite}` : ''}`);
  if (plan.suites.length) {
    L.push('', 'Analysis:');
    for (const u of plan.suites) L.push(`${u.letter} (${u.samples.length} sample${u.samples.length === 1 ? '' : 's'}): ${u.analytes.map(input.paramName).join(', ')}`);
  }
  return L.join('\n');
}
