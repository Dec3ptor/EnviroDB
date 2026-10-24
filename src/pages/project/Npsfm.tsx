// The NPS-FM tab: each site's attribute bands (National Objectives Framework) over a period, the statistics behind
// each, the national bottom lines, and how each site is graded (river or lake, sediment class, lake type …).

import { useMemo, useState } from 'react';
import { Alert, Badge, Card, Group, SegmentedControl, Select, Stack, Switch, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { useViewState } from '../../hooks/useViewState';
import { MoreOptions, NoResultsYet } from '../../components/common';
import { BAND_COLOR, NPSFM_ATTRIBUTES, NPSFM_NOT_GRADED, NPSFM_SOURCE } from '../../data/npsfm';
import { projectNpsfm, siteClass, type AttributeGrade, type SiteClass } from '../../lib/npsfm';
import { latestDate, trendRange, type TrendSpan } from '../../lib/projectTrends';
import { saveSite } from '../../db/repo';
import { formatDate } from '../../lib/dates';
import { unitLabel } from '../../lib/units';
import { fmtNum } from '../../lib/values';
import type { Site } from '../../db/types';

type Span = TrendSpan | '1y' | '3y';
const SPANS: Array<{ value: Span; label: string }> = [
  { value: '1y', label: '12 months' },
  { value: '3y', label: '3 years' },
  { value: '5y', label: '5 years' },
  { value: 'all', label: 'All' },
];

export function npsfmRange(span: Span, end: string): { start?: string; end: string } {
  if (span === '1y' || span === '3y') {
    const years = span === '1y' ? 1 : 3;
    const d = new Date(Date.UTC(+end.slice(0, 4) - years, +end.slice(5, 7) - 1, +end.slice(8, 10) + 1));
    return { start: d.toISOString().slice(0, 10), end };
  }
  return trendRange(span === '10y' ? '10y' : span, end);
}

export function BandBadge({ g, size = 'md' }: { g: AttributeGrade; size?: 'sm' | 'md' }) {
  if (!g.band) return <Text size="xs" c="dimmed">{g.reason === 'No results.' ? '–' : '?'}</Text>;
  const below = g.meetsBottomLine === false;
  return (
    <Badge size={size} color={BAND_COLOR[g.band]} variant={below ? 'outline' : 'filled'} style={below ? { borderWidth: 2, borderColor: 'var(--mantine-color-red-7)' } : undefined}>
      {g.band}
      {g.provisional ? '*' : ''}
    </Badge>
  );
}

const statText = (g: AttributeGrade) =>
  g.stats.map((s) => `${s.label}: ${s.value === null ? '–' : s.key.startsWith('over') ? `${s.value.toFixed(1)}%` : fmtNum(Number(s.value.toPrecision(3)))} (${s.band ?? '–'})`).join(' · ');

export function NpsfmTab() {
  const data = useProject();
  const { project, sites } = data;
  const [span, setSpan] = useViewState<Span>(`${project.id}:npsfm.span`, '5y');
  const range = npsfmRange(span, latestDate(data));
  const graded = useMemo(() => projectNpsfm(data, range.start, range.end), [data, range.start, range.end]);
  const withGrades = graded.filter((g) => g.grades.length);
  const attrs = NPSFM_ATTRIBUTES.filter((a) => withGrades.some((s) => s.grades.some((g) => g.attribute.id === a.id && (g.band || g.reason !== 'No results.'))));
  const [pick, setPick] = useState<{ siteId: string; attrId: string } | null>(null);
  const picked = pick ? withGrades.find((s) => s.site.id === pick.siteId)?.grades.find((g) => g.attribute.id === pick.attrId) : undefined;
  const below = withGrades.flatMap((s) => s.grades.filter((g) => g.meetsBottomLine === false).map((g) => ({ s, g })));

  if (!data.samples.length) return <NoResultsYet projectId={data.project.id} shows="Each freshwater site’s NPS-FM attribute bands show here" />;

  return (
    <Stack gap="md">
      <Card padding="md">
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
          <div>
            <Title order={4}>NPS-FM attribute bands</Title>
            <Text size="sm" c="dimmed">
              The National Objectives Framework bands for each site, {range.start ? `${formatDate(range.start)} to ` : 'all results to '}
              {formatDate(range.end)}.
            </Text>
          </div>
          <SegmentedControl size="xs" value={span} onChange={(v) => setSpan(v as Span)} data={SPANS} aria-label="Results graded" />
        </Group>
        {below.length > 0 && (
          <Alert color="red" variant="light" mt="sm" p="xs" icon={<IconAlertTriangle size={16} />}>
            Below the national bottom line: {below.map(({ s, g }) => `${s.site.code} ${g.attribute.name} (${g.band})`).join(', ')}.
          </Alert>
        )}
      </Card>

      <Card padding="md">
        {withGrades.length && attrs.length ? (
          <>
            <Table.ScrollContainer minWidth={Math.max(480, 220 + withGrades.length * 70)}>
              <Table fz="sm" verticalSpacing={6} withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Attribute</Table.Th>
                    {withGrades.map((s) => (
                      <Table.Th key={s.site.id} ta="center">
                        {s.site.code}
                        <Text size="xs" c="dimmed" fw={400}>
                          {s.cls.water}
                        </Text>
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {attrs.map((a) => (
                    <Table.Tr key={a.id}>
                      <Table.Td>
                        <Text size="sm">{a.name}</Text>
                        <Text size="xs" c="dimmed">
                          Appendix {a.appendix}
                          {a.bottomLine ? ` · bottom line ${a.bottomLineText}` : ''}
                        </Text>
                      </Table.Td>
                      {withGrades.map((s) => {
                        const g = s.grades.find((x) => x.attribute.id === a.id);
                        const sel = pick?.siteId === s.site.id && pick.attrId === a.id;
                        return (
                          <Table.Td key={s.site.id} ta="center" onClick={() => g && setPick({ siteId: s.site.id, attrId: a.id })} style={{ cursor: g ? 'pointer' : undefined, background: sel ? 'var(--mantine-color-default-hover)' : undefined }}>
                            {g ? (
                              <Tooltip label={g.band ? `${statText(g)} · ${g.provisional ?? `${g.n} results`}` : g.reason} multiline w={300}>
                                <span>
                                  <BandBadge g={g} />
                                </span>
                              </Tooltip>
                            ) : (
                              <Text size="xs" c="dimmed">
                                n/a
                              </Text>
                            )}
                          </Table.Td>
                        );
                      })}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Text size="xs" c="dimmed" mt="xs">
              Click a band for its statistics. * provisional (fewer results than the NPS-FM asks for, or another caveat). Outlined in red: below the national bottom line. – no results; ? see why (a class to set). n/a: not an attribute for that site.
            </Text>
          </>
        ) : (
          <Text size="sm" c="dimmed">
            No sites graded yet: surface water sites are graded as rivers – set how others are graded below.
          </Text>
        )}
      </Card>

      {picked && pick && <GradeDetail g={picked} site={data.siteMap.get(pick.siteId)!} />}

      <SiteClasses sites={sites} />

      <Card padding="md">
        <Text size="xs" c="dimmed">
          {NPSFM_SOURCE}. The NPS-FM is under review – check the version in force and these bands against it before relying on a grade. Statistics use the Hazen method; results below detection are graded at their detection limit. Not graded here (they need data EnviroDB doesn’t hold):{' '}
          {NPSFM_NOT_GRADED.join('; ')}.
        </Text>
      </Card>
    </Stack>
  );
}

function GradeDetail({ g, site }: { g: AttributeGrade; site: Site }) {
  const a = g.attribute;
  return (
    <Card padding="md">
      <Group justify="space-between" mb="xs" wrap="wrap">
        <Text fw={600}>
          {a.name} at {site.code}
        </Text>
        <BandBadge g={g} />
      </Group>
      {g.band ? (
        <>
          <Table fz="sm" verticalSpacing={4} maw={560}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Statistic</Table.Th>
                <Table.Th ta="right">Value</Table.Th>
                <Table.Th ta="center">Band</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {g.stats.map((s) => (
                <Table.Tr key={s.key}>
                  <Table.Td>{s.label}</Table.Td>
                  <Table.Td ta="right">
                    {s.value === null ? '–' : s.key.startsWith('over') ? `${s.value.toFixed(1)}%` : `${fmtNum(Number(s.value.toPrecision(3)))} ${unitLabel(a.unit)}`}
                  </Table.Td>
                  <Table.Td ta="center">{s.band && <Badge size="sm" color={BAND_COLOR[s.band]}>{s.band}</Badge>}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Text size="xs" c="dimmed" mt="xs">
            {g.n} results, {g.from ? formatDate(g.from) : ''} to {g.to ? formatDate(g.to) : ''}. {a.note}
            {a.bottomLine ? ` National bottom line: ${a.bottomLineText} – ${g.meetsBottomLine ? 'met' : 'not met'}.` : ''}
            {g.provisional ? ` Provisional: ${g.provisional}.` : ''}
          </Text>
        </>
      ) : (
        <Text size="sm" c="dimmed">
          {g.reason}
        </Text>
      )}
    </Card>
  );
}

function SiteClasses({ sites }: { sites: Site[] }) {
  const save = (s: Site, patch: Partial<SiteClass>) => void saveSite({ ...s, npsfm: { ...s.npsfm, ...patch } }, s);
  return (
    <Card padding="md">
      <MoreOptions label="How each site is graded" summary="River or lake, suspended sediment class, periphyton class, lake type, swimming site">
        <Table.ScrollContainer minWidth={760}>
          <Table fz="sm" verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Site</Table.Th>
                <Table.Th>Graded as</Table.Th>
                <Table.Th>Suspended sediment class</Table.Th>
                <Table.Th>Periphyton class</Table.Th>
                <Table.Th>Lake type</Table.Th>
                <Table.Th>Swimming site</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sites.map((s) => {
                const c = siteClass(s);
                return (
                  <Table.Tr key={s.id}>
                    <Table.Td fw={600}>
                      {s.code}
                      <Text size="xs" c="dimmed" fw={400}>
                        {s.type}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Select size="xs" w={130} value={c.water ?? 'none'} onChange={(v) => v && save(s, { water: v as SiteClass['water'] })} data={[{ value: 'river', label: 'River' }, { value: 'lake', label: 'Lake' }, { value: 'none', label: 'Not graded' }]} allowDeselect={false} aria-label={`${s.code} graded as`} />
                    </Table.Td>
                    <Table.Td>
                      {c.water === 'river' && (
                        <Select size="xs" w={110} placeholder="Choose" value={c.sedimentClass ? String(c.sedimentClass) : null} onChange={(v) => save(s, { sedimentClass: v ? (Number(v) as 1 | 2 | 3 | 4) : undefined })} data={['1', '2', '3', '4']} clearable aria-label={`${s.code} suspended sediment class`} />
                      )}
                    </Table.Td>
                    <Table.Td>
                      {c.water === 'river' && (
                        <Select size="xs" w={130} value={c.periphyton ?? 'default'} onChange={(v) => v && save(s, { periphyton: v as SiteClass['periphyton'] })} data={[{ value: 'default', label: 'Default' }, { value: 'productive', label: 'Productive' }]} allowDeselect={false} aria-label={`${s.code} periphyton class`} />
                      )}
                    </Table.Td>
                    <Table.Td>
                      {c.water === 'lake' && (
                        <Select
                          size="xs"
                          w={170}
                          placeholder="Choose"
                          value={c.lakeType ?? null}
                          onChange={(v) => save(s, { lakeType: (v ?? undefined) as SiteClass['lakeType'] })}
                          data={[
                            { value: 'stratified', label: 'Seasonally stratified' },
                            { value: 'polymictic', label: 'Polymictic' },
                            { value: 'brackish', label: 'Brackish' },
                          ]}
                          clearable
                          aria-label={`${s.code} lake type`}
                        />
                      )}
                    </Table.Td>
                    <Table.Td>{c.water !== 'none' && <Switch size="xs" checked={!!c.primaryContact} onChange={(e) => save(s, { primaryContact: e.currentTarget.checked })} aria-label={`${s.code} is a swimming site`} />}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Text size="xs" c="dimmed" mt="xs">
          Surface water sites are graded as rivers unless set otherwise. The suspended sediment class (1–4) and periphyton class come from the River Environment Classification for the site’s reach (your regional council’s
          freshwater plan usually lists them). Swimming sites are also graded on the primary contact E. coli attribute.
        </Text>
      </MoreOptions>
    </Card>
  );
}
