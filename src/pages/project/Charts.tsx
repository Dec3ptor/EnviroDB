import { useMemo, useRef, useState } from 'react';
import { ActionIcon, Badge, Button, Card, Checkbox, ColorInput, Divider, Drawer, Group, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Switch, Text, TextInput, Tooltip, useComputedColorScheme } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAdjustmentsHorizontal, IconCloudRain, IconCopy, IconDownload, IconFileTypeDocx, IconPhoto, IconPlus, IconTrash } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { DateField, EmptyState, GuidelinePicker, NoResultsYet, ParamPicker, PeriodPicker, SitePicker, consentPresets, defaultPeriod, type PeriodValue } from '../../components/common';
import { buildChartSpec, chartOption, chartOverlay, NOTE_COLOR, type ChartSpec } from '../../charts/timeSeries';
import { applyGraphSettings, followShared, graphSettings, hasOwn, reviveGraphs, reviveOne, shareLook, type GraphOverrides, type GraphSettings } from '../../charts/custom';
import { KIND_TEXT } from '../../lib/continuous';
import { Link } from 'react-router-dom';
import { EChart, type EChartHandle } from '../../charts/EChart';
import { cmToPx, copyPngToClipboard, renderChartPng } from '../../charts/render';
import { keyParameters } from '../../lib/analysis';
import { chartTrends } from '../../lib/projectTrends';
import { reviveIds, revivePeriod, useViewState } from '../../hooks/useViewState';
import { expandRules } from '../../lib/compliance';
import { downloadBlob, safeFileName } from '../../db/backup';
import { dataUrlToBlob } from '../../charts/render';
import { formatDate } from '../../lib/dates';
import { useFeature } from '../../hooks/useFeatures';
import { db } from '../../db/db';
import { SERIES_LIGHT } from '../../theme';
import type { Site } from '../../db/types';

export const SIZE_PRESETS: Record<string, { label: string; w: number; h: number }> = {
  half: { label: 'Word – half page (16 × 8 cm)', w: 16, h: 8 },
  full: { label: 'Word – larger (16 × 11 cm)', w: 16, h: 11 },
  land: { label: 'Landscape page (24 × 12 cm)', w: 24, h: 12 },
  square: { label: 'Square (12 × 12 cm)', w: 12, h: 12 },
  slide: { label: 'Slide (25 × 14 cm)', w: 25, h: 14 },
};

/** Colours to pick for a site: the graphs' palette and a few more. */
const SITE_SWATCHES = [...SERIES_LIGHT, '#0b7285', '#862e9c', '#5c940d', '#495057', '#000000'];
const NOTE_SWATCHES = [NOTE_COLOR, '#d03b3b', '#e8590c', '#2b8a3e', '#1c7ed6', '#000000'];

function ChartCard({ spec, size, dark, customised, onCustomise }: { spec: ChartSpec; size: { w: number; h: number }; dark: boolean; customised: boolean; onCustomise: () => void }) {
  const ref = useRef<EChartHandle>(null);
  const png = () => renderChartPng(chartOption(spec, { forExport: true, width: cmToPx(size.w) }), cmToPx(size.w), cmToPx(size.h), 3);
  const option = useMemo(() => (width: number, hidden: ReadonlySet<string>) => chartOption(spec, { dark, showTitle: false, width, hidden }), [spec, dark]);
  return (
    <Card padding="md">
      <Group justify="space-between" mb={4} wrap="nowrap" align="flex-start">
        <div style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {spec.title}
          </Text>
          {spec.subtitle && (
            <Text size="xs" c="dimmed" truncate>
              {spec.subtitle}
            </Text>
          )}
        </div>
        <Group gap={4} wrap="nowrap">
          <Tooltip label={customised ? 'Customise this graph (it has settings of its own)' : 'Customise this graph'}>
            <ActionIcon variant={customised ? 'light' : 'default'} aria-label="Customise this graph" onClick={onCustomise}>
              <IconAdjustmentsHorizontal size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Copy image – paste straight into Word or an email">
            <ActionIcon
              variant="default"
              aria-label="Copy image"
              onClick={async () => {
                const ok = await copyPngToClipboard(png());
                notifications.show({ message: ok ? 'Graph copied – paste it into your document' : 'Copying images is not supported in this browser – use Download instead', color: ok ? 'teal' : 'orange' });
              }}
            >
              <IconCopy size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Download PNG (high resolution)">
            <ActionIcon variant="default" aria-label="Download PNG" onClick={() => downloadBlob(dataUrlToBlob(png()), `${safeFileName(spec.title)}.png`)}>
              <IconDownload size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      {spec.series.length ? (
        <EChart ref={ref} option={option} height={Math.round(Math.max(260, Math.min(460, (size.h / size.w) * 720)))} />
      ) : (
        <Text c="dimmed" size="sm" py="xl" ta="center">
          No data for the selected sites and period.
        </Text>
      )}
    </Card>
  );
}

/**
 * The Customise panel: one graph's settings (its text, sites, lines, look and notes), or the look shared by all the
 * graphs. Site colours are the project's, so they match on every graph, report and map.
 */
function GraphPanel({
  opened,
  onClose,
  scope,
  heading,
  settings,
  unit,
  sites,
  onChange,
  onSiteColour,
  onReset,
  onApplyAll,
}: {
  opened: boolean;
  onClose: () => void;
  scope: 'one' | 'all';
  heading: string;
  settings: GraphSettings;
  unit: string;
  /** The sites on the graph (one), or all the project's sites with data (all). */
  sites: Site[];
  onChange: (patch: Partial<GraphSettings>) => void;
  onSiteColour: (id: string, colour: string | undefined) => void;
  onReset: () => void;
  onApplyAll?: () => void;
}) {
  const g = settings;
  const seg = (label: string, value: string, data: Array<{ value: string; label: string }>, set: (v: string) => void) => (
    <div>
      <Text size="xs" fw={500} mb={4}>
        {label}
      </Text>
      <SegmentedControl size="xs" fullWidth value={value} data={data} onChange={set} />
    </div>
  );
  const setLine = (i: number, patch: Partial<GraphSettings['refLines'][number]>) => onChange({ refLines: g.refLines.map((n, j) => (j === i ? { ...n, ...patch } : n)) });
  const setEvent = (i: number, patch: Partial<GraphSettings['events'][number]>) => onChange({ events: g.events.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="md" title={<Text fw={600}>{heading}</Text>} padding="md">
      <Stack gap="md">
        {scope === 'one' && (
          <Stack gap="xs">
            <TextInput size="sm" label="Title" value={g.title ?? ''} onChange={(e) => onChange({ title: e.currentTarget.value || undefined })} placeholder="As the parameter is named" />
            <TextInput size="sm" label="Subtitle" value={g.subtitle ?? ''} onChange={(e) => onChange({ subtitle: e.currentTarget.value || undefined })} placeholder="Under the title, e.g. the site or the consent" />
            <TextInput size="sm" label="Axis label" value={g.yLabel ?? ''} onChange={(e) => onChange({ yLabel: e.currentTarget.value || undefined })} placeholder={unit || 'The unit'} />
          </Stack>
        )}
        <div>
          <Text size="sm" fw={600} mb={4}>
            Sites
          </Text>
          <Stack gap={6}>
            {sites.map((s, i) => {
              const shown = !g.hidden.includes(s.id);
              return (
                <Group key={s.id} gap="xs" wrap="nowrap">
                  <ColorInput
                    size="xs"
                    w={118}
                    aria-label={`${s.code} colour`}
                    value={s.colour ?? SERIES_LIGHT[i % SERIES_LIGHT.length]}
                    swatches={SITE_SWATCHES}
                    swatchesPerRow={7}
                    withEyeDropper={false}
                    onChangeEnd={(v) => onSiteColour(s.id, v)}
                  />
                  {scope === 'one' ? (
                    <Checkbox size="sm" label={s.code} checked={shown} onChange={(e) => onChange({ hidden: e.currentTarget.checked ? g.hidden.filter((id) => id !== s.id) : [...g.hidden, s.id] })} style={{ flex: 1 }} />
                  ) : (
                    <Text size="sm" style={{ flex: 1 }}>
                      {s.code}
                    </Text>
                  )}
                  {s.colour && (
                    <Button size="compact-xs" variant="subtle" onClick={() => onSiteColour(s.id, undefined)}>
                      Default
                    </Button>
                  )}
                </Group>
              );
            })}
          </Stack>
          <Text size="xs" c="dimmed" mt={6}>
            A site’s colour is the project’s: the same on every graph, in reports and on the map, for everyone.{scope === 'one' ? ' Untick a site to leave it off this graph.' : ''}
          </Text>
        </div>
        <Divider />
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Lines
          </Text>
          <Switch size="sm" label="Consent limits and triggers" checked={g.rules} onChange={(e) => onChange({ rules: e.currentTarget.checked })} />
          <Switch size="sm" label="Trend lines (Sen’s slope, where there are enough results)" checked={g.trends} onChange={(e) => onChange({ trends: e.currentTarget.checked })} />
          <Text size="xs" c="dimmed">
            Guideline lines are chosen above the graphs.
          </Text>
        </Stack>
        <Divider />
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Look
          </Text>
          {seg('Results', g.look.kind, [{ value: 'lines', label: 'Lines & points' }, { value: 'points', label: 'Points only' }, { value: 'linesOnly', label: 'Lines only' }], (v) => onChange({ look: { ...g.look, kind: v as GraphSettings['look']['kind'] } }))}
          {seg('Weight', g.look.weight, [{ value: 'light', label: 'Light' }, { value: 'normal', label: 'Normal' }, { value: 'bold', label: 'Bold' }], (v) => onChange({ look: { ...g.look, weight: v as GraphSettings['look']['weight'] } }))}
          {seg('Text size', String(g.fontScale), [{ value: '1', label: 'Normal' }, { value: '1.25', label: 'Larger (slides)' }], (v) => onChange({ fontScale: v === '1.25' ? 1.25 : 1 }))}
          {seg('Site legend', g.legend, [{ value: 'top', label: 'Above the graph' }, { value: 'none', label: 'Hidden' }], (v) => onChange({ legend: v as GraphSettings['legend'] }))}
          {seg('Value axis', g.yAxis, [{ value: 'auto', label: 'Fit the data' }, { value: 'zero', label: 'From zero' }, { value: 'set', label: 'Set the range' }], (v) => onChange({ yAxis: v as GraphSettings['yAxis'] }))}
          {g.yAxis === 'set' && (
            <Group grow>
              <NumberInput size="xs" label="From" value={g.yMin ?? ''} onChange={(v) => onChange({ yMin: v === '' ? undefined : Number(v) })} placeholder="Auto" hideControls />
              <NumberInput size="xs" label="To" value={g.yMax ?? ''} onChange={(v) => onChange({ yMax: v === '' ? undefined : Number(v) })} placeholder="Auto" hideControls />
            </Group>
          )}
          <Switch size="sm" label="Log scale" checked={g.log} onChange={(e) => onChange({ log: e.currentTarget.checked })} />
        </Stack>
        {scope === 'one' && (
          <>
            <Divider />
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Your own lines and events
              </Text>
              <Text size="xs" c="dimmed">
                A line across the graph at a value (a baseline, an older limit), or a date to mark (works done, a spill). Each shows its label on the graph.
              </Text>
              {g.refLines.map((n, i) => (
                <Group key={`l${i}`} gap={6} wrap="nowrap" align="flex-end">
                  <NumberInput size="xs" label={i === 0 ? 'Value' : undefined} value={n.value} onChange={(v) => setLine(i, { value: typeof v === 'number' ? v : Number(v) })} w={96} hideControls decimalScale={6} />
                  <TextInput size="xs" label={i === 0 ? 'Label' : undefined} value={n.label} onChange={(e) => setLine(i, { label: e.currentTarget.value })} placeholder="e.g. Baseline" style={{ flex: 1 }} />
                  <ColorInput size="xs" w={60} aria-label="Line colour" value={n.color ?? NOTE_COLOR} swatches={NOTE_SWATCHES} swatchesPerRow={6} withEyeDropper={false} onChangeEnd={(v) => setLine(i, { color: v })} />
                  <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove line" onClick={() => onChange({ refLines: g.refLines.filter((_, j) => j !== i) })}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ))}
              {g.events.map((e, i) => (
                <Group key={`e${i}`} gap={6} wrap="nowrap" align="flex-end">
                  <DateField size="xs" label={i === 0 ? 'Date' : undefined} value={e.date} onChange={(d) => d && setEvent(i, { date: d })} w={128} />
                  <TextInput size="xs" label={i === 0 ? 'Label' : undefined} value={e.label} onChange={(ev) => setEvent(i, { label: ev.currentTarget.value })} placeholder="e.g. Pond upgraded" style={{ flex: 1 }} />
                  <ColorInput size="xs" w={60} aria-label="Event colour" value={e.color ?? NOTE_COLOR} swatches={NOTE_SWATCHES} swatchesPerRow={6} withEyeDropper={false} onChangeEnd={(v) => setEvent(i, { color: v })} />
                  <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove event" onClick={() => onChange({ events: g.events.filter((_, j) => j !== i) })}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ))}
              <Group gap="xs">
                <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => onChange({ refLines: [...g.refLines, { value: 0, label: '' }] })}>
                  Add a line
                </Button>
                <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => onChange({ events: [...g.events, { date: new Date().toISOString().slice(0, 10), label: '' }] })}>
                  Add an event
                </Button>
              </Group>
            </Stack>
          </>
        )}
        <Divider />
        <Group justify="space-between">
          <Button size="xs" variant="subtle" color="red" onClick={onReset}>
            {scope === 'one' ? 'Reset this graph' : 'Back to the defaults'}
          </Button>
          <Group gap="xs">
            {onApplyAll && (
              <Button size="xs" variant="default" onClick={onApplyAll}>
                Apply the look to all graphs
              </Button>
            )}
            <Button size="xs" onClick={onClose}>
              Done
            </Button>
          </Group>
        </Group>
      </Stack>
    </Drawer>
  );
}

export function ChartsTab() {
  const data = useProject();
  const continuous = useFeature('continuous');
  const { project, sites, params, guidelineSets, index, rules, setMap } = data;
  const scheme = useComputedColorScheme('light');
  // the graphs as set up last time on this project (kept when going to another tab, and for next time)
  const k = (name: string) => `${project.id}:charts.${name}`;
  const [paramIds, setParamIds] = useViewState<string[]>(k('params'), () => keyParameters(data, 4), reviveIds((id) => data.paramMap.has(id)));
  const [siteIds, setSiteIds] = useViewState<string[]>(k('sites'), [], reviveIds((id) => data.siteMap.has(id)));
  const [period, setPeriod] = useViewState<PeriodValue>(k('period'), () => defaultPeriod(project.yearStartMonth, 'all'), revivePeriod(project.yearStartMonth));
  const [setIds, setSetIds] = useViewState<string[]>(k('sets'), project.guidelineSetIds, reviveIds((id) => data.setMap.has(id)));
  const [sizeKey, setSizeKey] = useViewState(k('size'), 'half', (v) => (SIZE_PRESETS[v] ? v : undefined));
  // the look shared by all the graphs, and each graph's own settings over it (older saved titles and switches carry over)
  const [oldRules] = useViewState(k('rules'), true);
  const [oldLog] = useViewState(k('log'), false);
  const [oldTrends] = useViewState(k('trends'), false);
  const [oldTitles] = useViewState<Record<string, string>>(k('titles'), {});
  const [shared, setShared] = useViewState<Partial<GraphSettings>>(k('shared'), () => ({ rules: oldRules, log: oldLog, trends: oldTrends }), (v) => reviveOne(v));
  const [graphs, setGraphs] = useViewState<Record<string, GraphOverrides>>(k('graphs'), () => Object.fromEntries(Object.entries(oldTitles).map(([id, title]) => [id, { title }])), reviveGraphs);
  const [panel, setPanel] = useState<string | 'all' | null>(null);
  // rainfall, flow or level behind the graphs
  const [overlayId, setOverlayId] = useViewState<string | null>(k('overlay'), null, (v) => (v === null || data.continuous.series.some((x) => x.id === v) ? v : undefined));
  const overlaySeries = continuous ? data.continuous.series.find((x) => x.id === overlayId) : undefined;
  const [busy, setBusy] = useState(false);
  const withData = useMemo(() => new Set(index.paramIdsWithData), [index]);
  const presets = useMemo(() => consentPresets(data, withData), [data, withData]);
  const size = SIZE_PRESETS[sizeKey];
  const sets = setIds.map((id) => setMap.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
  const limitRules = useMemo(() => expandRules(rules, setMap), [rules, setMap]);
  const settingsOf = (pid: string) => graphSettings(shared, graphs[pid]);
  const own = (pid: string, patch: GraphOverrides) => setGraphs({ ...graphs, [pid]: { ...graphs[pid], ...patch } });
  // a shared setting changed for all: every graph follows it again
  const forAll = (patch: Partial<GraphSettings>) => {
    setShared({ ...shared, ...patch });
    const next: Record<string, GraphOverrides> = {};
    for (const [id, o] of Object.entries(graphs)) {
      const rest = { ...o };
      for (const key of Object.keys(patch) as Array<keyof GraphSettings>) delete rest[key];
      next[id] = rest;
    }
    setGraphs(next);
  };
  const setSiteColour = (id: string, colour: string | undefined) => void db.sites.update(id, { colour });

  const specs = useMemo(
    () =>
      paramIds
        .map((pid) => data.paramMap.get(pid))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => {
          const g = graphSettings(shared, graphs[p.id]);
          const spec = buildChartSpec({ index, param: p, sites, siteIds, start: period.start, end: period.end, guidelineSets: sets, rules: limitRules, setMap, showRules: g.rules, log: g.log });
          // each site's Sen's slope over the graph's dates
          if (g.trends) spec.trends = chartTrends(data, p.id, spec.series.map((x) => x.id), period.start, period.end);
          if (overlaySeries) spec.overlay = chartOverlay(overlaySeries, data.continuous.days.filter((d) => d.seriesId === overlaySeries.id), period.start, period.end);
          // the graph's sites before any are left off it, for the Customise panel
          const graphSites = spec.series.map((s) => data.siteMap.get(s.id)).filter((s): s is Site => !!s);
          return { p, spec: applyGraphSettings(spec, g), graphSites };
        }),
    [paramIds, data, index, sites, siteIds, period, sets, limitRules, overlaySeries, shared, graphs],
  );

  const exportDocx = async () => {
    setBusy(true);
    try {
      const { chartsToDocx } = await import('../../reports/docx');
      const images = specs.filter((x) => x.spec.series.length).map((x) => ({ title: x.spec.title, dataUrl: renderChartPng(chartOption(x.spec, { forExport: true, width: cmToPx(size.w) }), cmToPx(size.w), cmToPx(size.h), 3), widthCm: size.w, heightCm: size.h }));
      const blob = await chartsToDocx(`${project.name} – graphs`, `${period.label} · generated ${formatDate(new Date().toISOString().slice(0, 10))}`, images);
      downloadBlob(blob, `${safeFileName(project.name)} graphs.docx`);
    } finally {
      setBusy(false);
    }
  };

  if (!data.samples.length) return <NoResultsYet projectId={project.id} shows="Graphs of each analyte over time, with the consent limits and guideline values, appear here" />;

  const open = panel && panel !== 'all' ? specs.find((x) => x.p.id === panel) : undefined;
  const sitesWithData = sites.filter((s) => specs.some((x) => x.graphSites.some((g) => g.id === s.id)));
  const sharedSettings = graphSettings(shared, undefined);
  const customisedCount = Object.entries(graphs).filter(([id, o]) => paramIds.includes(id) && hasOwn(o)).length;

  return (
    <Stack gap="md">
      <Card padding="md">
        <Stack gap="sm">
          <Group align="flex-end" gap="sm" wrap="wrap">
            <ParamPicker compact params={params} value={paramIds} onChange={setParamIds} onlyIds={withData} presets={presets} w={{ base: '100%', xs: 230 }} label="Graphs of" placeholder="Choose parameters" title="Choose what to graph" />
            <SitePicker compact sites={sites} value={siteIds} onChange={setSiteIds} w={{ base: '100%', xs: 180 }} />
            <PeriodPicker value={period} onChange={setPeriod} yearStartMonth={project.yearStartMonth} width={{ base: '100%', xs: 250 }} />
            <GuidelinePicker compact sets={guidelineSets} value={setIds} onChange={setSetIds} w={{ base: '100%', xs: 210 }} label="Guideline lines" placeholder="No guideline lines" />
          </Group>
          <Group align="center" gap="lg" wrap="wrap">
            <Switch label="Consent limits / triggers" checked={sharedSettings.rules} onChange={(e) => forAll({ rules: e.currentTarget.checked })} />
            <Switch label="Log scale" checked={sharedSettings.log} onChange={(e) => forAll({ log: e.currentTarget.checked })} />
            <Tooltip label="Each site’s Sen’s slope over the dates shown, where there are enough results (see Graphs → Trends)">
              <Switch label="Trend lines" checked={sharedSettings.trends} onChange={(e) => forAll({ trends: e.currentTarget.checked })} />
            </Tooltip>
            {continuous && data.continuous.series.length ? (
              <Select
                aria-label="Rainfall or flow behind the graphs"
                placeholder="No rainfall or flow"
                data={data.continuous.series.map((x) => ({ value: x.id, label: x.name }))}
                renderOption={({ option }) => {
                  const x = data.continuous.series.find((y) => y.id === option.value);
                  return (
                    <div>
                      <Text size="sm">{option.label}</Text>
                      <Text size="xs" c="dimmed">
                        {x ? `${KIND_TEXT[x.kind]}${x.unit ? ` (${x.unit})` : ''}` : ''}
                      </Text>
                    </div>
                  );
                }}
                leftSection={<IconCloudRain size={16} />}
                value={overlayId}
                onChange={setOverlayId}
                clearable
                w={250}
                comboboxProps={{ width: 'max-content' }}
              />
            ) : continuous ? (
              <Text size="xs" c="dimmed">
                <Link to={`/projects/${project.id}/setup#continuous`}>Add rainfall or flow</Link> to show it behind the graphs
              </Text>
            ) : null}
            <Group gap="sm" ml="auto" wrap="wrap">
              <Button variant="default" leftSection={<IconAdjustmentsHorizontal size={16} />} onClick={() => setPanel('all')} rightSection={customisedCount ? <Badge size="xs" variant="light" circle={customisedCount < 10}>{customisedCount}</Badge> : undefined}>
                Customise all graphs
              </Button>
              <Select aria-label="Graph size" data={Object.entries(SIZE_PRESETS).map(([value, v]) => ({ value, label: v.label }))} value={sizeKey} onChange={(v) => v && setSizeKey(v)} w={230} allowDeselect={false} comboboxProps={{ width: 'max-content' }} />
              <Button variant="default" leftSection={<IconFileTypeDocx size={16} />} loading={busy} onClick={exportDocx} disabled={!specs.length}>
                All graphs to Word
              </Button>
            </Group>
          </Group>
        </Stack>
      </Card>
      {!specs.length ? (
        <EmptyState icon={<IconPhoto size={32} />} title="Choose one or more parameters">
          Each parameter gets its own graph, with one line per site. Consent limits, triggers and guideline values are drawn as solid, dashed and dotted lines, with a key below the graph.
        </EmptyState>
      ) : (
        <SimpleGrid cols={{ base: 1, xl: specs.length > 1 ? 2 : 1 }}>
          {specs.map(({ p, spec }) => (
            <ChartCard key={p.id} spec={spec} size={size} dark={scheme === 'dark'} customised={hasOwn(graphs[p.id])} onCustomise={() => setPanel(p.id)} />
          ))}
        </SimpleGrid>
      )}
      <Text size="xs" c="dimmed">
        Tip: the sliders button on a graph customises it – its title, colours, sites, axis, and lines or dates of your own. Copy pastes a graph straight into Word; downloads are 3× resolution so they stay sharp when printed.
      </Text>
      {open && (
        <GraphPanel
          opened
          onClose={() => setPanel(null)}
          scope="one"
          heading={`Customise: ${open.p.name}`}
          settings={settingsOf(open.p.id)}
          unit={open.spec.unit}
          sites={open.graphSites}
          onChange={(patch) => own(open.p.id, patch)}
          onSiteColour={setSiteColour}
          onReset={() => {
            const next = { ...graphs };
            delete next[open.p.id];
            setGraphs(next);
          }}
          onApplyAll={() => {
            const look = shareLook(settingsOf(open.p.id));
            setShared({ ...shared, ...look });
            setGraphs(Object.fromEntries(Object.entries(graphs).map(([id, o]) => [id, followShared(o)])));
            notifications.show({ message: 'Every graph now has this look. Each keeps its own title, sites and notes.', color: 'teal' });
          }}
        />
      )}
      {panel === 'all' && (
        <GraphPanel
          opened
          onClose={() => setPanel(null)}
          scope="all"
          heading="Customise all graphs"
          settings={sharedSettings}
          unit=""
          sites={sitesWithData}
          onChange={forAll}
          onSiteColour={setSiteColour}
          onReset={() => {
            setShared({});
            setGraphs(Object.fromEntries(Object.entries(graphs).map(([id, o]) => [id, followShared(o)])));
          }}
        />
      )}
    </Stack>
  );
}
