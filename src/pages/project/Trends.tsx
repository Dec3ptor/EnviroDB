// The Trends tab: is each site getting better or worse? Mann-Kendall / seasonal Kendall trends with Sen's slope for
// each site and analyte, a graph of the one chosen with its trend line, and downstream compared with upstream.

import { useMemo, useState } from 'react';
import { Anchor, Badge, Card, Group, Select, SegmentedControl, Stack, Table, Text, Title, Tooltip, useComputedColorScheme } from '@mantine/core';
import { IconArrowDownRight, IconArrowUpRight, IconArrowRight } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { useViewState, reviveIds } from '../../hooks/useViewState';
import { EmptyState, MoreOptions, ParamPicker, SitePicker, consentPresets } from '../../components/common';
import { keyParameters } from '../../lib/analysis';
import { compareSites, defaultPairs, latestDate, projectTrends, trendRange, TREND_SPANS, type SitePair, type TrendRow, type TrendSpan } from '../../lib/projectTrends';
import { CATEGORY_TEXT, categoryTone, likelihood, likelihoodPct, likelihoodText, trendLinePoints, type SeasonChoice, type TrendResult } from '../../lib/trends';
import { buildChartSpec, chartOption } from '../../charts/timeSeries';
import { EChart } from '../../charts/EChart';
import { expandRules } from '../../lib/compliance';
import { formatDate } from '../../lib/dates';
import { unitLabel } from '../../lib/units';
import { fmtNum } from '../../lib/values';

const TONE_COLOR = { good: 'teal', bad: 'red', neutral: 'blue', none: 'gray' } as const;
const STEP_TEXT: Record<TrendResult['step'], string> = { month: 'monthly', quarter: 'quarterly', year: 'yearly', sample: 'each result' };

export function TrendBadge({ r }: { r: TrendResult }) {
  const tone = categoryTone(r.category);
  const Icon = r.category === 'indeterminate' || !r.ok ? IconArrowRight : r.pIncreasing > 0.5 ? IconArrowUpRight : IconArrowDownRight;
  return (
    <Badge variant="light" color={TONE_COLOR[tone]} leftSection={r.ok ? <Icon size={12} /> : undefined} style={{ textTransform: 'none' }}>
      {CATEGORY_TEXT[r.category]}
    </Badge>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function TrendsTab() {
  const data = useProject();
  const { project, sites, params, index, rules, setMap } = data;
  const dark = useComputedColorScheme('light') === 'dark';
  const k = (name: string) => `${project.id}:trends.${name}`;
  const [span, setSpan] = useViewState<TrendSpan>(k('span'), '10y');
  const [seasons, setSeasons] = useViewState<SeasonChoice>(k('seasons'), 'auto');
  const [paramIds, setParamIds] = useViewState<string[]>(k('params'), () => keyParameters(data, 8), reviveIds((id) => data.paramMap.has(id)));
  const [siteIds, setSiteIds] = useViewState<string[]>(k('sites'), [], reviveIds((id) => data.siteMap.has(id)));
  const [picked, setPicked] = useState<string | null>(null);
  const withData = useMemo(() => new Set(index.paramIdsWithData), [index]);
  const presets = useMemo(() => consentPresets(data, withData), [data, withData]);
  const range = trendRange(span, latestDate(data));
  const shownParams = paramIds.length ? paramIds : keyParameters(data, 8);
  const rows = useMemo(() => projectTrends(data, { siteIds, parameterIds: shownParams, start: range.start, end: range.end, seasons }), [data, siteIds, shownParams.join(), range.start, range.end, seasons]); // eslint-disable-line react-hooks/exhaustive-deps
  const assessed = rows.filter((r) => r.result.ok);
  const count = (tone: string) => assessed.filter((r) => categoryTone(r.result.category) === tone).length;
  const current = rows.find((r) => `${r.siteId}|${r.parameterId}` === picked) ?? assessed[0] ?? rows[0];

  if (!data.samples.length) return <EmptyState title="No results yet">Import some results first.</EmptyState>;

  return (
    <Stack gap="md">
      <Card padding="md">
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
          <div>
            <Title order={4}>Trends</Title>
            <Text size="sm" c="dimmed">
              {assessed.length
                ? `${assessed.length} trend${assessed.length === 1 ? '' : 's'}: ${count('good')} improving, ${count('bad')} degrading, ${assessed.length - count('good') - count('bad')} indeterminate or neither`
                : 'Not enough results for trends yet'}
              {` · ${range.start ? formatDate(range.start) : 'all results'} to ${formatDate(range.end)}`}
            </Text>
          </div>
          <Group gap="xs" wrap="wrap" align="flex-end">
            <ParamPicker compact params={params} value={paramIds} onChange={setParamIds} onlyIds={withData} presets={presets} w={{ base: '100%', xs: 220 }} label="Analytes" placeholder="Consent analytes" title="Choose analytes" />
            <SitePicker compact sites={sites} value={siteIds} onChange={setSiteIds} w={{ base: '100%', xs: 170 }} />
            <div>
              <Text size="sm" fw={500} mb={2}>
                Over
              </Text>
              <SegmentedControl size="xs" value={span} onChange={(v) => setSpan(v as TrendSpan)} data={TREND_SPANS} aria-label="Years looked at" />
            </div>
            <Select
              label="Seasons"
              size="xs"
              w={150}
              value={seasons}
              onChange={(v) => v && setSeasons(v as SeasonChoice)}
              data={[
                { value: 'auto', label: 'If they matter' },
                { value: 'months', label: 'By month' },
                { value: 'quarters', label: 'By quarter' },
                { value: 'none', label: 'Ignore' },
              ]}
              allowDeselect={false}
            />
          </Group>
        </Group>
      </Card>

      {current && <TrendChart row={current} range={range} dark={dark} rules={expandRules(rules, setMap)} />}

      <Card padding="md">
        {rows.length ? (
          <Table.ScrollContainer minWidth={760}>
            <Table highlightOnHover fz="sm" verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Site</Table.Th>
                  <Table.Th>Analyte</Table.Th>
                  <Table.Th>Trend</Table.Th>
                  <Table.Th ta="right">Change a year</Table.Th>
                  <Table.Th ta="right">Likelihood</Table.Th>
                  <Table.Th>Results</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => {
                  const r = row.result;
                  const p = data.paramMap.get(row.parameterId);
                  const key = `${row.siteId}|${row.parameterId}`;
                  const sel = current && key === `${current.siteId}|${current.parameterId}`;
                  return (
                    <Table.Tr key={key} onClick={() => setPicked(key)} className="clickable-row" style={sel ? { background: 'var(--mantine-color-default-hover)' } : undefined} aria-selected={sel}>
                      <Table.Td fw={600}>{data.siteMap.get(row.siteId)?.code}</Table.Td>
                      <Table.Td>{p?.name ?? row.parameterId}</Table.Td>
                      <Table.Td>
                        <TrendBadge r={r} />
                      </Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {r.ok && r.slope !== null ? (
                          <Tooltip label={`Sen’s slope ${fmtNum(r.slope)} ${unitLabel(p?.unit)} a year; 90% confidence ${r.slopeLo === null ? '?' : fmtNum(r.slopeLo)} to ${r.slopeHi === null ? '?' : fmtNum(r.slopeHi)}${r.disagree ? ' – the other way from the test, because of results below detection: a rough size' : r.approximate ? ' – approximate: many results below detection' : ''}`}>
                            <span>
                              {r.slope > 0 ? '+' : ''}
                              {fmtNum(r.slope)} {unitLabel(p?.unit)}
                              {r.pctPerYear !== null && r.slope ? <Text span c="dimmed" size="xs">{` (${r.pctPerYear > 0 ? '+' : ''}${r.pctPerYear.toFixed(1)}%)`}</Text> : null}
                              {r.approximate ? ' ~' : ''}
                            </span>
                          </Tooltip>
                        ) : (
                          ''
                        )}
                      </Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {likelihoodText(r)}
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {r.ok
                            ? `${r.n} ${STEP_TEXT[r.step]}${r.step === 'sample' ? '' : ' values'} over ${r.years.toFixed(1)} years${r.seasonal ? ', by season' : ''}${r.censored ? `, ${pct(r.censored)} below detection` : ''}`
                            : r.reason}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text size="sm" c="dimmed">
            No results for these analytes and sites over this time.
          </Text>
        )}
        <MoreOptions label="How trends are worked out">
          <Text size="xs" c="dimmed">
            As in NZ’s national water quality reporting (LAWA; Snelder &amp; Fraser 2021): results are first reduced to one value per month or quarter (the median), by how often the site is sampled. The Mann-Kendall test then says how likely the values are to be rising or falling – the seasonal
            Kendall test, comparing each season only with itself, when results vary with the season (Kruskal-Wallis, p &lt; 0.05). Sen’s slope gives the size: the median of the slopes between every pair of values (in the same season), with a 90% confidence interval; as a percentage of the
            median, the change a year. Results below detection count as equal (below the highest detection limit) for the test, and as half their detection limit for the slope – marked ~ when more than 15% are. For most analytes a fall is an improvement; for dissolved oxygen and
            clarity a rise is; pH and temperature are only rising or falling. Very likely: 90% or more; likely: 67–90%; indeterminate in between. The likelihood shown is the chance of the more likely direction – “80% degrading” is a 20% chance of improving. At least 8 values over two years are needed, 5 of them above detection.
          </Text>
        </MoreOptions>
      </Card>

      <UpDownCard paramIds={shownParams} start={range.start} end={range.end} />
    </Stack>
  );
}

function TrendChart({ row, range, dark, rules }: { row: TrendRow; range: { start?: string; end: string }; dark: boolean; rules: ReturnType<typeof expandRules> }) {
  const data = useProject();
  const p = data.paramMap.get(row.parameterId);
  const option = useMemo(() => {
    if (!p) return null;
    // from the first result looked at (not years before it)
    const from = row.result.from && (!range.start || row.result.from > range.start) ? row.result.from : range.start;
    const spec = buildChartSpec({ index: data.index, param: p, sites: data.sites, siteIds: [row.siteId], start: from, end: range.end, guidelineSets: [], rules, setMap: data.setMap, showRules: true });
    spec.trends = row.result.ok ? [{ seriesId: row.siteId, points: trendLinePoints(row.result) }] : [];
    return (width: number, hidden: ReadonlySet<string>) => chartOption(spec, { dark, showTitle: false, width, hidden });
  }, [p, data, row, range.start, range.end, rules, dark]);
  if (!p || !option) return null;
  const r = row.result;
  const size = !r.slope
    ? 'Sen’s slope 0 – too many equal values (or results below detection) to give a size'
    : r.disagree
      ? `Sen’s slope ${r.slope > 0 ? '+' : ''}${fmtNum(r.slope)} ${unitLabel(p.unit)} a year – the other way from the test, because results below detection count differently in each (a high detection limit ties every value under it for the test): check those results`
      : `${r.slope > 0 ? 'Rising' : 'Falling'} by ${fmtNum(Math.abs(r.slope))} ${unitLabel(p.unit)} a year${r.pctPerYear !== null ? ` (${Math.abs(r.pctPerYear).toFixed(1)}% of the median)` : ''}${r.approximate ? ' – a rough size, because of results below detection' : ''}`;
  return (
    <Card padding="md">
      <Group justify="space-between" wrap="wrap" gap="xs" mb={4}>
        <Text fw={600}>
          {p.name} at {data.siteMap.get(row.siteId)?.code}
        </Text>
        <TrendBadge r={r} />
      </Group>
      <Text size="xs" c="dimmed" mb={4}>
        {r.ok ? `${size}; ${likelihood(r) ? `${likelihoodPct(likelihood(r)!.p)} likely to be ${likelihood(r)!.direction}` : ''}. Mann-Kendall${r.seasonal ? ' (seasonal)' : ''} p = ${r.p < 0.001 ? '< 0.001' : r.p.toFixed(3)}.` : r.reason}
      </Text>
      <EChart option={option} height={300} />
    </Card>
  );
}

function UpDownCard({ paramIds, start, end }: { paramIds: string[]; start?: string; end: string }) {
  const data = useProject();
  const { project, sites } = data;
  const pairs = useMemo(() => defaultPairs(data), [data]);
  const [pair, setPair] = useViewState<SitePair | null>(`${project.id}:trends.pair`, pairs[0] ?? null, (v) => (v && data.siteMap.has(v.upId) && data.siteMap.has(v.downId) ? v : undefined));
  const [days, setDays] = useViewState<string>(`${project.id}:trends.pairDays`, '1');
  const rows = useMemo(() => (pair ? compareSites(data, pair, paramIds, start, end, Number(days)) : []), [data, pair, paramIds.join(), start, end, days]); // eslint-disable-line react-hooks/exhaustive-deps
  const siteOptions = sites.map((s) => ({ value: s.id, label: s.name ? `${s.code} – ${s.name}` : s.code }));
  const VERDICT = { higher: { text: 'Higher downstream', color: 'red' }, lower: { text: 'Lower downstream', color: 'teal' }, 'no-difference': { text: 'No clear difference', color: 'gray' }, 'too-few': { text: 'Too few pairs', color: 'gray' } } as const;
  return (
    <Card padding="md">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm" mb="sm">
        <div>
          <Title order={4}>Upstream and downstream</Title>
          <Text size="sm" c="dimmed">
            Results taken on the same day (or within the days allowed), downstream against upstream.
          </Text>
        </div>
        <Group gap="xs" wrap="wrap" align="flex-end">
          <Select label="Upstream" size="xs" w={190} data={siteOptions} value={pair?.upId ?? null} onChange={(v) => v && setPair({ upId: v, downId: pair?.downId ?? sites.find((s) => s.id !== v)?.id ?? v })} />
          <Select label="Downstream" size="xs" w={190} data={siteOptions} value={pair?.downId ?? null} onChange={(v) => v && setPair({ downId: v, upId: pair?.upId ?? sites.find((s) => s.id !== v)?.id ?? v })} />
          <Select label="Pair within" size="xs" w={110} data={[{ value: '0', label: 'Same day' }, { value: '1', label: '1 day' }, { value: '3', label: '3 days' }, { value: '7', label: '7 days' }]} value={days} onChange={(v) => v && setDays(v)} allowDeselect={false} />
        </Group>
      </Group>
      {!pair ? (
        <Text size="sm" c="dimmed">
          Choose an upstream and a downstream site. (Sites with the roles “Upstream / control” and “Downstream / impact” are paired up for you.)
        </Text>
      ) : rows.length ? (
        <Table.ScrollContainer minWidth={700}>
          <Table fz="sm" verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Analyte</Table.Th>
                <Table.Th ta="right">Pairs</Table.Th>
                <Table.Th ta="right">Upstream median</Table.Th>
                <Table.Th ta="right">Downstream median</Table.Th>
                <Table.Th ta="right">Median difference</Table.Th>
                <Table.Th ta="right">Higher downstream</Table.Th>
                <Table.Th>Difference</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map(({ parameterId, c }) => {
                const p = data.paramMap.get(parameterId);
                const u = unitLabel(p?.unit);
                return (
                  <Table.Tr key={parameterId}>
                    <Table.Td>{p?.name ?? parameterId}</Table.Td>
                    <Table.Td ta="right">{c.n}</Table.Td>
                    <Table.Td ta="right">{c.upMedian === null ? '' : `${fmtNum(c.upMedian, p?.decimals)} ${u}`}</Table.Td>
                    <Table.Td ta="right">{c.downMedian === null ? '' : `${fmtNum(c.downMedian, p?.decimals)} ${u}`}</Table.Td>
                    <Table.Td ta="right">{c.medianDiff === null ? '' : `${c.medianDiff > 0 ? '+' : ''}${fmtNum(c.medianDiff, p?.decimals)}`}</Table.Td>
                    <Table.Td ta="right">{c.n - c.bothNd ? pct(c.higherDown) : ''}</Table.Td>
                    <Table.Td>
                      <Tooltip label={c.p === null ? 'At least 6 pairs that differ are needed.' : `Wilcoxon signed-rank test, p = ${c.p < 0.001 ? '< 0.001' : c.p.toFixed(3)}${c.bothNd ? `; ${c.bothNd} pair${c.bothNd === 1 ? '' : 's'} both below detection left out` : ''}`}>
                        <Badge variant="light" color={VERDICT[c.verdict].color} style={{ textTransform: 'none' }}>
                          {VERDICT[c.verdict].text}
                        </Badge>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <Text size="sm" c="dimmed">
          No results taken at both sites {Number(days) ? `within ${days} day${days === '1' ? '' : 's'}` : 'on the same day'}.{' '}
          {Number(days) < 7 && (
            <Anchor component="button" size="sm" onClick={() => setDays('7')}>
              Allow 7 days
            </Anchor>
          )}
        </Text>
      )}
      <Text size="xs" c="dimmed" mt="xs">
        A difference is called when the Wilcoxon signed-rank test on the paired differences gives p &lt; 0.05. Pairs both below detection are left out; one below detection and the other above it counts as lower.
      </Text>
    </Card>
  );
}
