// Is this file lab results? A quick look – its name and folder, and for spreadsheets and CSVs a peek at what's in
// them – so the inbox lists lab files and leaves out reports, photos and EnviroDB's own downloads. Nothing is fully
// read until it's imported (and big files are left unopened: a file kept online only would be downloaded).

export interface Sniffed {
  /** Lab results, or very likely. */
  lab: boolean;
  /** The lab, when it shows. */
  labName?: string;
  /** Why it was (or wasn't) taken as lab results. */
  why: string;
  /** Field results from a phone: the project the sheet was made for. */
  field?: { projectId?: string };
}

const LAB_EXT = /\.(csv|tsv|txt|xlsx|xlsm|xls|pdf|zip|json)$/i;
const PEEK_MAX = 6 * 1024 * 1024;

/** Lab names and the words of their files – the layouts first (a lab's file can mention another lab it sent work to). */
const MARKERS: Array<[RegExp, string | undefined]> = [
  [/R\s*J\s*Hill Laborator|Hill Laborator|SSFC\d|hill-labs/i, 'Hill Labs'],
  [/Linnaeus|\bTextbox\d+/i, 'Linnaeus'],
  [/ClientSampleReference|ALS Environmental|SampleCode,ChemCode|\bChemCode\b/i, 'ALS'],
  [/Analytica Laborator|Analytica/i, 'Analytica'],
  [/Eurofins/i, 'Eurofins'],
  [/Watercare Laborator/i, 'Watercare'],
  [/\bALS\b/, 'ALS'],
  [/Certificate of Analysis|Laboratory Job Number|Lab(oratory)? (No|Number|Reference)\b|Analysis Report|Client Sample ID|Sample Name:|Date Received/i, undefined],
];
/** Names that are lab files: the lab's job numbers, "COA", "results" … */
const NAME_HINT = /\b(NH\d{6,}|\d{7}(\.\d+)?|\d{10}(-\d{2,6})?|coa|certificate|analys[ie]s|lab(oratory)?|results?|hill|als|linnaeus|analytica|eurofins|esdat|ssfc)\b/i;
/** Folders where lab files are kept. */
const FOLDER_HINT = /(^|\/)[^/]*(lab|results|coa|analys|certificate|data)[^/]*(\/|$)/i;

function markers(text: string): { hit: boolean; labName?: string } {
  for (const [re, name] of MARKERS) if (re.test(text)) return { hit: true, labName: name };
  return { hit: false };
}

/** The first part of a text file, or the strings of a spreadsheet (and whether EnviroDB made it). */
async function peek(file: File): Promise<{ text: string; ours: boolean } | null> {
  if (file.size > PEEK_MAX) return null;
  const name = file.name.toLowerCase();
  if (/\.(csv|tsv|txt)$/.test(name)) return { text: await file.slice(0, 16 * 1024).text(), ours: false };
  if (/\.(xlsx|xlsm|zip)$/.test(name)) {
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      if (name.endsWith('.zip')) return { text: Object.keys(zip.files).join('\n'), ours: false };
      const core = (await zip.file('docProps/core.xml')?.async('string')) ?? '';
      const strings = ((await zip.file('xl/sharedStrings.xml')?.async('string')) ?? '').slice(0, 60000);
      return { text: strings.replace(/<[^>]+>/g, ' '), ours: /<dc:creator>EnviroDB/i.test(core) };
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether a file found in a folder is lab results. `path`: where it is (for the folder's name). */
export async function sniffLabFile(file: File, path = file.name): Promise<Sniffed> {
  const name = file.name;
  if (!LAB_EXT.test(name)) return { lab: false, why: 'not a spreadsheet, CSV, PDF or zip' };
  if (/^~\$|^\./.test(name)) return { lab: false, why: 'a temporary file' };
  if (/\.json$/i.test(name)) {
    // a phone's field results (EnviroDB's own sheets and backups are left alone)
    const head = file.size <= 40 * 1024 * 1024 ? await file.slice(0, 16 * 1024).text() : '';
    if (/"app"\s*:\s*"EnviroDB"/.test(head) && /"kind"\s*:\s*"field-results"/.test(head)) {
      const projectId = head.match(/"project"\s*:\s*\{\s*"id"\s*:\s*"([^"]{1,80})"/)?.[1];
      return { lab: true, labName: 'Field results', why: 'field results from a phone', field: { projectId } };
    }
    return { lab: false, why: 'not field results' };
  }
  const looked = await peek(file);
  if (looked?.ours) return { lab: false, why: 'made by EnviroDB' };
  if (looked) {
    const m = markers(looked.text);
    if (m.hit) return { lab: true, labName: m.labName, why: m.labName ? `a ${m.labName} file` : 'has a lab’s headings' };
    // a zip of lab files
    if (/\.zip$/i.test(name) && looked.text.split('\n').some((n) => LAB_EXT.test(n) && NAME_HINT.test(n))) return { lab: true, why: 'a zip of lab files' };
  }
  const nameHit = NAME_HINT.test(name.replace(/[_]+/g, ' '));
  const folderHit = FOLDER_HINT.test(path.split('/').slice(0, -1).join('/'));
  if (/\.pdf$/i.test(name)) return nameHit ? { lab: true, why: 'its name' } : { lab: false, why: folderHit ? 'a PDF without a lab’s name' : 'a PDF' };
  if (looked) return { lab: false, why: 'no lab headings in it' };
  return nameHit && folderHit ? { lab: true, why: 'its name and folder' } : { lab: false, why: 'nothing says lab results' };
}
