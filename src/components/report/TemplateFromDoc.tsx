import { useState } from 'react';
import { Alert, Anchor, Badge, Button, Checkbox, Group, Modal, ScrollArea, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { IconFileText } from '@tabler/icons-react';
import type { ReportKind, ReportTemplate } from '../../db/types';
import { saveTemplate } from '../../db/repo';
import { DOC_SECTION_TYPES, planFromOutline, readDocOutline, templateFromPlan, type DocPlan } from '../../reports/docTemplate';
import { REPORT_KINDS } from '../../data/templates';
import { BLOCK_LABELS, newBlock } from './blocks';

// A report template from a document of yours: its headings and text, with EnviroDB's sections from the data
// (results, compliance, the monitoring programme …) under the headings that call for them – check and change them.

const ACCEPT = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template': ['.dotx'],
  'application/vnd.ms-word.document.macroEnabled.12': ['.docm'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt', '.md'],
  'text/markdown': ['.md'],
};

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function TemplateFromDocModal({ onClose, onMade }: { onClose: () => void; onMade: (t: ReportTemplate) => void }) {
  const [file, setFile] = useState('');
  const [plan, setPlan] = useState<DocPlan | null>(null);
  const [name, setName] = useState('');
  const [keepText, setKeepText] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async (f: File) => {
    setBusy(true);
    setError('');
    try {
      const p = planFromOutline(await readDocOutline(f));
      if (!p.sections.length && !p.intro) throw new Error('No headings or text could be read from it. For a PDF, it may be a scanned image rather than text.');
      setPlan(p);
      setFile(f.name);
      setName(p.title?.slice(0, 80) || f.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const setSection = (i: number, v: string | null) => plan && setPlan({ ...plan, sections: plan.sections.map((s, k) => (k === i ? { ...s, section: (v || null) as DocPlan['sections'][number]['section'] } : s)) });
  const fromData = plan?.sections.filter((s) => s.section).length ?? 0;

  return (
    <Modal opened onClose={onClose} title="A template from a document" size={plan ? 'xl' : 'lg'}>
      <Stack gap="sm">
        {!plan ? (
          <>
            <Text size="sm" c="dimmed">
              A report, plan or letter you’ve written before – a Word document, a PDF or a text outline. Its headings become the template’s, its text the starting text for each report, and the tables, graphs and summaries EnviroDB makes from the data go under the headings that call for them.
            </Text>
            <Dropzone onDrop={(files) => files[0] && void load(files[0])} accept={ACCEPT} loading={busy} multiple={false} maxSize={50 * 1024 * 1024}>
              <Group justify="center" gap="md" mih={110} style={{ pointerEvents: 'none' }}>
                <IconFileText size={40} stroke={1.4} color="var(--mantine-primary-color-6)" />
                <div>
                  <Text fw={600}>Drop the document here</Text>
                  <Text size="sm" c="dimmed">
                    or click to choose it – Word (.docx), PDF or text
                  </Text>
                </div>
              </Group>
            </Dropzone>
          </>
        ) : (
          <>
            <Text size="sm">
              <b>{plan.sections.length}</b> heading{plan.sections.length === 1 ? '' : 's'} in {file}
              {plan.letter ? ' – a letter' : ''} · {fromData} with a section from the data
              {plan.tables ? ` · ${plan.tables} table${plan.tables === 1 ? '' : 's'} in it left out (EnviroDB makes its tables from the data)` : ''}.{' '}
              <Anchor component="button" size="sm" onClick={() => setPlan(null)}>
                Choose another
              </Anchor>
            </Text>
            <Group grow align="flex-end">
              <TextInput label="Template name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
              <Select label="What it’s for" data={REPORT_KINDS.map((k) => ({ value: k.kind, label: k.label.replace(/s$/, '') }))} value={plan.kind} onChange={(v) => v && setPlan({ ...plan, kind: v as ReportKind })} allowDeselect={false} />
            </Group>
            <Checkbox label="Keep the document’s text as the starting text for each report" description="Otherwise each heading gets a line to write over" checked={keepText} onChange={(e) => setKeepText(e.currentTarget.checked)} />
            <ScrollArea.Autosize mah="48vh" type="auto">
              <Table stickyHeader withTableBorder fz="sm" verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Heading</Table.Th>
                    <Table.Th w={110}>Its text</Table.Th>
                    <Table.Th w={260}>From the data, under it</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {plan.intro && (
                    <Table.Tr>
                      <Table.Td c="dimmed">(before the first heading)</Table.Td>
                      <Table.Td>{words(plan.intro)} words</Table.Td>
                      <Table.Td />
                    </Table.Tr>
                  )}
                  {plan.sections.map((s, i) => (
                    <Table.Tr key={i}>
                      <Table.Td style={{ paddingLeft: 8 + (s.level - 1) * 18 }}>
                        <Text size="sm" fw={s.level === 1 ? 600 : 400}>
                          {s.heading}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {words(s.text) ? `${words(s.text)} words` : '–'}
                          {s.tables ? ` · ${s.tables} table${s.tables === 1 ? '' : 's'}` : ''}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Select
                          size="xs"
                          placeholder="Text only"
                          data={DOC_SECTION_TYPES.map((t) => ({ value: t, label: BLOCK_LABELS[t].label }))}
                          value={s.section}
                          onChange={(v) => setSection(i, v)}
                          clearable
                          comboboxProps={{ withinPortal: true }}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
            {plan.letter && (
              <Badge variant="light" color="grape" w="fit-content">
                Written as a letter on your letterhead: the greeting and closing come from the letter opening and sign-off
              </Badge>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button
                loading={busy}
                disabled={!name.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const t = templateFromPlan(plan, { name: name.trim(), fileName: file, keepText, newBlock });
                    await saveTemplate(t);
                    onMade(t);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Make the template
              </Button>
            </Group>
          </>
        )}
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}
