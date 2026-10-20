// Printable field codes: a PDF of QR codes for a project – the project's own (the day's field sheet with all its
// sites) and one for each site, to keep in the site folder, laminate or fix at the site. Scanned with a phone, a code
// does what scanning the computer's screen does, without the computer: the codes hold no day, so they serve every
// round.

import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import qrcode from 'qrcode-generator';
import type { FieldCode, FieldCodeFill, FieldMeasure, FieldSite } from '../field/model';
import { showKeyId } from '../field/lock';
import { loadPdfMake } from './pdf';
import { downloadBlob } from '../db/backup';
import { MADE_BY } from '../lib/version';
import { formatDate, type DateFormat } from '../lib/dates';

export type CodeLayout = 'page' | 'cards' | 'labels';

export const CODE_LAYOUTS: Array<{ value: CodeLayout; label: string; perPage: number; hint: string }> = [
  { value: 'cards', label: 'Cards – 4 a page', perPage: 4, hint: 'A6 cards to cut out and laminate' },
  { value: 'labels', label: 'Labels – 8 a page', perPage: 8, hint: 'Small, to stick on a post or the site folder' },
  { value: 'page', label: 'A page each', perPage: 1, hint: 'Big codes, with the site’s directions in full' },
];

/** What each code shows beside it. */
export interface CodeShow {
  name: boolean;
  project: boolean;
  location: boolean;
  notes: boolean;
  readings: boolean;
}

export interface CodesPdfInput {
  project: { name: string; code?: string };
  /** The project's code (the cover page), when it's printed. */
  projectCode?: { code: FieldCode; link: string };
  /** Each site's code. */
  siteCodes: Array<{ code: FieldCode; link: string }>;
  layout: CodeLayout;
  show: CodeShow;
  fill: FieldCodeFill;
  /** 'YYYY-MM-DD' */
  printed: string;
  dateFormat?: DateFormat;
  /** The team key the codes are locked with (its fingerprint), if they are. */
  lockedWith?: string;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 28;
const FOOT = 34;
const GREY = '#5c5b57';
const MM = 2.834645669;

/** A QR code's squares: error correction M (a scuffed print still reads), L when the text is too long for M. */
export function qrMatrix(text: string): { n: number; dark: Array<[number, number]>; level: 'M' | 'L' } | null {
  for (const level of ['M', 'L'] as const) {
    try {
      const qr = qrcode(0, level);
      // a printed code's letters (capitals and digits) take fewer squares than the address before them
      const m = /^(.*[?&][kx]=)([A-Z2-7]+)$/.exec(text);
      if (m) {
        qr.addData(m[1], 'Byte');
        qr.addData(m[2], 'Alphanumeric');
      } else qr.addData(text, 'Byte');
      qr.make();
      const n = qr.getModuleCount();
      const dark: Array<[number, number]> = [];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark.push([r, c]);
      return { n, dark, level };
    } catch {
      // too long at this level
    }
  }
  return null;
}

/** Whether a link fits in a QR code at all. */
export const fitsQr = (text: string) => qrMatrix(text) !== null;

const QUIET = 4;
/** The QR code as an SVG image for the PDF; at least `minPt` wide, wider when its squares would be too small to read. */
function qrSvg(text: string, minPt: number, maxPt = minPt * 1.6): Content {
  const m = qrMatrix(text);
  if (!m) return { text: '(too much for a QR code)', color: 'red' };
  const side = m.n + 2 * QUIET;
  // each square at least 0.45 mm, so a phone reads it from a hand's length
  const width = Math.min(maxPt, Math.max(minPt, side * 0.45 * MM));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${side}" height="${side}"><rect width="${side}" height="${side}" fill="#fff"/><path fill="#000" d="${m.dark.map(([r, c]) => `M${c + QUIET} ${r + QUIET}h1v1h-1z`).join('')}"/></svg>`;
  return { svg, width, alignment: 'center' } as Content;
}

const short = (m: FieldMeasure) => m.name.replace(/\s*\(field\)\s*/i, '').trim();
const readingsText = (ms: FieldMeasure[]) => ms.map(short).join(', ');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const where = (s: FieldSite) => (s.lat !== undefined && s.lng !== undefined ? `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}` : '');

/** What scanning a site's code does, in a few words. */
function fillText(fill: FieldCodeFill, located: boolean): string {
  const parts = [fill.time ? 'fills in the time' : '', fill.gps ? 'records the phone’s location' : ''].filter(Boolean);
  const check = fill.gps && located ? ' and says if it’s far from the site' : '';
  return parts.length ? `, ${parts.join(' and ')}${check}` : '';
}

function siteCell(c: FieldCode, link: string, input: CodesPdfInput, size: CodeLayout): Content {
  const site = c.sites[0];
  const { show } = input;
  const projectLine = [input.project.code, input.project.name].filter(Boolean).join(' – ');
  const scan = `Scan at the site: opens ${site.code} in the day’s field sheet${fillText(input.fill, where(site) !== '')}.`;
  if (size === 'labels') {
    return {
      columns: [
        { width: 128, stack: [qrSvg(link, 118, 128)] },
        {
          width: '*',
          margin: [6, 4, 0, 0],
          stack: [
            { text: site.code, fontSize: 18, bold: true },
            show.name && site.name ? { text: clip(site.name, 60), fontSize: 9.5 } : null,
            show.project ? { text: clip(projectLine, 70), fontSize: 7.5, color: GREY, margin: [0, 2, 0, 0] } : null,
            show.readings && c.measures.length ? { text: clip(readingsText(c.measures), 90), fontSize: 7.5, margin: [0, 4, 0, 0] } : null,
            show.location && where(site) ? { text: where(site), fontSize: 7, color: GREY, margin: [0, 2, 0, 0] } : null,
            show.notes && site.note ? { text: clip(site.note, 110), fontSize: 7, margin: [0, 3, 0, 0] } : null,
            { text: scan, fontSize: 6.5, color: GREY, margin: [0, 4, 0, 0] },
          ].filter(Boolean) as Content[],
        },
      ],
    };
  }
  const big = size === 'page';
  return {
    stack: [
      qrSvg(link, big ? 300 : 165, big ? 380 : 200),
      { text: site.code, fontSize: big ? 40 : 22, bold: true, alignment: 'center', margin: [0, big ? 10 : 6, 0, 0] },
      show.name && site.name ? { text: big ? site.name : clip(site.name, 70), fontSize: big ? 18 : 11, alignment: 'center' } : null,
      show.project ? { text: projectLine, fontSize: big ? 11 : 8.5, color: GREY, alignment: 'center', margin: [0, 3, 0, 0] } : null,
      show.readings && c.measures.length ? { text: `Readings: ${readingsText(c.measures)}`, fontSize: big ? 11 : 8, alignment: 'center', margin: [0, big ? 12 : 6, 0, 0] } : null,
      show.location && where(site) ? { text: `Location ${where(site)}`, fontSize: big ? 10 : 7.5, color: GREY, alignment: 'center', margin: [0, 2, 0, 0] } : null,
      show.notes && site.note ? { text: big ? site.note : clip(site.note, 260), fontSize: big ? 11 : 7.5, margin: [0, big ? 12 : 5, 0, 0], alignment: big ? 'left' : 'center' } : null,
      { text: scan, fontSize: big ? 9.5 : 7, color: GREY, alignment: 'center', margin: [0, big ? 14 : 6, 0, 0] },
    ].filter(Boolean) as Content[],
  };
}

/** Light dashed lines to cut along. */
const cutLines = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => '#b5b3ab',
  vLineColor: () => '#b5b3ab',
  hLineStyle: () => ({ dash: { length: 4, space: 3 } }),
  vLineStyle: () => ({ dash: { length: 4, space: 3 } }),
  paddingLeft: () => 10,
  paddingRight: () => 10,
  paddingTop: () => 10,
  paddingBottom: () => 8,
};

function sitePages(input: CodesPdfInput): Content[] {
  const per = CODE_LAYOUTS.find((l) => l.value === input.layout)!.perPage;
  const cols = input.layout === 'page' ? 1 : 2;
  const rows = per / cols;
  const width = A4[0] - 2 * MARGIN;
  const height = A4[1] - MARGIN - FOOT - 2;
  const pages: Content[] = [];
  for (let i = 0; i < input.siteCodes.length; i += per) {
    const chunk = input.siteCodes.slice(i, i + per);
    const body: Content[][] = [];
    for (let r = 0; r < rows && r * cols < chunk.length; r++) {
      const row: Content[] = [];
      for (let k = 0; k < cols; k++) {
        const it = chunk[r * cols + k];
        row.push(it ? siteCell(it.code, it.link, input, input.layout) : { text: '' });
      }
      body.push(row);
    }
    pages.push({
      table: {
        widths: Array(cols).fill((width - cols * 20 - (cols + 1) * 0.5) / cols),
        heights: Array(body.length).fill(height / rows - 18.5),
        body,
        dontBreakRows: true,
      },
      layout: input.layout === 'page' ? { ...cutLines, hLineWidth: () => 0, vLineWidth: () => 0 } : cutLines,
      ...(pages.length || input.projectCode ? { pageBreak: 'before' as const } : {}),
    } as Content);
  }
  return pages;
}

function coverPage(input: CodesPdfInput, pc: { code: FieldCode; link: string }): Content[] {
  const c = pc.code;
  const located = c.sites.some((s) => where(s) !== '');
  const held = ['the project’s and sites’ names', located ? 'the sites’ locations' : '', c.sites.some((s) => s.note) ? 'their directions and notes' : '', 'the readings to take'].filter(Boolean);
  return [
    { text: 'Field codes', fontSize: 20, bold: true },
    { text: [input.project.code, input.project.name].filter(Boolean).join(' – '), fontSize: 13, margin: [0, 2, 0, 0] },
    { text: `Printed ${formatDate(input.printed, { format: input.dateFormat })} with ${MADE_BY}`, fontSize: 8.5, color: GREY, margin: [0, 2, 0, 14] },
    {
      columns: [
        { width: 'auto', stack: [qrSvg(pc.link, 190, 300)] },
        {
          width: '*',
          margin: [16, 6, 0, 0],
          stack: [
            { text: 'The project’s code', fontSize: 13, bold: true },
            { text: `Scan it with a phone to open the day’s field sheet with ${c.sites.length === 1 ? 'its site' : `all ${c.sites.length} sites`}.`, fontSize: 10.5, margin: [0, 4, 0, 0] },
            c.measures.length ? { text: `Readings: ${readingsText(c.measures)}`, fontSize: 9.5, margin: [0, 8, 0, 0] } : null,
            { text: 'The codes hold no dates, so they serve every round: print them once and keep them with the site folder.', fontSize: 9.5, color: GREY, margin: [0, 8, 0, 0] },
          ].filter(Boolean) as Content[],
        },
      ],
    },
    { text: 'Using the codes', fontSize: 12, bold: true, margin: [0, 18, 0, 4] },
    {
      ol: [
        'Scan a code with the phone’s camera – or in EnviroDB field, with Scan a printed code.',
        `The project’s code opens the day’s field sheet with all its sites. A site’s code adds the site to the day’s sheet and opens it${fillText(input.fill, located)}.`,
        'What’s recorded stays on the phone, with or without a signal, until it’s sent: Send the results, on the day’s sheet.',
        'With no signal, the phone needs to have opened EnviroDB field once before.',
        ...(input.lockedWith ? ['Locked codes: each phone is set up once for the team – on the computer, in Settings, under Field codes: team key, choose Set up a phone.'] : []),
        'Print the codes again after adding sites or changing the readings to take.',
      ],
      fontSize: 9.5,
      lineHeight: 1.25,
    },
    {
      text: input.lockedWith
        ? `The codes are locked with the team key (${showKeyId(input.lockedWith)}): they open only on phones set up for the team, and anyone else who scans one learns nothing from it. They hold ${held.join(', ')} – no results.`
        : `Anyone who scans a code can read what it holds: ${held.join(', ')}. Codes hold no results.`,
      fontSize: 8.5,
      color: GREY,
      margin: [0, 10, 0, 0],
    },
    { text: 'Sites', fontSize: 12, bold: true, margin: [0, 18, 0, 4] },
    {
      table: {
        headerRows: 1,
        widths: [60, '*', '*'],
        body: [
          [
            { text: 'Site', bold: true },
            { text: 'Name', bold: true },
            { text: 'Readings', bold: true },
          ],
          ...c.sites.map((s) => [s.code, s.name ?? '', readingsText(s.measures ? c.measures.filter((m) => s.measures!.includes(m.id)) : c.measures)]),
        ],
      },
      layout: 'lightHorizontalLines',
      fontSize: 9,
    } as Content,
  ];
}

export function fieldCodesDefinition(input: CodesPdfInput): TDocumentDefinitions {
  const label = [input.project.code || input.project.name, 'field codes', `printed ${formatDate(input.printed, { format: input.dateFormat })}`, MADE_BY].join(' · ');
  return {
    pageSize: 'A4',
    pageMargins: [MARGIN, MARGIN, MARGIN, FOOT],
    info: { title: `Field codes – ${input.project.name}`, creator: MADE_BY },
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#1d1d1b' },
    content: [...(input.projectCode ? coverPage(input, input.projectCode) : []), ...sitePages(input)],
    footer: (page: number, pages: number) => ({
      margin: [MARGIN, 10, MARGIN, 0],
      columns: [
        { text: label, fontSize: 7.5, color: GREY },
        { text: `Page ${page} of ${pages}`, fontSize: 7.5, color: GREY, alignment: 'right', width: 'auto' },
      ],
    }),
  };
}

export async function fieldCodesPdfBytes(input: CodesPdfInput): Promise<Uint8Array> {
  const pdfMake = await loadPdfMake();
  return new Promise((resolve) => pdfMake.createPdf(fieldCodesDefinition(input)).getBuffer(resolve));
}

export async function downloadFieldCodes(input: CodesPdfInput, fileName: string): Promise<void> {
  const bytes = await fieldCodesPdfBytes(input);
  downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), fileName);
}
