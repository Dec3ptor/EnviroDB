import { useMemo, useRef, useState } from 'react';
import { ActionIcon, Button, Card, Group, Select, SimpleGrid, Stack, Switch, Text, TextInput, Tooltip, useComputedColorScheme } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconDownload, IconFileTypeDocx, IconPhoto } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { EmptyState, GuidelinePicker, ParamPicker, PeriodPicker, SitePicker, consentPresets, defaultPeriod, type PeriodValue } from '../../components/common';
import { buildChartSpec, chartOption, type ChartSpec } from '../../charts/timeSeries';
import { EChart, type EChartHandle } from '../../charts/EChart';
import { cmToPx, copyPngToClipboard, renderChartPng } from '../../charts/render';
import { keyParameters } from '../../lib/analysis';
import { reviveIds, revivePeriod, useViewState } from '../../hooks/useViewState';
import { expandRules } from '../../lib/compliance';
import { downloadBlob, safeFileName } from '../../db/backup';
import { dataUrlToBlob } from '../../charts/render';
import { formatDate } from '../../lib/dates';

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
  const [sizeKey, setSizeKey] = useViewState(k('size'), 'half', (v) => (SIZE_PRESETS[v] ? v : undefined));
  const [titles, setTitles] = useViewState<Record<string, string>>(k('titles'), {});
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
        .map((p) => ({
          p,
          spec: buildChartSpec({ index, param: p, sites, siteIds, start: period.start, end: period.end, guidelineSets: sets, rules: limitRules, setMap, showRules, log }),
        })),
    [paramIds, data.paramMap, index, sites, siteIds, period, sets, limitRules, showRules, log],
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

  if (!data.samples.length) return <EmptyState title="No data to graph yet">Import some results first.</EmptyState>;

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
