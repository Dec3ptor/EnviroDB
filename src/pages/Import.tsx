import { InboxPanel } from '../components/InboxPanel';
import { QC_SITE_TYPE, looksLikeQc } from '../lib/qa';
import { projectQa } from '../hooks/useQa';
import { useSettings } from '../hooks/useSettings';
import { markInboxImported, takeInboxImport, useInbox, type InboxCandidate } from '../sync/inbox';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Anchor, Badge, Button, Card, Checkbox, Group, Modal, NumberInput, Paper, ScrollArea, SegmentedControl, Select, SimpleGrid, Stack, Stepper, Table, Text, TextInput, ThemeIcon, Title, Tooltip, Autocomplete, Loader, Center, Progress,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  IconAlertTriangle, IconArrowLeft, IconArrowRight, IconCheck, IconCircleCheck, IconFileSpreadsheet, IconPlus, IconUpload, IconX, IconBolt, IconFileReport, IconTable, IconShieldCheck,
} from '@tabler/icons-react';
import { db } from '../db/db';
import { ProjectDataProvider, useProject } from '../hooks/useProjectData';
import { cellAt, cellText, columnLetter, type SheetGrid } from '../importers/workbook';
import { defaultPlans, readImportFiles, type InputFile } from '../importers/files';
import { detectExport, EMPTY_CONTEXT, EXPORT_LABELS, type ImportContext } from '../importers/labExports';
import { parseWithPlan, type SheetPlan } from '../importers/detect';
import { detectWide, gridFor, wideColumns, type WideConfig } from '../importers/wide';
import { detectLong, type LongConfig } from '../importers/long';
import type { ParsedImport } from '../importers/model';
import { analyteMapKey } from '../importers/model';
import { stableId } from '../lib/ids';
import { buildParamIndex } from '../lib/matching';
import { useAnalyteRows, useSiteTextRows, suggestCode } from '../importers/useImport';
import { commitImport, type CommitSummary, type ImportMapping } from '../importers/commit';
import { createParameter, newSite, saveSite } from '../db/repo';
import { DateField, EmptyState, LevelBadge, PageHeader, paramOptions } from '../components/common';
import { formatDate } from '../lib/dates';
import { COMMON_UNITS, normUnit, sameDimension, unitLabel } from '../lib/units';
import { evaluateAll } from '../lib/analysis';
import { fmtNum } from '../lib/values';
import { guessGroup, PARAMETER_GROUPS } from '../data/parameters';
import { NewProjectButton } from './Projects';
import { checkResults, type FieldResults } from '../field/model';
import { FieldResultsModal } from '../components/FieldSheet';

const ACCEPT = {
  'application/pdf': ['.pdf'],
  'application/zip': ['.zip'],
  'application/x-zip-compressed': ['.zip'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls', '.csv'],
  'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
  'application/vnd.ms-excel.sheet.binary.macroEnabled.12': ['.xlsb'],
  'text/csv': ['.csv'],
  'text/plain': ['.txt', '.tsv'],
  'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
  'application/json': ['.json'],
};

const EXAMPLES = [
  { file: 'example-lab-results-hill-layout.xlsx', label: 'Lab results (Hill Labs layout)' },
  { file: 'example-master-sheet.xlsx', label: 'Master sheet (sheet per site)' },
  { file: 'example-long-format.csv', label: 'Long table (CSV)' },
  { file: 'example-monitoring-export.csv', label: 'Monitoring database export (CSV)' },
];

// ------------------------------------------------------------ grid preview

function GridPreview({ grid, roles }: { grid: SheetGrid; roles: { headerRow?: number; unitRow?: number | null; groupRow?: number | null; siteRow?: number | null; firstDataRow?: number; dateCol?: number; siteCol?: number | null; timeCol?: number | null; skip?: number[] } }) {
  const rows = Math.min(grid.nRows, 30);
  const cols = Math.min(grid.nCols, 18);
  const bg = (r: number, c: number) => {
    if (r === roles.headerRow) return 'var(--mantine-color-blue-1)';
    if (r === roles.unitRow) return 'var(--mantine-color-grape-1)';
    if (r === roles.groupRow) return 'var(--mantine-color-cyan-1)';
    if (r === roles.siteRow) return 'var(--mantine-color-orange-1)';
    if (c === roles.dateCol && r >= (roles.firstDataRow ?? 0)) return 'var(--mantine-color-green-1)';
    if (c === roles.siteCol && r >= (roles.firstDataRow ?? 0)) return 'var(--mantine-color-orange-1)';
    if (c === roles.timeCol && r >= (roles.firstDataRow ?? 0)) return 'var(--mantine-color-lime-1)';
    if (roles.skip?.includes(c)) return 'var(--mantine-color-gray-2)';
    return undefined;
  };
  return (
    <ScrollArea h={300} type="auto">
      <table className="edb-grid" style={{ fontSize: 11.5 }}>
        <thead>
          <tr>
            <th className="sticky-col" />
            {Array.from({ length: cols }, (_, c) => (
              <th key={c} style={{ textAlign: 'center' }}>
                {columnLetter(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              <td className="sticky-col" style={{ color: 'var(--edb-muted)', fontWeight: r === roles.firstDataRow ? 700 : 400 }}>
                {r + 1}
                {r === roles.firstDataRow ? ' ▸' : ''}
              </td>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c} style={{ background: bg(r, c), maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }} title={cellText(cellAt(grid, r, c))}>
                  {cellText(cellAt(grid, r, c))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

function colOptions(grid: SheetGrid, headerRow: number) {
  return Array.from({ length: grid.nCols }, (_, c) => {
    const h = cellText(cellAt(grid, headerRow, c));
    return { value: String(c), label: `${columnLetter(c)}${h ? ` – ${h.slice(0, 30)}` : ''}` };
  });
}

function WideConfigEditor({ grid, config, onChange }: { grid: SheetGrid; config: WideConfig; onChange: (c: WideConfig) => void }) {
  const { sites, params } = useProject();
  const g = gridFor(grid, config.orientation);
  const cols = colOptions(g, config.headerRow);
  const set = <K extends keyof WideConfig>(k: K, v: WideConfig[K]) => onChange({ ...config, [k]: v });
  const columns = useMemo(() => wideColumns(grid, config), [grid, config]);
  const nCols = columns.filter((c) => !c.skip).length;
  const optionalCol = (k: 'labCol' | 'statusCol', label: string) => (
    <Select label={label} data={cols} value={config[k] == null ? null : String(config[k])} onChange={(v) => set(k, v === null ? null : Number(v))} w={180} clearable searchable placeholder="None" />
  );
  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <SegmentedControl
          value={config.orientation}
          onChange={(v) => {
            const o = v as WideConfig['orientation'];
            onChange(detectWide(grid, buildParamIndex(params), o).config);
          }}
          data={[
            { value: 'rows', label: 'Dates down the rows' },
            { value: 'columns', label: 'Dates across the columns' },
          ]}
        />
        <NumberInput label="Header row" min={1} max={g.nRows} value={config.headerRow + 1} onChange={(v) => set('headerRow', Math.max(0, Number(v) - 1))} w={110} />
        <NumberInput label="Units row" min={0} max={g.nRows} value={config.unitRow === null ? 0 : config.unitRow + 1} onChange={(v) => set('unitRow', Number(v) > 0 ? Number(v) - 1 : null)} w={110} description="0 = none" />
        <NumberInput
          label="Category row"
          min={0}
          max={g.nRows}
          value={config.groupRow == null ? 0 : config.groupRow + 1}
          onChange={(v) => set('groupRow', Number(v) > 0 ? Number(v) - 1 : null)}
          w={120}
          description="e.g. Dissolved / Total metals; 0 = none"
        />
        {(config.unitRow !== null || config.siteMode === 'row') && (
          <Select
            label="Units and sites sit"
            data={[
              { value: '0', label: 'Over their column' },
              { value: '1', label: 'One column to the left' },
              { value: '2', label: 'Two columns to the left' },
              { value: '-1', label: 'One column to the right' },
            ]}
            value={String(config.shift ?? 0)}
            onChange={(v) => v !== null && set('shift', Number(v))}
            w={200}
            allowDeselect={false}
          />
        )}
        <NumberInput label="First data row" min={1} max={g.nRows} value={config.firstDataRow + 1} onChange={(v) => set('firstDataRow', Math.max(0, Number(v) - 1))} w={120} />
        <Select label="Date column" data={cols} value={String(config.dateCol)} onChange={(v) => v && set('dateCol', Number(v))} w={200} allowDeselect={false} searchable />
        <Select label="Time column" data={cols} value={config.timeCol === null ? null : String(config.timeCol)} onChange={(v) => set('timeCol', v === null ? null : Number(v))} w={180} clearable placeholder="None" />
      </Group>
      <Group gap="sm" align="flex-end" wrap="wrap">
        <Select
          label="Site comes from"
          data={[
            { value: 'column', label: 'A column' },
            { value: 'row', label: 'A row (e.g. “Sample:”)' },
            { value: 'sheet', label: `The sheet name (“${grid.name}”)` },
            { value: 'fixed', label: 'One site for the whole sheet' },
          ]}
          value={config.siteMode}
          onChange={(v) => v && onChange({ ...config, siteMode: v as WideConfig['siteMode'], siteRow: v === 'row' && config.siteRow == null ? Math.max(0, config.headerRow - 1) : config.siteRow })}
          w={260}
          allowDeselect={false}
        />
        {config.siteMode === 'column' && <Select label="Site column" data={cols} value={config.siteCol === null ? null : String(config.siteCol)} onChange={(v) => set('siteCol', v === null ? null : Number(v))} w={200} searchable />}
        {config.siteMode === 'row' && <NumberInput label="Site row" min={1} max={g.nRows} value={(config.siteRow ?? 0) + 1} onChange={(v) => set('siteRow', Math.max(0, Number(v) - 1))} w={100} />}
        {config.siteMode === 'fixed' && <Autocomplete label="Site" data={sites.map((s) => s.code)} value={config.fixedSite} onChange={(v) => set('fixedSite', v)} w={200} placeholder="Site code" />}
        {optionalCol('labCol', 'Lab number column')}
        {optionalCol('statusCol', 'Status column')}
        <Text size="sm" c="dimmed" pb={6}>
          {nCols} analyte columns
        </Text>
      </Group>
      <Group gap="md">
        {[
          ['var(--mantine-color-blue-1)', 'Header (analyte names)'],
          ['var(--mantine-color-grape-1)', 'Units'],
          ['var(--mantine-color-cyan-1)', 'Categories (Dissolved / Total metals …)'],
          ['var(--mantine-color-green-1)', 'Dates'],
          ['var(--mantine-color-orange-1)', 'Site'],
          ['var(--mantine-color-gray-2)', 'Ignored column'],
        ].map(([c, l]) => (
          <Text key={l} size="xs">
            <span className="hl-swatch" style={{ background: c }} />
            {l}
          </Text>
        ))}
      </Group>
      <GridPreview grid={g} roles={{ headerRow: config.headerRow, unitRow: config.unitRow, groupRow: config.groupRow, siteRow: config.siteMode === 'row' ? config.siteRow : null, firstDataRow: config.firstDataRow, dateCol: config.dateCol, siteCol: config.siteMode === 'column' ? config.siteCol : null, timeCol: config.timeCol, skip: columns.filter((c) => c.skip).map((c) => c.col) }} />
    </Stack>
  );
}

function LongConfigEditor({ grid, config, onChange }: { grid: SheetGrid; config: LongConfig; onChange: (c: LongConfig) => void }) {
  const cols = colOptions(grid, config.headerRow);
  const field = (k: keyof Omit<LongConfig, 'sheet' | 'headerRow'>, label: string, required = false) => (
    <Select key={k} label={label} required={required} data={cols} value={config[k] === null ? null : String(config[k])} onChange={(v) => onChange({ ...config, [k]: v === null ? null : Number(v) })} w={190} clearable={!required} searchable />
  );
  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <NumberInput label="Header row" min={1} value={config.headerRow + 1} onChange={(v) => onChange({ ...config, headerRow: Math.max(0, Number(v) - 1) })} w={110} />
        {field('site', 'Site')}
        {field('sample', 'Sample name')}
        {field('date', 'Date', true)}
        {field('analyte', 'Analyte', true)}
        {field('value', 'Result', true)}
        {field('unit', 'Units')}
        {field('dl', 'Detection limit')}
        {field('qualifier', 'Qualifier (<, >)')}
        {field('labNo', 'Lab number')}
      </Group>
      <GridPreview grid={grid} roles={{ headerRow: config.headerRow, dateCol: config.date ?? undefined, siteCol: config.site, firstDataRow: config.headerRow + 1 }} />
    </Stack>
  );
}

// ------------------------------------------------------------ wizard

interface WizardState {
  fileName: string;
  grids: SheetGrid[];
  plans: SheetPlan[];
  /** What the files say about each other's samples (a PDF naming an ESdat file's samples). */
  context: ImportContext;
  /** Files left out, and why; results taken from one file rather than another. */
  notes: string[];
}

/** The display unit for a parameter added from a lab file: mg/L for the g/m³ NZ labs report (the same thing). */
function newParamUnit(unit?: string): string {
  if (!unit) return 'mg/L';
  return normUnit(unit).key === 'g/m3' ? 'mg/L' : unitLabel(unit);
}

function NewParamModal({ initial, onClose, onCreated }: { initial: { name: string; unit?: string; group?: string }; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(initial.name);
  const [unit, setUnit] = useState(initial.unit ? newParamUnit(initial.unit) : '');
  const [group, setGroup] = useState(guessGroup(initial.name, initial.group));
  return (
    <Modal opened onClose={onClose} title="New parameter">
      <Stack gap="sm">
        <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        <Select label="Group" data={PARAMETER_GROUPS} value={group} onChange={(v) => v && setGroup(v)} allowDeselect={false} />
        <Autocomplete label="Display unit" data={COMMON_UNITS} value={unit} onChange={setUnit} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={async () => {
              const p = await createParameter(name.trim(), unit || 'mg/L', group);
              onCreated(p.id);
              onClose();
            }}
          >
            Create
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function ImportWizard(_props: { projectId: string }) {
  const data = useProject();
  const { project, params } = data;
  // quality control sites too: duplicates and blanks are imported to them
  const sites = useMemo(() => [...data.sites, ...data.qc.sites], [data.sites, data.qc.sites]);
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  /** How far a save has got: results written so far, of how many. */
  const [saving, setSaving] = useState<{ saved: number; total: number } | null>(null);
  const [state, setState] = useState<WizardState | null>(null);
  const [siteMap, setSiteMap] = useState<Record<string, string | null>>({});
  const [paramMapping, setParamMapping] = useState<Record<string, string | null>>({});
  const [unitMap, setUnitMap] = useState<Record<string, string | undefined>>({});
  const [dateOverrides, setDateOverrides] = useState<Record<string, string | undefined>>({});
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [dupes, setDupes] = useState<'replace' | 'skip' | 'keep'>('replace');
  const [clearEarlier, setClearEarlier] = useState(false);
  const [remember, setRemember] = useState(true);
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const [newParamFor, setNewParamFor] = useState<{ key: string; name: string; unit?: string; group?: string } | null>(null);
  const [bulkDate, setBulkDate] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);

  const parsed: ParsedImport | null = useMemo(() => (state ? parseWithPlan(state.grids, state.plans, state.context ?? EMPTY_CONTEXT) : null), [state]);
  const siteRows = useSiteTextRows(parsed, sites);
  const analyteRows = useAnalyteRows(parsed, params);

  // initialise automatic matches whenever a new parse arrives
  useEffect(() => {
    setSiteMap((cur) => {
      const next = { ...cur };
      for (const r of siteRows) if (!(r.siteText in next)) next[r.siteText] = r.matchId;
      return next;
    });
  }, [siteRows]);
  useEffect(() => {
    setParamMapping((cur) => {
      const next = { ...cur };
      for (const r of analyteRows) if (!(r.key in next)) next[r.key] = r.match.parameterId;
      return next;
    });
  }, [analyteRows]);

  // files sent from the lab inbox: read straight away, and remembered as imported once they are
  const fromInbox = useRef<InboxCandidate[]>([]);
  const { queued } = useInbox();
  useEffect(() => {
    const taken = takeInboxImport(project.id);
    if (taken?.files.length) {
      fromInbox.current = taken.from;
      void load(taken.files, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, queued]);

  // a phone's field results: reviewed and added on their own
  const [field, setField] = useState<{ results: FieldResults; name: string; inbox: InboxCandidate[] } | null>(null);
  const load = async (all: Array<File | InputFile>, inbox = false) => {
    if (!inbox) fromInbox.current = [];
    const isJson = (f: File | InputFile) => /\.json$/i.test(f.name);
    for (const f of all.filter(isJson)) {
      try {
        const text = f instanceof File ? await f.text() : new TextDecoder().decode(f.data);
        const raw = JSON.parse(text);
        if (raw?.app === 'EnviroDB' && raw?.kind === 'report-templates') {
          notifications.show({ title: `${f.name} is a report template file`, message: 'Import it on the Report templates page (Library → Report templates → Import).', color: 'blue' });
          continue;
        }
        const results = checkResults(raw);
        setField({ results, name: f.name, inbox: fromInbox.current.filter((c) => c.name === f.name) });
      } catch (e) {
        notifications.show({ title: `${f.name} isn’t field results`, message: (e as Error).message, color: 'red' });
      }
    }
    const files = all.filter((f) => !isJson(f));
    if (!files.length) return;
    setLoading(true);
    try {
      const inputs = await Promise.all(files.map(async (f) => ({ name: f.name, data: f instanceof File ? await f.arrayBuffer() : f.data })));
      const read = await readImportFiles(inputs);
      if (!read.grids.length) throw new Error(read.notes.join(' ') || 'The file has no data.');
      const { plans, notes } = defaultPlans(read.grids, read.context, buildParamIndex(params));
      const fileName = read.names.length === 1 ? read.names[0] : `${read.names[0]} and ${read.names.length - 1} more`;
      setState({ fileName, grids: read.grids, plans, context: read.context, notes: [...read.notes, ...notes] });
      setSiteMap({});
      setParamMapping({});
      setUnitMap({});
      setDateOverrides({});
      setInclude({});
      setSummary(null);
      setStep(1);
    } catch (e) {
      notifications.show({ title: 'Could not read file', message: (e as Error).message, color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  const samples = parsed?.samples ?? [];
  const labs = [...new Set(samples.map((s) => s.labName ?? parsed?.labName).filter((x): x is string => !!x))];
  const jobs = [...new Set(samples.map((s) => s.labJob ?? parsed?.labJob).filter((x): x is string => !!x))];
  const sampleSite = (s: (typeof samples)[number]) => siteMap[s.siteText || s.sampleName] ?? null;
  const sampleDate = (s: (typeof samples)[number]) => dateOverrides[s.key] ?? s.date;
  // those without a date in the file first, so the ones to fix are in the list however long the file is
  const listedSamples = useMemo(() => [...samples.filter((s) => !s.date), ...samples.filter((s) => s.date)].slice(0, 400), [samples]);
  const included = samples.filter((s) => include[s.key] !== false);
  const ready = included.filter((s) => sampleSite(s) && sampleDate(s));
  const readyResults = ready.reduce((n, s) => n + s.results.filter((r) => paramMapping[analyteMapKey(r)]).length, 0);
  const noSite = included.filter((s) => !sampleSite(s)).length;
  const unmatchedSites = siteRows.filter((r) => !siteMap[r.siteText]);
  const missingDates = included.filter((s) => !sampleDate(s));
  const unmatchedAnalytes = analyteRows.filter((r) => !paramMapping[r.key]);
  const readyQuick = !!parsed && samples.length > 0 && !unmatchedSites.length && !missingDates.length && !unmatchedAnalytes.length;

  // duplicate preview against existing data
  const dupCount = useMemo(() => {
    const bySiteDay = new Map<string, string>();
    data.samples.forEach((s) => bySiteDay.set(`${s.siteId}|${s.date.slice(0, 10)}`, s.id));
    let n = 0;
    for (const s of included) {
      const sid = sampleSite(s);
      const d = sampleDate(s);
      if (!sid || !d) continue;
      const existing = bySiteDay.get(`${sid}|${d.slice(0, 10)}`);
      if (!existing) continue;
      const have = new Set((data.index.allBySample.get(existing) ?? []).map((r) => r.parameterId));
      for (const r of s.results) {
        const pid = paramMapping[analyteMapKey(r)];
        if (pid && have.has(pid)) n++;
      }
    }
    return n;
  }, [included, data.samples, data.index, siteMap, dateOverrides, paramMapping]);

  // what "clear out earlier results" would remove: results earlier files put on the samples this file adds to,
  // for analytes this file doesn't have (field readings and results typed in stay)
  const clearCount = useMemo(() => {
    const fieldBatches = new Set(data.imports.filter((b) => b.kind === 'field').map((b) => b.id));
    const bySiteDay = new Map<string, string>();
    data.samples.forEach((s) => bySiteDay.set(`${s.siteId}|${s.date.slice(0, 10)}`, s.id));
    const incoming = new Map<string, Set<string>>();
    for (const s of included) {
      const sid = sampleSite(s);
      const d = sampleDate(s);
      const existing = sid && d ? bySiteDay.get(`${sid}|${d.slice(0, 10)}`) : undefined;
      if (!existing) continue;
      const set = incoming.get(existing) ?? new Set<string>();
      for (const r of s.results) {
        const pid = paramMapping[analyteMapKey(r)];
        if (pid) set.add(pid);
      }
      incoming.set(existing, set);
    }
    let n = 0;
    for (const [sampleId, pids] of incoming) for (const r of data.index.allBySample.get(sampleId) ?? []) if (r.importId && !fieldBatches.has(r.importId) && !pids.has(r.parameterId)) n++;
    return n;
  }, [included, data.samples, data.imports, data.index, siteMap, dateOverrides, paramMapping]); // eslint-disable-line react-hooks/exhaustive-deps

  const createSiteFor = async (text: string) => {
    const code = suggestCode(text);
    const existing = sites.find((s) => s.code.toLowerCase() === code.toLowerCase());
    if (existing) {
      setSiteMap((m) => ({ ...m, [text]: existing.id }));
      return;
    }
    // named after the project and code, so two people importing the same file at once make one site
    const s = newSite(project.id, {
      id: stableId('site', project.id, code.toLowerCase()),
      code,
      name: code !== text ? text : undefined,
      order: sites.length + 1,
      aliases: code !== text ? [text] : [],
      // "DUP1", "Field blank" …: a quality control site, kept out of the monitoring data
      ...(looksLikeQc(text) ? { type: QC_SITE_TYPE } : {}),
    });
    await saveSite(s);
    setSiteMap((m) => ({ ...m, [text]: s.id }));
  };

  const doImport = async () => {
    if (!parsed) return;
    setLoading(true);
    setSaving({ saved: 0, total: readyResults });
    try {
      const mapping: ImportMapping = {
        sites: Object.fromEntries(samples.map((s) => [s.key, sampleSite(s)])),
        dates: dateOverrides,
        include,
        params: paramMapping,
        units: unitMap,
      };
      const res = await commitImport(project.id, parsed, mapping, { duplicates: clearEarlier ? 'replace' : dupes, clearEarlier, rememberAliases: remember, fileName: state!.fileName, labName: parsed.labName, onProgress: (saved, total) => setSaving({ saved, total }) });
      if (fromInbox.current.length) {
        await markInboxImported(fromInbox.current, project.id, res.id);
        fromInbox.current = [];
      }
      setSummary(res);
      setStep(5);
    } catch (e) {
      notifications.show({ title: 'Import failed', message: (e as Error).message, color: 'red' });
    } finally {
      setLoading(false);
      setSaving(null);
    }
  };

  // immediate compliance check for the imported dates
  const importCheck = useMemo(() => {
    if (!summary || !parsed) return null;
    const dates = included.map((s) => sampleDate(s)).filter(Boolean) as string[];
    if (!dates.length) return null;
    const start = dates.reduce((a, b) => (a < b ? a : b)).slice(0, 10);
    const end = dates.reduce((a, b) => (a > b ? a : b)).slice(0, 10);
    const evals = evaluateAll(data, start, end);
    const hits = evals.flatMap((ev) => ev.exceedances.map((ex) => ({ ev, ex })));
    return { start, end, hits, inconclusive: evals.flatMap((ev) => ev.inconclusive.map((ex) => ({ ev, ex }))) };
  }, [summary, data]);
  // QA/QC findings in the samples just imported
  const settings = useSettings();
  const importQa = useMemo(() => {
    if (!summary) return null;
    const mine = new Set([...data.index.allBySample.values()].flat().filter((r) => r.importId === summary.id).map((r) => r.sampleId));
    if (!mine.size) return null;
    return projectQa(data, 'all', settings).findings.filter((f) => !f.record && f.sampleIds.some((id) => mine.has(id)));
  }, [summary, data, settings]);

  return (
    <Stack gap="md">
      <Stepper active={step} onStepClick={(s) => (s < step && step < 5 ? setStep(s) : undefined)} size="sm" allowNextStepsSelect={false}>
        <Stepper.Step label="File" description="Upload" />
        <Stepper.Step label="Layout" description="How the sheet is laid out" />
        <Stepper.Step label="Sites & dates" />
        <Stepper.Step label="Analytes" />
        <Stepper.Step label="Import" />
      </Stepper>

      {step === 0 && (
        <Stack>
          {field && (
            <FieldResultsModal
              results={field.results}
              fileName={field.name}
              onClose={() => setField(null)}
              onAdded={(importId) => {
                if (field.inbox.length) void markInboxImported(field.inbox, project.id, importId);
              }}
            />
          )}
          <Dropzone onDrop={(files) => files.length && load(files)} accept={ACCEPT} loading={loading} multiple maxSize={80 * 1024 * 1024} onReject={() => notifications.show({ message: 'Please choose Excel, CSV or PDF lab reports, or a zip of them', color: 'red' })}>
            <Group justify="center" gap="xl" mih={180} style={{ pointerEvents: 'none' }}>
              <Dropzone.Accept>
                <IconUpload size={48} stroke={1.5} />
              </Dropzone.Accept>
              <Dropzone.Reject>
                <IconX size={48} stroke={1.5} />
              </Dropzone.Reject>
              <Dropzone.Idle>
                <IconFileSpreadsheet size={48} stroke={1.5} color="var(--mantine-primary-color-7)" />
              </Dropzone.Idle>
              <div>
                <Text size="lg" fw={600}>
                  Drop lab results or a monitoring spreadsheet here
                </Text>
                <Text size="sm" c="dimmed" mt={4}>
                  Lab files from Hill Labs, ALS and Linnaeus – Excel, CSV or PDF reports, several at once or the zip they came in – master sheets, long tables, or a phone’s field results
                </Text>
                <Text size="sm" c="dimmed">
                  Importing into <b>{project.name}</b>
                </Text>
              </div>
            </Group>
          </Dropzone>
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              No file handy? Try an example:
            </Text>
            {EXAMPLES.map((ex) => (
              <Button
                key={ex.file}
                size="compact-sm"
                variant="light"
                onClick={async () => {
                  const res = await fetch(`./samples/${ex.file}`);
                  load([{ name: ex.file, data: await res.arrayBuffer() }]);
                }}
              >
                {ex.label}
              </Button>
            ))}
          </Group>
        </Stack>
      )}

      {step === 1 && state && parsed && (
        <Stack>
          <Paper withBorder p="md" radius="md">
            <Group justify="space-between" wrap="wrap">
              <div>
                <Text fw={600}>{state.fileName}</Text>
                <Text size="sm" c="dimmed">
                  {labs.length ? `${labs.join(', ')} · ` : ''}
                  {jobs.length === 1 ? `Job ${jobs[0]} · ` : jobs.length > 1 ? `Jobs ${jobs.join(', ')} · ` : ''}
                  {samples.length} samples · {analyteRows.length} analytes · {samples.reduce((s, x) => s + x.results.length, 0)} results
                </Text>
              </div>
              {readyQuick && (
                <Group gap="xs">
                  <Badge color="green" leftSection={<IconCircleCheck size={12} />} size="lg">
                    Everything matched
                  </Badge>
                  <Button leftSection={<IconBolt size={16} />} onClick={() => setStep(4)}>
                    Review &amp; import
                  </Button>
                </Group>
              )}
            </Group>
          </Paper>
          {state.notes.map((w) => (
            <Alert key={w} color="blue" variant="light" py={6}>
              {w}
            </Alert>
          ))}
          {parsed.warnings.map((w) => (
            <Alert key={w} color="orange" variant="light" icon={<IconAlertTriangle size={16} />} py={6}>
              {w}
            </Alert>
          ))}
          {state.plans.map((plan, i) => {
            const grid = state.grids.find((g) => g.name === plan.sheet)!;
            const setPlan = (p: SheetPlan) => setState({ ...state, plans: state.plans.map((x, j) => (j === i ? p : x)) });
            const count = samples.filter((s) => s.sheet === plan.sheet).length;
            const exportOf = detectExport(grid);
            return (
              <Card key={plan.sheet} padding="md">
                <Group justify="space-between" mb="sm" wrap="wrap">
                  <Group gap="sm">
                    <Text fw={600}>{grid.pdf ? `PDF report “${plan.sheet}”` : `Sheet “${plan.sheet}”`}</Text>
                    <Badge variant="light" color={count ? undefined : 'gray'}>
                      {count} samples
                    </Badge>
                  </Group>
                  <Select
                    data={[
                      ...(exportOf ? [{ value: 'export', label: grid.pdf ? 'Results from the PDF' : EXPORT_LABELS[exportOf.format] }] : []),
                      ...(grid.pdf
                        ? []
                        : [
                            { value: 'lab', label: 'Lab results (samples across, analytes down)' },
                            { value: 'wide', label: 'Monitoring spreadsheet (one row per sample)' },
                            { value: 'long', label: 'Long table (one row per result)' },
                          ]),
                      { value: 'skip', label: grid.pdf ? 'Leave out its results' : 'Skip this sheet' },
                    ]}
                    value={plan.mode}
                    onChange={(v) => {
                      if (!v) return;
                      const index = buildParamIndex(params);
                      if (v === 'export' && exportOf) setPlan({ mode: 'export', sheet: plan.sheet, score: 0, format: exportOf.format });
                      else if (v === 'wide') setPlan({ mode: 'wide', sheet: plan.sheet, score: 0, config: detectWide(grid, index).config });
                      else if (v === 'long') setPlan({ mode: 'long', sheet: plan.sheet, score: 0, config: detectLong(grid).config });
                      else setPlan({ mode: v as 'lab' | 'skip', sheet: plan.sheet, score: 0 });
                    }}
                    w={360}
                    allowDeselect={false}
                  />
                </Group>
                {plan.mode === 'wide' && <WideConfigEditor grid={grid} config={plan.config} onChange={(c) => setPlan({ ...plan, config: c })} />}
                {plan.mode === 'long' && <LongConfigEditor grid={grid} config={plan.config} onChange={(c) => setPlan({ ...plan, config: c })} />}
                {(plan.mode === 'lab' || plan.mode === 'export') && <GridPreview grid={grid} roles={plan.mode === 'export' ? { headerRow: exportOf?.row } : {}} />}
              </Card>
            );
          })}
          <Group justify="space-between">
            <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={() => setStep(0)}>
              Choose other files
            </Button>
            <Button rightSection={<IconArrowRight size={16} />} disabled={!samples.length} onClick={() => setStep(2)}>
              Next: sites &amp; dates
            </Button>
          </Group>
        </Stack>
      )}

      {step === 2 && parsed && (
        <Stack>
          <Card padding="md">
            <Group justify="space-between" mb="xs">
              <div>
                <Title order={5}>Match site names to monitoring sites</Title>
                <Text size="sm" c="dimmed">
                  Matches are remembered for next time.
                </Text>
              </div>
              {unmatchedSites.length > 0 && (
                <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={async () => { for (const r of unmatchedSites) await createSiteFor(r.siteText); }}>
                  Create {unmatchedSites.length} new site{unmatchedSites.length === 1 ? '' : 's'}
                </Button>
              )}
            </Group>
            <Table.ScrollContainer minWidth={560}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name in file</Table.Th>
                    <Table.Th ta="right">Samples</Table.Th>
                    <Table.Th>Site</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {siteRows.map((r) => (
                    <Table.Tr key={r.siteText}>
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {r.siteText}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">{r.count}</Table.Td>
                      <Table.Td>
                        <Group gap="xs" wrap="nowrap">
                          <Select
                            data={sites.map((s) => ({ value: s.id, label: s.name ? `${s.code} – ${s.name}` : s.code }))}
                            value={siteMap[r.siteText] ?? null}
                            onChange={(v) => setSiteMap({ ...siteMap, [r.siteText]: v })}
                            placeholder="Choose site…"
                            searchable
                            w={260}
                            error={!siteMap[r.siteText]}
                          />
                          {!siteMap[r.siteText] ? (
                            <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => createSiteFor(r.siteText)}>
                              New site “{suggestCode(r.siteText)}”
                            </Button>
                          ) : (
                            <IconCheck size={18} color="var(--mantine-color-green-6)" />
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>

          <Card padding="md">
            <Group justify="space-between" mb="xs" wrap="wrap">
              <div>
                <Title order={5}>Samples</Title>
                <Text size="sm" c="dimmed">
                  Check the sampling dates. Untick samples you don't want (e.g. QA duplicates).
                </Text>
              </div>
              {missingDates.length > 0 && (
                <Group gap="xs" align="flex-end">
                  <DateField label={`Date for ${missingDates.length} sample(s) without one`} value={bulkDate} onChange={setBulkDate} w={240} />
                  <Button size="xs" disabled={!bulkDate} onClick={() => setDateOverrides({ ...dateOverrides, ...Object.fromEntries(missingDates.map((s) => [s.key, bulkDate])) })}>
                    Apply
                  </Button>
                </Group>
              )}
            </Group>
            <ScrollArea.Autosize mah={420}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={40} />
                    <Table.Th>Sample</Table.Th>
                    <Table.Th>Lab no.</Table.Th>
                    <Table.Th>Site</Table.Th>
                    <Table.Th>Date sampled</Table.Th>
                    <Table.Th ta="right">Results</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {listedSamples.map((s) => {
                    const d = sampleDate(s);
                    const sid = sampleSite(s);
                    return (
                      <Table.Tr key={s.key} opacity={include[s.key] === false ? 0.45 : 1}>
                        <Table.Td>
                          <Checkbox checked={include[s.key] !== false} onChange={(e) => setInclude({ ...include, [s.key]: e.currentTarget.checked })} aria-label="Include sample" />
                        </Table.Td>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Text size="sm">{s.sampleName}</Text>
                            {s.provisional && (
                              <Tooltip label={`The file shows “${s.status}” – the results may not be final. They are imported with a note.`}>
                                <Badge size="xs" color="orange" variant="light">
                                  provisional
                                </Badge>
                              </Tooltip>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {s.labNumber}
                          </Text>
                        </Table.Td>
                        <Table.Td>{sid ? <Badge variant="light">{sites.find((x) => x.id === sid)?.code}</Badge> : <Badge color="red">No site</Badge>}</Table.Td>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <DateField size="xs" value={d?.slice(0, 10)} onChange={(v) => setDateOverrides({ ...dateOverrides, [s.key]: v ? `${v}${d && d.length > 10 ? d.slice(10) : ''}` : undefined })} w={130} error={!d} placeholder="Pick date" />
                            <TextInput
                              size="xs"
                              w={70}
                              placeholder="hh:mm"
                              value={d && d.length > 10 ? d.slice(11, 16) : ''}
                              onChange={(e) => {
                                const t = e.currentTarget.value;
                                if (!d) return;
                                setDateOverrides({ ...dateOverrides, [s.key]: /^\d{1,2}:\d{2}$/.test(t) ? `${d.slice(0, 10)}T${t.padStart(5, '0')}` : d.slice(0, 10) });
                              }}
                            />
                            {s.dateSource === 'name' && !dateOverrides[s.key] && (
                              <Tooltip label="Read from the sample name">
                                <Badge size="xs" variant="outline">
                                  from name
                                </Badge>
                              </Tooltip>
                            )}
                            {s.dateSource === 'header' && !dateOverrides[s.key] && (
                              <Tooltip label="No sampling date in the file – the date received was used. Please check.">
                                <Badge size="xs" color="orange">
                                  check
                                </Badge>
                              </Tooltip>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td ta="right">{s.results.length}</Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
              {samples.length > 400 && (
                <Text size="xs" c="dimmed" p="xs">
                  Showing 400 of {samples.length} samples{missingDates.length ? ' (those without a date first)' : ''} – all will be imported.
                </Text>
              )}
            </ScrollArea.Autosize>
          </Card>
          <Group justify="space-between">
            <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={() => setStep(1)}>
              Back
            </Button>
            <Group gap="xs">
              {(unmatchedSites.length > 0 || missingDates.length > 0) && (
                <Text size="sm" c="orange.8">
                  {unmatchedSites.length ? `${unmatchedSites.length} unmatched site name(s) will be skipped. ` : ''}
                  {missingDates.length ? `${missingDates.length} sample(s) without a date will be skipped.` : ''}
                </Text>
              )}
              <Button rightSection={<IconArrowRight size={16} />} onClick={() => setStep(3)}>
                Next: analytes
              </Button>
            </Group>
          </Group>
        </Stack>
      )}

      {step === 3 && parsed && (
        <Stack>
          <Card padding="md">
            <Group justify="space-between" mb="xs" wrap="wrap">
              <div>
                <Title order={5}>Match analytes to parameters</Title>
                <Text size="sm" c="dimmed">
                  Units are converted automatically (e.g. g/m³ → µg/L). Choose “skip” to leave an analyte out.
                </Text>
              </div>
              {unmatchedAnalytes.length > 0 && (
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconPlus size={14} />}
                  loading={creating}
                  onClick={async () => {
                    setCreating(true);
                    try {
                      const next = { ...paramMapping };
                      for (const r of unmatchedAnalytes) {
                        const p = await createParameter(r.analyte, newParamUnit(r.unit), guessGroup(r.analyte, r.group));
                        next[r.key] = p.id;
                      }
                      setParamMapping(next);
                    } finally {
                      setCreating(false);
                    }
                  }}
                >
                  Create {unmatchedAnalytes.length} new parameter{unmatchedAnalytes.length === 1 ? '' : 's'}
                </Button>
              )}
            </Group>
            <ScrollArea.Autosize mah={560}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>In file</Table.Th>
                    <Table.Th>Unit in file</Table.Th>
                    <Table.Th>Examples</Table.Th>
                    <Table.Th>Parameter</Table.Th>
                    <Table.Th>Unit</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {analyteRows.map((r) => {
                    const pid = paramMapping[r.key] ?? null;
                    const p = pid ? data.paramMap.get(pid) : undefined;
                    const unit = unitMap[r.key] ?? r.unit ?? p?.unit ?? '';
                    const mismatch = p && unit && !sameDimension(unit, p.unit);
                    return (
                      <Table.Tr key={r.key}>
                        <Table.Td>
                          <Text size="sm" fw={500}>
                            {r.analyte}
                          </Text>
                          {r.group && (
                            <Text size="xs" c="dimmed" lineClamp={1}>
                              {r.group}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{r.unit ?? '—'}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed" className="tabular">
                            {r.examples.join(', ')}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Select
                              data={[{ group: 'Actions', items: [{ value: '__skip', label: '— Skip this analyte —' }, { value: '__new', label: '+ New parameter…' }] }, ...paramOptions(params)]}
                              value={pid ?? '__skip'}
                              onChange={(v) => {
                                if (v === '__new') setNewParamFor({ key: r.key, name: r.analyte, unit: r.unit, group: r.group });
                                else setParamMapping({ ...paramMapping, [r.key]: v === '__skip' ? null : v });
                              }}
                              searchable
                              w={280}
                              allowDeselect={false}
                            />
                            {pid ? (
                              r.match.parameterId === pid && r.match.confidence === 'exact' ? (
                                <Tooltip label="Exact match">
                                  <IconCheck size={18} color="var(--mantine-color-green-6)" />
                                </Tooltip>
                              ) : (
                                <Tooltip label="Matched automatically or by you – please check">
                                  <IconCheck size={18} color="var(--mantine-color-teal-4)" />
                                </Tooltip>
                              )
                            ) : (
                              <Badge color={r.match.candidates.length ? 'orange' : 'gray'} size="sm">
                                {r.match.candidates.length ? 'choose' : 'skipped'}
                              </Badge>
                            )}
                          </Group>
                          {!pid && r.match.candidates.length > 0 && (
                            <Group gap={4} mt={4}>
                              {r.match.candidates.slice(0, 3).map((c) => (
                                <Button key={c} size="compact-xs" variant="light" onClick={() => setParamMapping({ ...paramMapping, [r.key]: c })}>
                                  {data.paramMap.get(c)?.name ?? c}
                                </Button>
                              ))}
                            </Group>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Autocomplete size="xs" data={COMMON_UNITS} value={unit} onChange={(v) => setUnitMap({ ...unitMap, [r.key]: v })} w={120} error={mismatch ? `Can't convert to ${unitLabel(p!.unit)}` : undefined} />
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          </Card>
          <Group justify="space-between">
            <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={() => setStep(2)}>
              Back
            </Button>
            <Button rightSection={<IconArrowRight size={16} />} onClick={() => setStep(4)}>
              Next: review
            </Button>
          </Group>
          {newParamFor && (
            <NewParamModal initial={newParamFor} onClose={() => setNewParamFor(null)} onCreated={(id) => setParamMapping((m) => ({ ...m, [newParamFor.key]: id }))} />
          )}
        </Stack>
      )}

      {step === 4 && parsed && (
        <Stack>
          {readyResults === 0 ? (
            <Alert color="red" variant="light" title="Nothing to import yet">
              {noSite ? `${noSite} sample${noSite === 1 ? ' has' : 's have'} no site. ` : ''}Go back to <Anchor onClick={() => setStep(2)}>Sites &amp; dates</Anchor> to choose a site for each name in the file, or create new sites.
            </Alert>
          ) : noSite > 0 ? (
            <Alert color="orange" variant="light">
              {noSite} sample{noSite === 1 ? ' has' : 's have'} no site and won't be imported. <Anchor onClick={() => setStep(2)}>Choose or create sites</Anchor>
            </Alert>
          ) : null}
          <Card padding="lg">
            <Title order={4} mb="sm">
              Ready to import
            </Title>
            <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
              {[
                ['Samples', ready.length],
                ['Results', readyResults],
                ['Already in database', dupCount],
                ['Skipped analytes', unmatchedAnalytes.length],
              ].map(([l, v]) => (
                <Paper key={l} withBorder p="sm">
                  <Text size="xs" c="dimmed">
                    {l}
                  </Text>
                  <Text fw={650} fz={22}>
                    {v}
                  </Text>
                </Paper>
              ))}
            </SimpleGrid>
            <Stack gap="sm">
              <div>
                <Text size="sm" fw={500} mb={4}>
                  If a result already exists for the same site, day and parameter
                </Text>
                <SegmentedControl
                  value={clearEarlier ? 'replace' : dupes}
                  disabled={clearEarlier}
                  onChange={(v) => setDupes(v as typeof dupes)}
                  data={[
                    { value: 'replace', label: 'Replace it (e.g. amended lab report)' },
                    { value: 'skip', label: 'Keep existing' },
                    { value: 'keep', label: 'Keep both' },
                  ]}
                />
              </div>
              {dupCount + clearCount > 0 && (
                <Checkbox
                  checked={clearEarlier}
                  onChange={(e) => setClearEarlier(e.currentTarget.checked)}
                  label="Clear out earlier results for these samples first"
                  description={`For when an earlier import went wrong – e.g. an analyte matched to the wrong parameter. Results earlier files put on these sites and days are removed and this file’s take their place${clearCount ? ` (${clearCount} result${clearCount === 1 ? '' : 's'} for analytes not in this file would go)` : ''}. Field readings from a phone and results typed in stay.`}
                />
              )}
              <Checkbox label="Remember site and analyte names from this file for next time" checked={remember} onChange={(e) => setRemember(e.currentTarget.checked)} />
            </Stack>
          </Card>
          <Group justify="space-between">
            <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={() => setStep(3)} disabled={loading}>
              Back
            </Button>
            <Button size="md" leftSection={<IconUpload size={18} />} loading={loading} onClick={doImport} disabled={!readyResults}>
              Import into {project.name}
            </Button>
          </Group>
          {loading && saving && (
            <Paper withBorder p="sm" aria-live="polite">
              <Text size="sm" mb={6}>
                {saving.saved < saving.total ? `Saving results… ${saving.saved.toLocaleString('en-NZ')} of ${saving.total.toLocaleString('en-NZ')}` : `Saved ${saving.total.toLocaleString('en-NZ')} results – remembering names and checking them…`}
              </Text>
              <Progress value={saving.total ? (100 * saving.saved) / saving.total : 0} animated />
              {saving.total > 10000 && (
                <Text size="xs" c="dimmed" mt={6}>
                  A big sheet takes a minute or two. Keep this tab open until it’s done – the file goes in whole or not at all.
                </Text>
              )}
            </Paper>
          )}
        </Stack>
      )}

      {step === 5 && summary && (
        <Stack>
          <Card padding="lg">
            <Group gap="sm" mb="md">
              <ThemeIcon color="green" size={40} radius="xl">
                <IconCheck size={24} />
              </ThemeIcon>
              <div>
                <Title order={4}>Imported {summary.results} results from {summary.samples} samples</Title>
                <Text size="sm" c="dimmed">
                  {summary.newSamples} new sample{summary.newSamples === 1 ? '' : 's'} · {summary.replaced} replaced · {summary.skipped} skipped{summary.cleared ? ` · ${summary.cleared} earlier result${summary.cleared === 1 ? '' : 's'} cleared` : ''} · You can undo this from the Data tab.
                </Text>
              </div>
            </Group>
            {importCheck && (
              <>
                <Title order={5} mb={4}>
                  Compliance check {formatDate(importCheck.start)}
                  {importCheck.end !== importCheck.start ? ` – ${formatDate(importCheck.end)}` : ''}
                </Title>
                {importCheck.hits.length ? (
                  <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />} title={`${importCheck.hits.length} exceedance${importCheck.hits.length === 1 ? '' : 's'} found`}>
                    <Stack gap={6}>
                      {importCheck.hits.slice(0, 12).map(({ ev, ex }, i) => (
                        <div key={i}>
                          <Group gap={6}>
                            <LevelBadge level={ev.rule.level} />
                            <Text size="sm" fw={600}>
                              {ev.rule.name}
                            </Text>
                            <Text size="sm">
                              – {data.siteMap.get(ex.siteId)?.code} {formatDate(ex.date)}: {ex.value === null ? '' : `${ex.qualifier}${fmtNum(ex.value)}`} {ex.unit === '%' ? '%' : unitLabel(ex.unit)} ({ex.limitText})
                            </Text>
                          </Group>
                          {ev.rule.action && (
                            <Text size="xs" c="dimmed" ml={4}>
                              Action: {ev.rule.action}
                            </Text>
                          )}
                        </div>
                      ))}
                    </Stack>
                  </Alert>
                ) : (
                  <Alert color="green" variant="light" icon={<IconCircleCheck size={18} />}>
                    {data.rules.length ? 'No consent limits or triggers were exceeded for these dates.' : 'No consent rules are set up for this project yet – add them on the Compliance tab.'}
                  </Alert>
                )}
                {importCheck.inconclusive.length > 0 && (
                  <Text size="sm" c="orange.8" mt="xs">
                    {importCheck.inconclusive.length} result(s) have a detection limit above the limit – ask the lab about lower detection limits.
                  </Text>
                )}
              </>
            )}
            {importQa && (
              <>
                <Title order={5} mt="md" mb={4}>
                  QA/QC checks
                </Title>
                {importQa.length ? (
                  <Alert color="orange" variant="light" icon={<IconAlertTriangle size={18} />} title={`${importQa.length} thing${importQa.length === 1 ? '' : 's'} to look at`}>
                    <Stack gap={2}>
                      {importQa.slice(0, 6).map((f) => (
                        <Text key={f.key} size="sm">
                          {f.title} <Text span size="xs" c="dimmed">({formatDate(f.date)})</Text>
                        </Text>
                      ))}
                      {importQa.length > 6 && (
                        <Text size="xs" c="dimmed">
                          and {importQa.length - 6} more
                        </Text>
                      )}
                      <Anchor size="sm" mt={4} onClick={() => navigate(`/projects/${project.id}/qa`)}>
                        Look at them on the QA/QC tab
                      </Anchor>
                    </Stack>
                  </Alert>
                ) : (
                  <Alert color="green" variant="light" icon={<IconCircleCheck size={18} />}>
                    Nothing unusual: duplicates, blanks, ion balance, parts and wholes, and the sites’ earlier results all check out.
                  </Alert>
                )}
              </>
            )}
          </Card>
          <Group>
            <Button leftSection={<IconTable size={16} />} onClick={() => navigate(`/projects/${project.id}/data`)}>
              View data
            </Button>
            <Button variant="light" leftSection={<IconShieldCheck size={16} />} onClick={() => navigate(`/projects/${project.id}/compliance`)}>
              Compliance
            </Button>
            {importCheck?.hits.length ? (
              <Button variant="light" color="red" leftSection={<IconFileReport size={16} />} onClick={() => navigate(`/projects/${project.id}/reports?template=tpl-notification&start=${importCheck.start}&end=${importCheck.end}`)}>
                Draft exceedance notification
              </Button>
            ) : null}
            <Button variant="default" leftSection={<IconUpload size={16} />} onClick={() => { setState(null); setStep(0); }}>
              Import another file
            </Button>
          </Group>
        </Stack>
      )}
      <Text size="xs" c="dimmed">
        Files are read in your browser – nothing is uploaded anywhere. <Anchor component={Link} to="/guidelines">Guideline values</Anchor> and analyte names can be edited at any time.
      </Text>
    </Stack>
  );
}

export function ImportPage() {
  const projects = useLiveQuery(() => db.projects.where('status').equals('active').toArray(), []);
  const [projectId, setProjectId] = useState<string | null>(null);
  useEffect(() => {
    if (!projectId && projects?.length) setProjectId([...projects].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0].id);
  }, [projects, projectId]);
  if (!projects)
    return (
      <Center h={200}>
        <Loader />
      </Center>
    );
  return (
    <Stack>
      <PageHeader title="Import data" description="Lab results (e.g. Hill Labs Excel), monitoring master spreadsheets or long tables." />
      {!projects.length ? (
        <EmptyState title="Create a project first" action={<NewProjectButton />}>
          Data is imported into a project. You can create sites during the import.
        </EmptyState>
      ) : (
        <>
          <InboxPanel />
          <Select label="Project" data={projects.map((p) => ({ value: p.id, label: p.code ? `${p.name} (${p.code})` : p.name }))} value={projectId} onChange={setProjectId} w={420} searchable allowDeselect={false} />
          {projectId && (
            <ProjectDataProvider key={projectId} projectId={projectId}>
              <ImportWizard projectId={projectId} />
            </ProjectDataProvider>
          )}
        </>
      )}
    </Stack>
  );
}
