import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Anchor, Badge, Button, Card, Group, Modal, ScrollArea, SegmentedControl, Select, Stack, Switch, Text, TextInput, Tooltip } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { IconDeviceFloppy, IconEdit, IconFileSpreadsheet, IconFileTypeDocx, IconFileTypePdf, IconTestPipe, IconUpload } from '@tabler/icons-react';
import { db } from '../db/db';
import { defaultPlans, readImportFiles } from '../importers/files';
import { parseWithPlan } from '../importers/detect';
import { EMPTY_CONTEXT } from '../importers/labExports';
import type { ParsedImport } from '../importers/model';
import { buildParamIndex } from '../lib/matching';
import { displayValue, pivot, type CellFlag } from '../lib/analysis';
import { cellClass, SET_COLOURS, setColourIndex } from '../lib/highlight';
import { describeLimit, guidelineFor } from '../lib/guidelines';
import { formatDate, todayStr } from '../lib/dates';
import { unitLabel } from '../lib/units';
import { ALL_TIME, quickCheck, quickCounts, quickFlags, saveQuickCheck } from '../lib/quickCheck';
import { GuidelinePicker, PageHeader } from '../components/common';
import { useSettings } from '../hooks/useSettings';
import { exportReport } from '../reports/export';
import { QUICK_CHECK_TEMPLATE, QUICK_CHECK_TEMPLATE_ID } from '../data/templates';

// Quick check: drop lab results – no project needed – and see them against guideline values. Nothing is saved
// unless you make a project of them.

const ACCEPT = {
  'application/pdf': ['.pdf'],
  'application/zip': ['.zip'],
  'application/x-zip-compressed': ['.zip'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls', '.csv'],
  'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
  'text/csv': ['.csv'],
  'text/plain': ['.txt', '.tsv'],
};
const PREF = 'envirodb.quickCheck.sets';
const LAYOUT_PREF = 'envirodb.quickCheck.template';
const DEFAULT_SETS = ['anzg-fw-95'];

function loadSets(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PREF) ?? 'null');
    return Array.isArray(v) ? v : DEFAULT_SETS;
  } catch {
    return DEFAULT_SETS;
  }
}

export function QuickCheckPage() {
  const params = useLiveQuery(() => db.parameters.toArray(), []);
  const sets = useLiveQuery(() => db.guidelineSets.toArray(), []);
  const settings = useSettings();
  const navigate = useNavigate();
  const today = todayStr();
  const [read, setRead] = useState<{ fileName: string; parsed: ParsedImport; notes: string[] } | null>(null);
  const [setIds, setSetIdsState] = useState<string[]>(loadSets);
  const [hardness, setHardness] = useState(true);
  const [show, setShow] = useState<'all' | 'guideline' | 'exceed'>('all');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | 'docx' | null>(null);
  const [saving, setSaving] = useState(false);
  const setSetIds = (v: string[]) => {
    setSetIdsState(v);
    try {
      localStorage.setItem(PREF, JSON.stringify(v));
    } catch {
      /* a convenience only */
    }
  };
  const chosen = useMemo(() => setIds.filter((id) => sets?.some((s) => s.id === id)), [setIds, sets]);

  const q = useMemo(() => (read && params && sets ? quickCheck(read.parsed, params, sets, { guidelineSetIds: chosen, hardnessAdjust: hardness, today }) : null), [read, params, sets, chosen, hardness, today]);
  const flags = useMemo(() => (q ? quickFlags(q.bundle, chosen) : new Map<string, CellFlag>()), [q, chosen]);
  const counts = useMemo(() => (q ? quickCounts(q.bundle, chosen) : []), [q, chosen]);
  const table = useMemo(() => (q ? pivot(q.bundle, { siteIds: [], paramIds: [], ...ALL_TIME }) : null), [q]);
  const setList = chosen.map((id) => sets?.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);

  const load = async (files: File[]) => {
    if (!params) return;
    setLoading(true);
    try {
      const inputs = await Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
      const r = await readImportFiles(inputs);
      if (!r.grids.length) throw new Error(r.notes.join(' ') || 'The file has no data.');
      const { plans, notes } = defaultPlans(r.grids, r.context, buildParamIndex(params));
      const parsed = parseWithPlan(r.grids, plans, r.context ?? EMPTY_CONTEXT);
      if (!parsed.samples.length) throw new Error('No samples and results could be read from the file. The Import page lets you show it how the sheet is laid out.');
      setRead({ fileName: r.names.length === 1 ? r.names[0] : `${r.names[0]} and ${r.names.length - 1} more`, parsed, notes: [...r.notes, ...notes, ...parsed.warnings] });
    } catch (e) {
      notifications.show({ title: 'Could not read the file', message: (e as Error).message, color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  // parameters (rows) with a value for a set chosen, or exceeding one
  const rows = useMemo(() => {
    if (!table) return [];
    return table.columns.filter((p) => {
      if (show === 'all') return true;
      const hasValue = setList.some((s) => !!guidelineFor(s, p.id, p.unit));
      if (show === 'guideline') return hasValue;
      return table.rows.some((row) => {
        const r = row.cells.get(p.id);
        return r && flags.get(r.id)?.kind === 'guideline';
      });
    });
  }, [table, show, setList, flags]);

  // the report's layout: the Quick check template (yours to change), or another of your templates
  const templates = useLiveQuery(() => db.templates.toArray(), []);
  const [layoutId, setLayoutIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(LAYOUT_PREF) || QUICK_CHECK_TEMPLATE_ID;
    } catch {
      return QUICK_CHECK_TEMPLATE_ID;
    }
  });
  const setLayoutId = (id: string) => {
    setLayoutIdState(id);
    try {
      localStorage.setItem(LAYOUT_PREF, id);
    } catch {
      /* a convenience only */
    }
  };
  const layout = templates?.find((t) => t.id === layoutId) ?? templates?.find((t) => t.id === QUICK_CHECK_TEMPLATE_ID) ?? QUICK_CHECK_TEMPLATE;
  const layoutOptions = [...(templates ?? [])]
    .sort((a, b) => Number(b.id === QUICK_CHECK_TEMPLATE_ID) - Number(a.id === QUICK_CHECK_TEMPLATE_ID) || a.name.localeCompare(b.name))
    .map((t) => ({ value: t.id, label: t.name }));
  // the file's name is the project's, its lab job the project number – for the template's {{project.name}}, [project code] …
  const reportBundle = () => (q ? { ...q.bundle, project: { ...q.bundle.project, name: (read?.fileName ?? 'Quick check').replace(/\.[^.]+$/, ''), code: read?.parsed.labJob ?? '' } } : null);
  const dates = q?.bundle.samples.map((s) => s.date.slice(0, 10)) ?? [];
  const period = { start: dates[0] ?? today, end: dates[dates.length - 1] ?? today, label: '' };

  const [saveOpen, setSaveOpen] = useState(false);
  const [projectName, setProjectName] = useState('');

  return (
    <Stack>
      <PageHeader
        title="Quick check"
        description="Drop lab results – any project or none – and see them against guideline values straight away. Nothing is saved unless you make a project of them."
      />
      {!q ? (
        <Card>
          <Dropzone onDrop={(files) => files.length && void load(files)} accept={ACCEPT} loading={loading || !params} multiple maxSize={80 * 1024 * 1024}>
            <Group justify="center" gap="md" mih={140} style={{ pointerEvents: 'none' }}>
              <IconTestPipe size={44} stroke={1.3} color="var(--mantine-primary-color-6)" />
              <div>
                <Text fw={600} size="lg">
                  Drop lab results here
                </Text>
                <Text size="sm" c="dimmed">
                  Excel, CSV or PDF lab reports (Hill, ALS, Linnaeus, Eurofins …), several at once or a zip of them
                </Text>
              </div>
            </Group>
          </Dropzone>
        </Card>
      ) : (
        <>
          <Card>
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start" wrap="wrap">
                <div>
                  <Text fw={600}>{read?.fileName}</Text>
                  <Text size="sm" c="dimmed">
                    {q.bundle.samples.length} sample{q.bundle.samples.length === 1 ? '' : 's'} from {q.bundle.sites.length} site{q.bundle.sites.length === 1 ? '' : 's'} · {q.bundle.index.paramIdsWithData.length} parameters
                    {q.undated ? ` · ${q.undated} without a date` : ''}{' '}
                    <Anchor component="button" size="sm" onClick={() => setRead(null)}>
                      Check another file
                    </Anchor>
                  </Text>
                </div>
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<IconFileSpreadsheet size={14} />}
                    loading={exporting === 'xlsx'}
                    onClick={async () => {
                      if (!table) return;
                      setExporting('xlsx');
                      try {
                        const { exportPivotXlsx } = await import('../reports/excel');
                        await exportPivotXlsx({ title: 'Quick check', columns: rows, rows: table.rows, flags, guidelineNames: setList.map((s) => s.name), layout: 'parametersAsRows', fileName: `Quick check - ${read?.fileName ?? ''}` });
                      } finally {
                        setExporting(null);
                      }
                    }}
                  >
                    Excel
                  </Button>
                  <Group gap={2} wrap="nowrap">
                    <Select size="xs" w={210} aria-label="Report layout" data={layoutOptions} value={layout.id} onChange={(v) => v && setLayoutId(v)} allowDeselect={false} comboboxProps={{ withinPortal: true }} />
                    <Tooltip label="Change this layout – sections, header and footer, page" withArrow>
                      <ActionIcon
                        variant="subtle"
                        size="lg"
                        aria-label="Edit the report layout"
                        onClick={async () => {
                          // taken off the list: put the usual one back to change
                          if (!templates?.some((t) => t.id === layout.id)) await db.templates.put(layout);
                          navigate(`/templates/${layout.id}`);
                        }}
                      >
                        <IconEdit size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                  {(['docx', 'pdf'] as const).map((kind) => (
                    <Button
                      key={kind}
                      size="xs"
                      variant="default"
                      leftSection={kind === 'docx' ? <IconFileTypeDocx size={14} /> : <IconFileTypePdf size={14} />}
                      loading={exporting === kind}
                      onClick={async () => {
                        setExporting(kind);
                        try {
                          await exportReport(kind, { bundle: reportBundle()!, template: layout, period, settings });
                        } catch (e) {
                          notifications.show({ title: 'Export failed', message: (e as Error).message, color: 'red' });
                        } finally {
                          setExporting(null);
                        }
                      }}
                    >
                      {kind === 'docx' ? 'Word' : 'PDF'}
                    </Button>
                  ))}
                  <Button
                    size="xs"
                    leftSection={<IconDeviceFloppy size={14} />}
                    onClick={() => {
                      setProjectName(read?.parsed.labJob ? `Lab job ${read.parsed.labJob}` : (read?.fileName ?? '').replace(/\.[^.]+$/, ''));
                      setSaveOpen(true);
                    }}
                  >
                    Make a project of it
                  </Button>
                </Group>
              </Group>
              <Group align="flex-end" gap="md" wrap="wrap">
                <GuidelinePicker sets={sets ?? []} value={chosen} onChange={setSetIds} label="Compare with" w={420} />
                <Switch label="Hardness-modify metals (when hardness is measured)" checked={hardness} onChange={(e) => setHardness(e.currentTarget.checked)} mb={8} />
                <SegmentedControl
                  size="xs"
                  value={show}
                  onChange={(v) => setShow(v as typeof show)}
                  data={[
                    { value: 'all', label: 'All parameters' },
                    { value: 'guideline', label: 'With a guideline' },
                    { value: 'exceed', label: 'Exceeding' },
                  ]}
                  mb={6}
                />
              </Group>
              <Group gap="xs">
                {counts.map((c, k) => {
                  const s = sets?.find((x) => x.id === c.setId);
                  const colour = SET_COLOURS[setColourIndex(k)];
                  return (
                    <Badge key={c.setId} size="lg" variant="light" style={{ background: colour.fill, color: colour.ink }} radius="sm">
                      {s?.shortName ?? s?.name}: {c.exceeded} of {c.compared} results over
                    </Badge>
                  );
                })}
                {!chosen.length && (
                  <Text size="sm" c="dimmed">
                    Choose guideline sets to compare with.
                  </Text>
                )}
              </Group>
            </Stack>
          </Card>
          <Card p={0}>
            <ScrollArea type="auto" offsetScrollbars>
              <table className="edb-grid">
                <thead>
                  <tr>
                    <th className="sticky-col" style={{ minWidth: 200 }}>
                      Parameter
                    </th>
                    <th>Unit</th>
                    {setList.map((s, k) => (
                      <th key={s.id} style={{ boxShadow: `inset 0 -3px 0 ${SET_COLOURS[setColourIndex(k)].fill}` }}>
                        <Tooltip label={s.name}>
                          <span>{s.shortName ?? s.name}</span>
                        </Tooltip>
                      </th>
                    ))}
                    {table?.rows.map((row) => (
                      <th key={row.sample.id} style={{ textAlign: 'right' }}>
                        {row.site.code}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th className="sticky-col" />
                    <th />
                    {setList.map((s) => (
                      <th key={s.id}>guideline</th>
                    ))}
                    {table?.rows.map((row) => (
                      <th key={row.sample.id} style={{ textAlign: 'right' }}>
                        {q.undatedIds.has(row.sample.id) ? 'no date' : formatDate(row.sample.date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td className="sticky-col">{p.name}</td>
                      <td>{unitLabel(p.unit)}</td>
                      {setList.map((s) => {
                        const g = guidelineFor(s, p.id, p.unit);
                        return (
                          <td key={s.id} className="num">
                            {g ? describeLimit(g, unitLabel(p.unit)) : ''}
                          </td>
                        );
                      })}
                      {table!.rows.map((row) => {
                        const r = row.cells.get(p.id);
                        const f = r ? flags.get(r.id) : undefined;
                        return (
                          <td key={row.sample.id} className={`num ${cellClass(f)}`} title={f?.messages.join('\n')}>
                            {r ? displayValue(r, p).text : ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </Card>
          {!rows.length && (
            <Text size="sm" c="dimmed">
              {show === 'exceed' ? 'Nothing exceeds the guidelines chosen.' : 'No parameters to show.'}
            </Text>
          )}
          {(q.unknown.length > 0 || (read?.notes.length ?? 0) > 0) && (
            <Alert variant="light" color="gray" title={q.unknown.length ? `${q.unknown.length} analyte${q.unknown.length === 1 ? '' : 's'} not compared` : 'Notes'}>
              {q.unknown.length > 0 && (
                <Text size="sm">
                  EnviroDB couldn’t tell which parameter {q.unknown.length === 1 ? 'this is' : 'these are'}: {q.unknown.slice(0, 30).map((u) => u.analyte).join(', ')}
                  {q.unknown.length > 30 ? ` and ${q.unknown.length - 30} more` : ''}. Add them to the Parameters library (or import the file into a project to choose them) to compare them.
                </Text>
              )}
              {read?.notes.map((n, i) => (
                <Text key={i} size="xs" c="dimmed">
                  {n}
                </Text>
              ))}
            </Alert>
          )}
        </>
      )}
      <Modal opened={saveOpen} onClose={() => setSaveOpen(false)} title="Make a project of these results">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            A new project with a site for each sample name ({q?.bundle.sites.map((s) => s.code).join(', ')}), these results and the guideline sets chosen. Rename the sites, add consent rules and more in the project afterwards.
          </Text>
          <TextInput label="Project name" value={projectName} onChange={(e) => setProjectName(e.currentTarget.value)} data-autofocus />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={saving}
              disabled={!projectName.trim() || !q || !read}
              leftSection={<IconUpload size={14} />}
              onClick={async () => {
                if (!q || !read) return;
                setSaving(true);
                try {
                  const id = await saveQuickCheck(q, read.parsed, { name: projectName.trim(), fileName: read.fileName, guidelineSetIds: chosen, hardnessAdjust: hardness, today });
                  notifications.show({ color: 'teal', message: `“${projectName.trim()}” made, with ${q.bundle.samples.length} samples` });
                  navigate(`/projects/${id}/data`);
                } catch (e) {
                  notifications.show({ title: 'Could not make the project', message: (e as Error).message, color: 'red' });
                } finally {
                  setSaving(false);
                }
              }}
            >
              Make the project
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
