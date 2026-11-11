// The notice for an exceedance, ready for an email: written from the exceedances of the sampling day (tick which go
// in), yours to change before it's copied or opened in the email program – and recording them as notified.

import { useMemo, useState } from 'react';
import { Button, Checkbox, Group, Modal, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconCopy, IconFileText, IconMail, IconMailCheck } from '@tabler/icons-react';
import { db } from '../db/db';
import { saveNote } from '../db/repo';
import type { ExceedanceNote, Rule } from '../db/types';
import type { Exceedance } from '../lib/compliance';
import { useProject } from '../hooks/useProjectData';
import { useSettings } from '../hooks/useSettings';
import { copyText } from '../lib/clipboard';
import { formatDate, todayStr } from '../lib/dates';
import { exceedanceNotice, noticeMailto, type NoticeItem } from '../lib/notice';
import { unitLabel } from '../lib/units';
import { fmtNum } from '../lib/values';

export interface NoticeRow {
  rule: Rule;
  ex: Exceedance;
  note?: ExceedanceNote;
}

const keyOf = (r: NoticeRow) => `${r.rule.id}|${r.ex.key}`;

/** `rows`: the exceedances that could go in the notice (a sampling day's still open); all ticked to start with. */
export function ExceedanceNoticeModal({ rows, onClose }: { rows: NoticeRow[]; onClose: () => void }) {
  const { project, siteMap, paramMap, index } = useProject();
  const settings = useSettings();
  const navigate = useNavigate();
  const hasLetter = useLiveQuery(async () => !!(await db.templates.get('tpl-notification')), [], false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.map(keyOf)));
  const chosen = rows.filter((r) => picked.has(keyOf(r)));
  const draft = useMemo(() => {
    const items: NoticeItem[] = chosen.map((r) => ({ rule: r.rule, ex: r.ex, note: r.note }));
    const resultSample = (resultId: string) => {
      for (const [sampleId, list] of index.allBySample) if (list.some((x) => x.id === resultId)) return index.sampleById.get(sampleId);
      return undefined;
    };
    return exceedanceNotice(items, { project, site: (id) => siteMap.get(id), param: (id) => paramMap.get(id), sampleOf: resultSample, author: settings.author || undefined, company: settings.company || undefined });
  }, [chosen.map(keyOf).join(' '), project, settings.author, settings.company]);
  // the text as changed by hand – until the choice of exceedances changes it
  const [edited, setEdited] = useState<{ for: string; subject: string; body: string } | null>(null);
  const stamp = chosen.map(keyOf).join(' ');
  const subject = edited?.for === stamp ? edited.subject : draft.subject;
  const body = edited?.for === stamp ? edited.body : draft.body;
  const [to, setTo] = useState('');
  const day = rows[0]?.ex.date.slice(0, 10) ?? todayStr();
  const copy = async () => notifications.show((await copyText(`${subject}\n\n${body}`)) ? { color: 'teal', message: 'Copied – paste it into an email.' } : { color: 'red', message: 'It couldn’t be copied – select the text and copy it.' });
  // the email program, with the notice in it – a long one is copied instead, to paste (the program wouldn't take it whole)
  const email = async () => {
    const m = noticeMailto({ subject, body }, to.trim());
    if (!m.fits) notifications.show((await copyText(body)) ? { color: 'teal', message: 'The message is too long to hand to the email program, so it’s been copied – paste it into the email that opens.', autoClose: 9000 } : { color: 'orange', message: 'The message is too long to hand to the email program – copy it from here and paste it in.' });
    window.location.href = m.href;
  };
  const record = async () => {
    for (const r of chosen) await saveNote({ projectId: project.id, ruleId: r.rule.id, key: r.ex.key, status: 'notified', text: r.note?.text ?? '', notifiedOn: todayStr() }, r.note);
    notifications.show({ color: 'teal', message: `${chosen.length} exceedance${chosen.length === 1 ? '' : 's'} recorded as notified today.` });
    onClose();
  };
  return (
    <Modal opened onClose={onClose} title="Notify the exceedance" size="xl">
      <Stack gap="sm">
        {rows.length > 1 && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              In this notice – the exceedances of {formatDate(day)} still open
            </Text>
            {rows.map((r) => (
              <Checkbox
                key={keyOf(r)}
                size="xs"
                checked={picked.has(keyOf(r))}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.currentTarget.checked) next.add(keyOf(r));
                  else next.delete(keyOf(r));
                  setPicked(next);
                }}
                label={`${siteMap.get(r.ex.siteId)?.code ?? ''} · ${paramMap.get(r.ex.parameterId)?.name ?? r.ex.parameterId} ${r.ex.value === null ? '' : `${r.ex.qualifier}${fmtNum(r.ex.value)}`} ${r.ex.unit === '%' ? '%' : unitLabel(r.ex.unit)} · ${r.rule.name}`}
              />
            ))}
          </Stack>
        )}
        <TextInput label="To" placeholder="The council’s email address (optional – or add it in the email)" value={to} onChange={(e) => setTo(e.currentTarget.value)} type="email" />
        <TextInput label="Subject" value={subject} onChange={(e) => setEdited({ for: stamp, subject: e.currentTarget.value, body })} />
        <Textarea label="Message" autosize minRows={10} maxRows={22} value={body} onChange={(e) => setEdited({ for: stamp, subject, body: e.currentTarget.value })} styles={{ input: { fontSize: 13 } }} />
        <Text size="xs" c="dimmed">
          Written from the exceedances, the rule’s condition and required action, and your follow-up notes. Change anything before it goes: EnviroDB sends nothing itself.
        </Text>
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap="xs">
            <Button leftSection={<IconCopy size={16} />} onClick={() => void copy()} disabled={!chosen.length}>
              Copy
            </Button>
            <Button variant="default" leftSection={<IconMail size={16} />} onClick={() => void email()} disabled={!chosen.length}>
              Open in email
            </Button>
            {hasLetter && (
              <Button variant="default" leftSection={<IconFileText size={16} />} onClick={() => navigate(`/projects/${project.id}/reports?template=tpl-notification&start=${day}&end=${day}`)} title="A letter on your letterhead, as Word or PDF, from the Exceedance notification template">
                As a letter…
              </Button>
            )}
          </Group>
          <Button variant="light" color="blue" leftSection={<IconMailCheck size={16} />} onClick={() => void record()} disabled={!chosen.length}>
            Record as notified today
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
