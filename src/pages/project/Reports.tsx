import { useEffect, useMemo, useState } from 'react';
import { Alert, Anchor, Button, Card, Grid, Group, Loader, Select, Stack, Text, Textarea, Title, Badge, ScrollArea } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearchParams } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconFileTypeDocx, IconFileTypePdf, IconTemplate } from '@tabler/icons-react';
import { db } from '../../db/db';
import { useProject } from '../../hooks/useProjectData';
import { useSettings } from '../../hooks/useSettings';
import { PeriodPicker, defaultPeriod, type PeriodValue } from '../../components/common';
import { nextDueReport, obligationPeriod, obligationPresets } from '../../lib/schedule';
import { formatDate, todayStr } from '../../lib/dates';
import { buildReport } from '../../reports/build';
import { ReportPreview } from '../../reports/html';
import type { ReportDoc } from '../../reports/model';
import { cmToPx, renderChartPng } from '../../charts/render';
import { exportReport } from '../../reports/export';
import { saveObligation } from '../../db/repo';
import type { TextBlock } from '../../db/types';

export function ReportsTab() {
  const data = useProject();
  const { project, obligations } = data;
  const settings = useSettings();
  const templates = useLiveQuery(() => db.templates.toArray(), []);
  const [params] = useSearchParams();

  const oblPresets = useMemo(() => obligationPresets(obligations), [obligations]);

  const [initial] = useState(() => {
    const oId = params.get('obligation');
    const idx = params.get('period');
    const ob = oId ? obligations.find((o) => o.id === oId) : undefined;
    if (ob && idx !== null) {
      const p = obligationPeriod(ob, Number(idx));
      return { period: { key: `obl:${ob.id}:${p.index}`, start: p.periodStart, end: p.periodEnd, label: `${ob.name}: ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` }, templateId: ob.templateId };
    }
    const s = params.get('start'), e = params.get('end');
    if (s && e) return { period: { key: 'custom', start: s, end: e, label: `${formatDate(s)} – ${formatDate(e)}` }, templateId: params.get('template') ?? undefined };
    // default: the report that is due next (unsubmitted and whose period has ended)
    const next = nextDueReport(obligations);
    if (next) {
      const { obligation: o, period: p } = next;
      return { period: { key: `obl:${o.id}:${p.index}`, start: p.periodStart, end: p.periodEnd, label: `${o.name}: ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` }, templateId: o.templateId ?? params.get('template') ?? undefined };
    }
    return { period: defaultPeriod(project.yearStartMonth, 'lastRy'), templateId: params.get('template') ?? undefined };
  });

  const [period, setPeriod] = useState<PeriodValue>(initial.period);
  const [templateId, setTemplateId] = useState<string | null>(initial.templateId ?? settings.defaultTemplateId ?? 'tpl-annual');
  const template = templates?.find((t) => t.id === templateId) ?? templates?.find((t) => t.id === 'tpl-annual');
  const draftKey = template ? `draft:${project.id}:${template.id}:${period.start}:${period.end}` : '';
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  useEffect(() => {
    // load the saved commentary once per template/period (not live, so typing is never overwritten)
    let alive = true;
    if (draftKey) void db.meta.get(draftKey).then((r) => alive && setPrompts((r?.value as Record<string, string>) ?? {}));
    return () => {
      alive = false;
    };
  }, [draftKey]);
  const promptBlocks = (template?.blocks.filter((b) => b.type === 'text' && b.prompt) ?? []) as TextBlock[];

  // Build the preview (debounced; graphs rendered at lower resolution)
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [building, setBuilding] = useState(false);
  useEffect(() => {
    if (!template) return;
    setBuilding(true);
    const h = setTimeout(() => {
      try {
        setDoc(
          buildReport({ bundle: data, template, period, settings, promptTexts: prompts, renderChart: (opt, w, hh) => renderChartPng(opt, cmToPx(w), cmToPx(hh), 1.5) }),
        );
      } finally {
        setBuilding(false);
      }
    }, 350);
    return () => clearTimeout(h);
  }, [data, template, period, settings, prompts]);

  const [busy, setBusy] = useState<'pdf' | 'docx' | null>(null);
  const exportDoc = async (kind: 'pdf' | 'docx') => {
    if (!template) return;
    setBusy(kind);
    try {
      await exportReport(kind, { bundle: data, template, period, settings, promptTexts: prompts });
    } catch (e) {
      notifications.show({ title: 'Export failed', message: (e as Error).message, color: 'red' });
    } finally {
      setBusy(null);
    }
  };

  const obl = period.key.startsWith('obl:') ? oblPresets.find((p) => p.key === period.key) : undefined;
  const obligation = obl ? obligations.find((o) => o.id === obl.obligationId) : undefined;
  const submitted = obligation?.submissions.find((s) => s.periodEnd === period.end);

  const savePrompt = (id: string, text: string) => {
    const next = { ...prompts, [id]: text };
    setPrompts(next);
    if (draftKey) void db.meta.put({ key: draftKey, value: next });
  };

  if (!templates)
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );

  return (
    <Grid gutter="lg">
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <Stack gap="md" style={{ position: 'sticky', top: 70 }}>
          <Card padding="md">
            <Stack gap="sm">
              <Title order={5}>Report settings</Title>
              <Select
                label="Template"
                data={templates.map((t) => ({ value: t.id, label: t.builtIn ? t.name : `${t.name} (custom)` }))}
                value={template?.id ?? null}
                onChange={setTemplateId}
                allowDeselect={false}
                description={template?.description}
              />
              <PeriodPicker value={period} onChange={setPeriod} yearStartMonth={project.yearStartMonth} extra={oblPresets} width="100%" />
              <Stack gap={6}>
                <Button fullWidth leftSection={<IconFileTypeDocx size={18} />} loading={busy === 'docx'} onClick={() => exportDoc('docx')} disabled={!template}>
                  Download Word (.docx)
                </Button>
                <Button fullWidth variant="light" leftSection={<IconFileTypePdf size={18} />} loading={busy === 'pdf'} onClick={() => exportDoc('pdf')} disabled={!template}>
                  Download PDF
                </Button>
                <Text size="xs" c="dimmed">
                  Word (.docx) is fully editable – headings use Word's Heading styles, so you can add a table of contents or paste into your own report template.
                </Text>
              </Stack>
              {obligation && (
                <Group justify="space-between">
                  {submitted ? (
                    <Badge color="green" leftSection={<IconCheck size={12} />}>
                      Submitted {formatDate(submitted.submittedOn)}
                    </Badge>
                  ) : (
                    <Text size="xs" c="dimmed">
                      Due {formatDate(obligationPeriod(obligation, obl!.index).dueDate)}
                    </Text>
                  )}
                  {!submitted && (
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      leftSection={<IconCheck size={14} />}
                      onClick={() => saveObligation({ ...obligation, submissions: [...obligation.submissions, { periodStart: period.start, periodEnd: period.end, submittedOn: todayStr() }] })}
                    >
                      Mark submitted
                    </Button>
                  )}
                </Group>
              )}
              <Anchor component={Link} to={template ? `/templates/${template.id}` : '/templates'} size="sm">
                <Group gap={4}>
                  <IconTemplate size={14} />
                  {template?.builtIn ? 'Customise this template' : 'Edit this template'}
                </Group>
              </Anchor>
            </Stack>
          </Card>
          {promptBlocks.length > 0 && (
            <Card padding="md">
              <Title order={5} mb={4}>
                Commentary for this report
              </Title>
              <Text size="xs" c="dimmed" mb="sm">
                Saved automatically with this project and period. Use **bold**, *italic* and “- ” for bullets.
              </Text>
              <Stack gap="sm">
                {promptBlocks.map((b) => {
                  const idx = template!.blocks.findIndex((x) => x.id === b.id);
                  const heading = [...template!.blocks.slice(0, idx)].reverse().find((x) => x.type === 'heading') as { text: string } | undefined;
                  return <Textarea key={b.id} label={heading?.text ?? 'Text'} autosize minRows={4} maxRows={14} value={prompts[b.id] ?? b.text} onChange={(e) => savePrompt(b.id, e.currentTarget.value)} />;
                })}
              </Stack>
            </Card>
          )}
          {!data.samples.length && (
            <Alert color="orange" variant="light">
              This project has no data yet – the report will be mostly empty.
            </Alert>
          )}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <Card padding={0} bg="var(--mantine-color-gray-1)" style={{ overflow: 'hidden' }}>
          <Group justify="space-between" px="md" py="xs">
            <Text size="sm" c="dimmed">
              Preview {building && <Loader size="xs" ml={6} />}
            </Text>
            <Text size="xs" c="dimmed">
              Page breaks and exact layout are applied in the PDF / Word file
            </Text>
          </Group>
          <ScrollArea h="calc(100vh - 230px)" type="auto">
            <div style={{ padding: 16, opacity: building ? 0.6 : 1, transition: 'opacity 120ms' }}>{doc ? <ReportPreview doc={doc} scale={0.85} /> : <Loader m="xl" />}</div>
          </ScrollArea>
        </Card>
      </Grid.Col>
    </Grid>
  );
}
