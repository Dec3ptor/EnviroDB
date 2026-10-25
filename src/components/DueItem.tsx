// A reporting obligation's period as a thing to do: what it is, when it's due, where it's up to – with the file or link
// of the document when it's made outside EnviroDB (a management plan, say), working notes, Mark submitted, and the
// report in EnviroDB only when the obligation has a template.

import { useEffect, useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Card, Drawer, Group, Stack, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconCheck, IconExternalLink, IconFileReport, IconLink, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import type { ReportObligation } from '../db/types';
import { OBLIGATION_STATUS, obligationPeriod } from '../lib/schedule';
import { formatDate, relativeDays, todayStr } from '../lib/dates';
import { addAttachment, removeAttachment, setPeriodNote, setSubmitted } from '../db/repo';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';

export const OBLIGATION_KIND_TEXT: Record<NonNullable<ReportObligation['kind']>, string> = { report: 'Monitoring report', plan: 'Management plan', other: 'Other document' };

/** The due item's address: the Schedule view, with the obligation and period to open. */
export const dueItemPath = (projectId: string, obligationId: string, periodIndex: number) => `/projects/${projectId}/schedule?obligation=${obligationId}&period=${periodIndex}`;

export function DueItemDrawer({ obligation, periodIndex, projectId, onClose, onEdit }: { obligation: ReportObligation; periodIndex: number; projectId: string; onClose: () => void; onEdit?: () => void }) {
  const today = todayStr();
  const p = obligationPeriod(obligation, periodIndex, today);
  const meta = OBLIGATION_STATUS[p.status];
  const template = useLiveQuery(async () => (obligation.templateId ? await db.templates.get(obligation.templateId) : undefined), [obligation.templateId]);
  const attachments = (obligation.attachments ?? []).filter((a) => a.periodEnd === p.periodEnd);
  const [note, setNote] = useState(obligation.periodNotes?.[p.periodEnd] ?? '');
  useEffect(() => setNote(obligation.periodNotes?.[p.periodEnd] ?? ''), [obligation.periodNotes, p.periodEnd]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const kind = obligation.kind ?? 'report';
  // a plan or other document is never made here, whatever template the obligation may once have had
  const madeHere = kind === 'report' && !!obligation.templateId;
  const add = async () => {
    const n = name.trim() || url.trim();
    if (!n) return;
    await addAttachment(obligation.id, { periodEnd: p.periodEnd, name: n, url: url.trim() || undefined });
    setName('');
    setUrl('');
    setAdding(false);
  };
  return (
    <Drawer opened onClose={onClose} position="right" size="md" title={<Text fw={600}>{obligation.name}</Text>} padding="md">
      <Stack gap="md">
        <Group gap="xs">
          <Badge color={meta.color}>{p.submission ? `Submitted ${formatDate(p.submission.submittedOn)}` : meta.label}</Badge>
          <Badge variant="outline">{OBLIGATION_KIND_TEXT[kind]}</Badge>
        </Group>
        <div>
          <Text size="sm">
            <b>For</b> {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
          </Text>
          <Text size="sm">
            <b>Due</b> {formatDate(p.dueDate)}
            {!p.submission && (
              <Text span size="sm" c={p.daysToDue < 0 ? 'red' : 'dimmed'}>
                {' '}
                · {relativeDays(p.daysToDue)}
              </Text>
            )}
          </Text>
          {obligation.recipient && (
            <Text size="sm">
              <b>To</b> {obligation.recipient}
            </Text>
          )}
          {obligation.notes && (
            <Text size="sm" c="dimmed" mt={4}>
              {obligation.notes}
            </Text>
          )}
        </div>

        <Card withBorder padding="sm">
          {madeHere ? (
            <Stack gap="xs">
              <Text size="sm">
                Made in EnviroDB with the template <b>{template?.name ?? '…'}</b>.
              </Text>
              <Button component={Link} to={`/projects/${projectId}/reports?obligation=${obligation.id}&period=${periodIndex}`} leftSection={<IconFileReport size={16} />} onClick={onClose}>
                Open the report
              </Button>
            </Stack>
          ) : (
            <Stack gap={4}>
              <Text size="sm">{kind === 'report' ? 'No report template chosen: this one is written outside EnviroDB.' : `A ${OBLIGATION_KIND_TEXT[kind].toLowerCase()}, produced outside EnviroDB.`}</Text>
              <Text size="xs" c="dimmed">
                Attach the file or a link to it below when it’s done, then mark it submitted.{onEdit ? (kind === 'report' ? ' To make it in EnviroDB, choose a template in Edit.' : ' To make it in EnviroDB, make it a monitoring report with a template, in Edit.') : ''}
              </Text>
            </Stack>
          )}
        </Card>

        <div>
          <Group justify="space-between" mb={4}>
            <Text size="sm" fw={600}>
              Files and links
            </Text>
            {!adding && (
              <Button size="compact-xs" variant="default" leftSection={<IconPlus size={12} />} onClick={() => setAdding(true)}>
                Add
              </Button>
            )}
          </Group>
          {attachments.length ? (
            <Stack gap={4}>
              {attachments.map((a) => (
                <Group key={`${a.name}|${a.url ?? ''}`} gap="xs" wrap="nowrap" justify="space-between">
                  <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                    <IconLink size={14} style={{ flexShrink: 0 }} />
                    {a.url ? (
                      <Anchor href={a.url} target="_blank" rel="noreferrer" size="sm" lineClamp={1}>
                        {a.name} <IconExternalLink size={12} style={{ verticalAlign: -1 }} />
                      </Anchor>
                    ) : (
                      <Text size="sm" lineClamp={1}>
                        {a.name}
                      </Text>
                    )}
                    <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                      {formatDate(a.addedOn)}
                      {a.by ? ` · ${a.by}` : ''}
                    </Text>
                  </Group>
                  <Tooltip label="Remove">
                    <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove attachment" onClick={() => void removeAttachment(obligation.id, p.periodEnd, a.name)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              ))}
            </Stack>
          ) : (
            !adding && (
              <Text size="xs" c="dimmed">
                Nothing attached yet – a SharePoint or OneDrive link, or a file path to copy.
              </Text>
            )
          )}
          {adding && (
            <Stack gap="xs" mt="xs">
              <TextInput size="xs" label="Name" placeholder="e.g. Stormwater management plan v3" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
              <TextInput size="xs" label="Link or path" placeholder="https://… or G:\\Clients\\…" value={url} onChange={(e) => setUrl(e.currentTarget.value)} />
              <Group gap="xs" justify="flex-end">
                <Button size="xs" variant="default" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
                <Button size="xs" onClick={() => void add()} disabled={!name.trim() && !url.trim()}>
                  Attach
                </Button>
              </Group>
            </Stack>
          )}
        </div>

        <Textarea label="Notes for this one" description="What’s done, what’s waiting on whom" autosize minRows={2} value={note} onChange={(e) => setNote(e.currentTarget.value)} onBlur={() => note !== (obligation.periodNotes?.[p.periodEnd] ?? '') && void setPeriodNote(obligation.id, p.periodEnd, note)} />

        <Group justify="space-between">
          {onEdit ? (
            <Button variant="subtle" size="xs" onClick={onEdit}>
              Edit the obligation
            </Button>
          ) : (
            <span />
          )}
          {p.submission ? (
            <Button variant="default" leftSection={<IconX size={16} />} onClick={() => void setSubmitted(obligation.id, p, null)}>
              Undo submitted
            </Button>
          ) : (
            <Button leftSection={<IconCheck size={16} />} onClick={() => void setSubmitted(obligation.id, p, today)}>
              Mark submitted
            </Button>
          )}
        </Group>
      </Stack>
    </Drawer>
  );
}
