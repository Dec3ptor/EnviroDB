import { useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, Alert, Button, Checkbox, Grid, Group, Modal, ScrollArea, SimpleGrid, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconCopy, IconDownload, IconInfoCircle } from '@tabler/icons-react';
import { useProject } from '../hooks/useProjectData';
import { ParamPicker, PeriodPicker, SitePicker, defaultPeriod, type PeriodValue } from './common';
import { AI_PROMPTS, AI_SECTION_LABELS, DEFAULT_SECTIONS, approxTokens, buildAiInput, withRequest, type AiInputSections } from '../lib/aiInput';
import { nextDueReport, obligationPresets } from '../lib/schedule';
import { formatDate } from '../lib/dates';
import { downloadBlob } from '../db/backup';
import { copyText } from '../lib/clipboard';
import type { ReportObligation } from '../db/types';

/** Starting selection, e.g. the filters of the page the window was opened from. */
export interface AiInputStart {
  period?: PeriodValue;
  siteIds?: string[];
  paramIds?: string[];
}

const SECTION_ORDER: Array<keyof AiInputSections> = ['results', 'stats', 'compliance', 'rules', 'guidelines', 'schedule'];
const PREVIEW_CHARS = 20000;
const LARGE_CHARS = 150000;

// Section choices and "leave out names" are remembered in this browser.
const PREFS_KEY = 'edb.aiInput';
interface Prefs {
  sections: AiInputSections;
  hideNames: boolean;
}
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>;
      return { sections: { ...DEFAULT_SECTIONS, ...p.sections }, hideNames: !!p.hideNames };
    }
  } catch {
    // storage unavailable – use defaults
  }
  return { sections: DEFAULT_SECTIONS, hideNames: false };
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // not remembered – fine
  }
}

/** The report due next (as on the Reports tab), otherwise the last 12 months. */
function defaultAiPeriod(obligations: ReportObligation[], yearStartMonth: number): PeriodValue {
  const next = nextDueReport(obligations);
  if (!next) return defaultPeriod(yearStartMonth, 'last12');
  const { obligation: o, period: p } = next;
  return { key: `obl:${o.id}:${p.index}`, start: p.periodStart, end: p.periodEnd, label: `${o.name}: ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` };
}

export function AiInputModal({ opened, onClose, start }: { opened: boolean; onClose: () => void; start?: AiInputStart }) {
  const mobile = useMediaQuery('(max-width: 48em)');
  return (
    <Modal opened={opened} onClose={onClose} size="60rem" fullScreen={mobile} title={<Text fw={700}>Copy for AI input</Text>}>
      <AiInputForm start={start} />
    </Modal>
  );
}

function AiInputForm({ start }: { start?: AiInputStart }) {
  const data = useProject();
  const { project, sites, params, obligations, index } = data;
  const [period, setPeriod] = useState<PeriodValue>(() => start?.period ?? defaultAiPeriod(obligations, project.yearStartMonth));
  const [siteIds, setSiteIds] = useState<string[]>(start?.siteIds ?? []);
  const [paramIds, setParamIds] = useState<string[]>(start?.paramIds ?? []);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [request, setRequest] = useState('');
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const initialKey = useRef(period);
  const presets = useMemo(() => {
    const list: Array<{ key: string; start: string; end: string; label: string }> = obligationPresets(obligations);
    const init = initialKey.current;
    if (init.key.startsWith('obl:') && !list.some((p) => p.key === init.key)) list.unshift(init);
    return list;
  }, [obligations]);
  const withData = useMemo(() => new Set(index.paramIdsWithData), [index]);

  const pack = useMemo(
    () => buildAiInput(data, { start: period.start, end: period.end, siteIds, paramIds, sections: prefs.sections, hideNames: prefs.hideNames }),
    [data, period, siteIds, paramIds, prefs],
  );
  const text = withRequest(pack.text, request);
  const nf = (n: number) => n.toLocaleString('en-NZ');

  const setPrefs = (p: Prefs) => {
    setPrefsState(p);
    savePrefs(p);
  };
  const applyPrompt = (p: (typeof AI_PROMPTS)[number]) => {
    const cur = request.trim();
    setRequest(!cur || AI_PROMPTS.some((x) => x.text === cur) ? p.text : `${cur}\n\n${p.text}`);
    if (p.allData && period.key !== 'all') setPeriod(defaultPeriod(project.yearStartMonth, 'all'));
  };
  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2500);
      notifications.show({ color: 'teal', title: 'Copied', message: request.trim() ? 'Paste it into your AI tool (Ctrl+V) and send.' : 'Paste it into your AI tool (Ctrl+V), then ask your question.' });
    } else {
      notifications.show({ color: 'red', title: "Couldn't copy", message: 'The browser blocked the clipboard. Use Download .txt and attach the file instead.' });
    }
  };
  const download = () => {
    const range = period.key === 'all' ? 'all data' : `${period.start} to ${period.end}`;
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), prefs.hideNames ? `AI input - ${range}.txt` : `${project.name} - AI input - ${range}.txt`);
  };

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Packages this project's data as text for an AI chat tool. Paste it in with your question, or add your question below so it's copied too.
      </Text>
      <Grid columns={24} gutter="sm">
        <Grid.Col span={{ base: 24, sm: 10 }}>
          <PeriodPicker value={period} onChange={setPeriod} yearStartMonth={project.yearStartMonth} extra={presets} width="100%" />
        </Grid.Col>
        <Grid.Col span={{ base: 24, sm: 7 }}>
          <SitePicker sites={sites} value={siteIds} onChange={setSiteIds} w="100%" />
        </Grid.Col>
        <Grid.Col span={{ base: 24, sm: 7 }}>
          <ParamPicker params={params} value={paramIds} onChange={setParamIds} onlyIds={withData} w="100%" />
        </Grid.Col>
      </Grid>

      <div>
        <Text size="sm" fw={500} mb={6}>
          Include
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" verticalSpacing={8}>
          {SECTION_ORDER.map((k) => (
            <Checkbox key={k} label={AI_SECTION_LABELS[k]} checked={prefs.sections[k]} onChange={(e) => setPrefs({ ...prefs, sections: { ...prefs.sections, [k]: e.currentTarget.checked } })} />
          ))}
        </SimpleGrid>
        <Checkbox
          mt="sm"
          label="Leave out names"
          description="Project, client, consent, regulator and site names, locations and notes are left out or replaced with codes."
          checked={prefs.hideNames}
          onChange={(e) => setPrefs({ ...prefs, hideNames: e.currentTarget.checked })}
        />
      </div>

      <div>
        <Text size="sm" fw={500}>
          Your question or request (optional)
        </Text>
        <Text size="xs" c="dimmed" mb={6}>
          Added at the end of the text. Start from one of these or write your own.
        </Text>
        <Group gap={6} mb={8}>
          {AI_PROMPTS.map((p) => {
            const btn = (
              <Button key={p.label} size="compact-sm" variant="light" radius="xl" onClick={() => applyPrompt(p)}>
                {p.label}
              </Button>
            );
            return p.allData ? (
              <Tooltip key={p.label} label="Also sets the period to all data">
                {btn}
              </Tooltip>
            ) : (
              btn
            );
          })}
        </Group>
        <Textarea
          aria-label="Your question or request"
          autosize
          minRows={2}
          maxRows={6}
          value={request}
          onChange={(e) => setRequest(e.currentTarget.value)}
          placeholder="e.g. Which results breached the consent limits, and what follow-up does the consent require?"
        />
      </div>

      <Accordion variant="contained" chevronPosition="left">
        <Accordion.Item value="preview">
          <Accordion.Control>Preview what will be copied</Accordion.Control>
          <Accordion.Panel>
            <ScrollArea.Autosize mah={320} type="auto">
              <pre className="ai-preview">{text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}\n…` : text}</pre>
            </ScrollArea.Autosize>
            {text.length > PREVIEW_CHARS && (
              <Text size="xs" c="dimmed" mt={6}>
                Showing the first {nf(PREVIEW_CHARS)} characters. Everything is copied.
              </Text>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      {text.length > LARGE_CHARS && (
        <Alert color="yellow" variant="light" icon={<IconInfoCircle size={18} />} py="xs">
          <Text size="sm">This is a lot of text. If your AI tool won't take it all, narrow the period, sites or parameters, or download the file and attach it instead.</Text>
        </Alert>
      )}
      {prefs.sections.results && pack.samples === 0 && (
        <Text size="sm" c="orange">
          There are no results in this period. Choose another period to include data.
        </Text>
      )}

      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Text size="xs" c="dimmed">
          {nf(pack.samples)} samples · {nf(pack.results)} results · {nf(text.length)} characters (about {nf(approxTokens(text))} tokens)
        </Text>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={download}>
            Download .txt
          </Button>
          <Button color={copied ? 'teal' : undefined} leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />} onClick={copy}>
            {copied ? 'Copied' : 'Copy to clipboard'}
          </Button>
        </Group>
      </Group>
      <Text size="xs" c="dimmed">
        EnviroDB doesn't send this anywhere: you choose where to paste it. Only use AI tools your organisation has approved for client data.
      </Text>
    </Stack>
  );
}
