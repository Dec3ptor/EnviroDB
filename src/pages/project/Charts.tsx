import { useMemo, useRef, useState } from 'react';
import { ActionIcon, Button, Card, Group, Select, SimpleGrid, Stack, Switch, Text, TextInput, Tooltip, useComputedColorScheme } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCloudRain, IconCopy, IconDownload, IconFileTypeDocx, IconPhoto } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { EmptyState, GuidelinePicker, NoResultsYet, ParamPicker, PeriodPicker, SitePicker, consentPresets, defaultPeriod, type PeriodValue } from '../../components/common';
import { buildChartSpec, chartOption, chartOverlay, type ChartSpec } from '../../charts/timeSeries';
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

export const SIZE_PRESETS: Record<string, { label: string; w: number; h: number }> = {
  half: { label: 'Word – half page (16 × 8 cm)', w: 16, h: 8 },
  full: { label: 'Word – larger (16 × 11 cm)', w: 16, h: 11 },
  land: { label: 'Landscape page (24 × 12 cm)', w: 24, h: 12 },
  square: { label: 'Square (12 × 12 cm)', w: 12, h: 12 },
  slide: { label: 'Slide (25 × 14 cm)', w: 25, h: 14 },
};

function ChartCard({ spec, size, title, onTitle, dark }: { spec: ChartSpec; size: { w: number; h: number }; title: string; onTitle: (t: string) => void; dark: boolean }) {
  const ref = useRef<EChartHandle>(null);
  const exportSpec = { ...spec, title };
  const png = () => renderChartPng(chartOption(exportSpec, { forExport: true, width: cmToPx(size.w) }), cmToPx(size.w), cmToPx(size.h), 3);
  const option = useMemo(() => (width: number, hidden: ReadonlySet<string>) => chartOption({ ...spec, title }, { dark, showTitle: false, width, hidden }), [spec, title, dark]);
  return (
    <Card padding="md">
      <Group justify="space-between" mb={4} wrap="nowrap">
        <TextInput variant="unstyled" value={title} onChange={(e) => onTitle(e.currentTarget.value)} size="sm" fw={600} style={{ flex: 1 }} aria-label="Graph title" />
        <Group gap={4} wrap="nowrap">
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
            <ActionIcon variant="default" aria-label="Download PNG" onClick={() => downloadBlob(dataUrlToBlob(png()), `${safeFileName(title)}.png`)}>
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
  const [showRules, setShowRules] = useViewState(k('rules'), true);
  const [log, setLog] = useViewState(k('log'), false);
  const [trendLines, setTrendLines] = useViewState(k('trends'), false);
  const [sizeKey, setSizeKey] = useViewState(k('size'), 'half', (v) => (SIZE_PRESETS[v] ? v : undefined));
  const [titles, setTitles] = useViewState<Record<string, string>>(k('titles'), {});
  // rainfall, flow or level behind the graphs
  const [overlayId, setOverlayId] = useViewState<string | null>(k('overlay'), null, (v) => (v === null || data.continuous.series.some((x) => x.id === v) ? v : undefined));
  const overlaySeries = continuous ? data.continuous.series.find((x) => x.id === overlayId) : undefined;
  const [busy, setBusy] = useState(false);
  const withData = useMemo(() => new Set(index.paramIdsWithData), [index]);
  const presets = useMemo(() => consentPresets(data, withData), [data, withData]);
  const size = SIZE_PRESETS[sizeKey];
  const sets = setIds.map((id) => setMap.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
  const limitRules = useMemo(() => expandRules(rules, setMap), [rules, setMap]);

  const specs = useMemo(
    () =>
      paramIds
        .map((pid) => data.paramMap.get(pid))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => {
          const spec = buildChartSpec({ index, param: p, sites, siteIds, start: period.start, end: period.end, guidelineSets: sets, rules: limitRules, setMap, showRules, log });
          // each site's Sen's slope over the graph's dates
          if (trendLines) spec.trends = chartTrends(data, p.id, spec.series.map((x) => x.id), period.start, period.end);
          if (overlaySeries) spec.overlay = chartOverlay(overlaySeries, data.continuous.days.filter((d) => d.seriesId === overlaySeries.id), period.start, period.end);
          return { p, spec };
        }),
    [paramIds, data, index, sites, siteIds, period, sets, limitRules, showRules, log, trendLines, overlaySeries],
  );

  const exportDocx = async () => {
    setBusy(true);
    try {
      const { chartsToDocx } = await import('../../reports/docx');
      const images = specs
        .filter((x) => x.spec.series.length)
        .map((x) => {
          const title = titles[x.p.id] ?? x.spec.title;
          return { title, dataUrl: renderChartPng(chartOption({ ...x.spec, title }, { forExport: true, width: cmToPx(size.w) }), cmToPx(size.w), cmToPx(size.h), 3), widthCm: size.w, heightCm: size.h };
        });
      const blob = await chartsToDocx(`${project.name} – graphs`, `${period.label} · generated ${formatDate(new Date().toISOString().slice(0, 10))}`, images);
      downloadBlob(blob, `${safeFileName(project.name)} graphs.docx`);
    } finally {
      setBusy(false);
    }
  };

  if (!data.samples.length) return <NoResultsYet projectId={project.id} shows="Graphs of each analyte over time, with the consent limits and guideline values, appear here" />;

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
            <Switch label="Consent limits / triggers" checked={showRules} onChange={(e) => setShowRules(e.currentTarget.checked)} />
            <Switch label="Log scale" checked={log} onChange={(e) => setLog(e.currentTarget.checked)} />
            <Tooltip label="Each site’s Sen’s slope over the dates shown, where there are enough results (see Graphs → Trends)">
              <Switch label="Trend lines" checked={trendLines} onChange={(e) => setTrendLines(e.currentTarget.checked)} />
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
            ) : (
              <Text size="xs" c="dimmed">
                <Link to={`/projects/${project.id}/setup#continuous`}>Add rainfall or flow</Link> to show it behind the graphs
              </Text>
            )}
            <Group gap="sm" ml="auto" wrap="wrap">
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
            <ChartCard key={p.id} spec={spec} size={size} title={titles[p.id] ?? spec.title} onTitle={(t) => setTitles({ ...titles, [p.id]: t })} dark={scheme === 'dark'} />
          ))}
        </SimpleGrid>
      )}
      <Text size="xs" c="dimmed">
        Tip: use the copy button to paste a graph directly into Word. Downloads are 3× resolution so they stay sharp when printed. Site colours stay the same on every graph.
      </Text>
    </Stack>
  );
}
