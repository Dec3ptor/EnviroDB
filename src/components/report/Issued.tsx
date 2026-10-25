// Issuing a report and its revisions: lock it as issued, see what has changed since, revise it, and check a file
// against the fingerprints of the files issued.

import { useEffect, useMemo, useState } from 'react';
import { Alert, Anchor, Autocomplete, Badge, Button, Checkbox, FileButton, Group, Loader, Modal, ScrollArea, SegmentedControl, Stack, Text, TextInput, Textarea, Tooltip, Popover } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconFileTypeDocx, IconFileTypePdf, IconFingerprint, IconGitCompare, IconHistory, IconLock, IconLockOpen, IconTrash, IconCircleCheck, IconInfoCircle } from '@tabler/icons-react';
import type { FigureImage, IssuedReport, Project, ReportObligation, ReportTemplate, Settings } from '../../db/types';
import type { ProjectBundle } from '../../lib/analysis';
import { AREA_TEXT, diffSnapshots, MissingParts, nextRevision, sha256, sizeText, snapshotContent, type ChangeArea, type IssueDiff, type SnapshotContent } from '../../lib/issued';
import { cancelRevision, deleteIssue, findIssuedFile, issuedBuildOptions, issueReport, loadIssued, startRevision } from '../../db/issues';
import { fullReport, reportFile, type ExportKind } from '../../reports/export';
import { downloadBlob } from '../../db/backup';
import { formatDate, todayStr } from '../../lib/dates';
import { checksSummary, type ReportCheck } from '../../reports/checks';
import { Link } from 'react-router-dom';

/** What the report would be built from now – to issue, or to compare with what was issued. */
export interface ReportNow {
  bundle: ProjectBundle;
  template: ReportTemplate;
  period: { start: string; end: string; label: string };
  settings: Settings;
  promptTexts: Record<string, string>;
  figures: Record<string, FigureImage[]>;
  siteIds?: string[];
}

const when = (iso: string) => formatDate(iso.slice(0, 10));

/** What an issued report was built from, once unpacked. */
export function useIssuedContent(issue: IssuedReport | undefined): { content?: SnapshotContent; error?: string } {
  const [state, setState] = useState<{ id?: string; content?: SnapshotContent; error?: string }>({});
  useEffect(() => {
    if (!issue) return;
    let live = true;
    loadIssued(issue).then(
      (content) => live && setState({ id: issue.id, content }),
      (e: Error) => live && setState({ id: issue.id, error: e instanceof MissingParts ? e.message : `What it was built from could not be read: ${e.message}` }),
    );
    return () => {
      live = false;
    };
  }, [issue?.id, issue?.snapshot.head]);
  return issue && state.id === issue.id ? state : {};
}

/** Download an issued report, rebuilt from what it was built from. */
async function downloadIssued(issue: IssuedReport, kind: ExportKind) {
  const file = await reportFile(kind, fullReport(issuedBuildOptions(await loadIssued(issue), issue)));
  downloadBlob(file.blob, file.name);
}

function IssuedDownloads({ issue, size = 'xs' }: { issue: IssuedReport; size?: 'xs' | 'sm' }) {
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const go = async (kind: ExportKind) => {
    setBusy(kind);
    try {
      await downloadIssued(issue, kind);
    } catch (e) {
      notifications.show({ color: 'red', title: 'Could not rebuild it', message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Group gap={6} wrap="nowrap">
      <Button size={size} leftSection={<IconFileTypeDocx size={15} />} loading={busy === 'docx'} onClick={() => void go('docx')}>
        Word
      </Button>
      <Button size={size} variant="light" leftSection={<IconFileTypePdf size={15} />} loading={busy === 'pdf'} onClick={() => void go('pdf')}>
        PDF
      </Button>
    </Group>
  );
}

// ------------------------------------------------------------ issuing

/** What's missing or not quite ready, as a list – before issuing. */
export function ChecksList({ checks, projectId }: { checks: ReportCheck[]; projectId: string }) {
  if (!checks.length)
    return (
      <Group gap={6}>
        <IconCircleCheck size={16} color="var(--mantine-color-teal-6)" />
        <Text size="sm">Nothing missing: every site has results, the commentary is written, references resolve.</Text>
      </Group>
    );
  const where: Record<NonNullable<ReportCheck['where']>, string> = { data: 'Data', compliance: 'Compliance', reports: 'Reports', setup: 'Setup', schedule: 'Sampling & reporting' };
  return (
    <Stack gap={4}>
      {checks.map((c, i) => (
        <Group key={i} gap={8} wrap="nowrap" align="flex-start">
          {c.level === 'warn' ? <IconAlertTriangle size={15} color="var(--mantine-color-orange-6)" style={{ flexShrink: 0, marginTop: 3 }} /> : <IconInfoCircle size={15} color="var(--mantine-color-blue-6)" style={{ flexShrink: 0, marginTop: 3 }} />}
          <Text size="sm">
            {c.text}
            {c.where && c.where !== 'reports' && (
              <>
                {' '}
                <Anchor component={Link} to={`/projects/${projectId}/${c.where}`} size="sm">
                  {where[c.where]}
                </Anchor>
              </>
            )}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

/** The checks as a line under the Issue button: a count, and the list on click. */
export function ChecksLine({ checks, projectId }: { checks: ReportCheck[]; projectId: string }) {
  const warns = checks.filter((c) => c.level === 'warn').length;
  return (
    <Popover width={420} position="bottom-start" withArrow shadow="md">
      <Popover.Target>
        <Button size="compact-xs" variant="subtle" color={warns ? 'orange' : checks.length ? 'blue' : 'teal'} leftSection={warns ? <IconAlertTriangle size={13} /> : checks.length ? <IconInfoCircle size={13} /> : <IconCircleCheck size={13} />}>
          {checksSummary(checks)}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Text size="xs" fw={600} mb={6}>
          Before issuing
        </Text>
        <ChecksList checks={checks} projectId={projectId} />
      </Popover.Dropdown>
    </Popover>
  );
}

export function IssueModal({
  opened,
  onClose,
  now,
  previous,
  project,
  obligation,
  submitted,
  checks = [],
}: {
  opened: boolean;
  onClose: () => void;
  now: ReportNow;
  /** The revision this one replaces (being revised). */
  previous?: IssuedReport;
  project: Project;
  obligation?: ReportObligation;
  submitted: boolean;
  /** What's missing or not quite ready (warnings, not stops). */
  checks?: ReportCheck[];
}) {
  const [revision, setRevision] = useState('');
  const [purpose, setPurpose] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [kinds, setKinds] = useState<ExportKind[]>(['pdf', 'docx']);
  const [mark, setMark] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!opened) return;
    setRevision(nextRevision(previous ? [previous.revision] : []));
    setPurpose(previous?.purpose ?? 'Final');
    setTo(previous?.to ?? (obligation ? project.regulator : project.client) ?? '');
    setReason(previous?.revising?.reason ?? '');
    setMark(!!obligation && !submitted);
  }, [opened]);

  const issue = async () => {
    setBusy(true);
    try {
      const today = todayStr();
      const doc = fullReport({ ...now, today, issue: { revision: revision.trim() } });
      const files: Array<{ kind: ExportKind; name: string; blob: Blob }> = [];
      for (const kind of kinds) files.push({ kind, ...(await reportFile(kind, doc)) });
      const content = snapshotContent({ ...now, issuedOn: today });
      const rec = await issueReport({
        content,
        templateId: now.template.id,
        report: now.template.name,
        obligationId: obligation?.id,
        revision,
        purpose,
        to,
        reason,
        files: await Promise.all(files.map(async (f) => ({ name: f.name, kind: f.kind, sha256: await sha256(f.blob), bytes: f.blob.size }))),
        previous,
        markSubmitted: mark && !!obligation,
      });
      for (const f of files) downloadBlob(f.blob, f.name);
      notifications.show({
        color: 'teal',
        icon: <IconLock size={16} />,
        title: `${rec.revision} issued and locked`,
        message: `What it was built from is kept (${sizeText(rec.snapshot.added)} more, ${sizeText(rec.snapshot.bytes)} with what’s shared with other reports).`,
      });
      onClose();
    } catch (e) {
      notifications.show({ color: 'red', title: 'Not issued', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const needsReason = !!previous && !reason.trim();
  return (
    <Modal opened={opened} onClose={() => !busy && onClose()} title={previous ? `Issue a revision of ${previous.revision}` : 'Issue this report'} size="lg">
      <Stack gap="sm">
        {checks.length > 0 && (
          <Alert color={checks.some((c) => c.level === 'warn') ? 'orange' : 'blue'} variant="light" p="sm" title="Before you issue">
            <ChecksList checks={checks} projectId={project.id} />
          </Alert>
        )}
        <Text size="sm">
          The files are downloaded to send, and the report is locked as issued. EnviroDB keeps what it was built from – the results, limits, layout and commentary – compressed, with a fingerprint of each file, so it can be rebuilt as
          issued and any later change shown.
        </Text>
        <Group grow align="flex-start">
          <TextInput label="Revision" value={revision} onChange={(e) => setRevision(e.currentTarget.value)} description="On the title page and in the file name" />
          <Autocomplete label="Issued as" value={purpose} onChange={setPurpose} data={['Final', 'Draft for client review', 'For information']} description="Final, a draft for review …" />
        </Group>
        <TextInput label="Issued to" value={to} onChange={(e) => setTo(e.currentTarget.value)} placeholder="e.g. Waikato Regional Council" />
        {(previous || reason) && (
          <Textarea
            label="Why it is being revised"
            required={!!previous}
            autosize
            minRows={2}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            placeholder="e.g. The lab re-issued the September nitrate results"
          />
        )}
        <Group gap="lg">
          <Checkbox label="Word (.docx)" checked={kinds.includes('docx')} onChange={(e) => setKinds((k) => (e.currentTarget.checked ? [...k, 'docx'] : k.filter((x) => x !== 'docx')))} />
          <Checkbox label="PDF" checked={kinds.includes('pdf')} onChange={(e) => setKinds((k) => (e.currentTarget.checked ? [...k, 'pdf'] : k.filter((x) => x !== 'pdf')))} />
        </Group>
        {obligation && !submitted && <Checkbox label={`Mark “${obligation.name}” submitted today`} checked={mark} onChange={(e) => setMark(e.currentTarget.checked)} />}
        <Text size="xs" c="dimmed">
          Send the files as downloaded: a file changed afterwards (even re-saved) no longer matches its fingerprint. A Word file you edit before sending is your own version – issue the report again if its content changes.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button leftSection={<IconLock size={16} />} loading={busy} disabled={!kinds.length || !revision.trim() || needsReason} onClick={() => void issue()}>
            Issue {revision.trim() || 'it'} and download
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ReviseModal({ issue, onClose }: { issue: IssuedReport | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [issue?.id]);
  return (
    <Modal opened={!!issue} onClose={onClose} title={issue ? `Revise ${issue.revision}` : ''}>
      {issue && (
        <Stack gap="sm">
          <Text size="sm">
            {issue.revision} stays as it was issued. The report is unlocked to change it, then issued as {nextRevision([issue.revision])}.
          </Text>
          <Textarea label="Why" autosize minRows={2} data-autofocus value={reason} onChange={(e) => setReason(e.currentTarget.value)} placeholder="e.g. The lab re-issued the September nitrate results" />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              leftSection={<IconLockOpen size={16} />}
              disabled={!reason.trim()}
              onClick={() => {
                void startRevision(issue, reason);
                onClose();
              }}
            >
              Unlock to revise
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------ what has changed

const AREA_ORDER: ChangeArea[] = ['results', 'samples', 'sites', 'rules', 'guidelines', 'project', 'qa', 'register', 'notes', 'layout', 'commentary', 'figures', 'other'];

function ChangesList({ diff }: { diff: IssueDiff }) {
  const [all, setAll] = useState<Set<ChangeArea>>(new Set());
  if (!diff.changes.length) return <Text size="sm">Nothing has changed.</Text>;
  return (
    <Stack gap="sm">
      {AREA_ORDER.map((area) => {
        const list = diff.changes.filter((c) => c.area === area);
        if (!list.length) return null;
        const shown = all.has(area) ? list : list.slice(0, 40);
        return (
          <div key={area}>
            <Text size="sm" fw={600}>
              {AREA_TEXT[area]} <Text span size="xs" c="dimmed">({list.length})</Text>
            </Text>
            {shown.map((c, i) => (
              <Text size="xs" key={i} c={c.inPeriod === false ? 'dimmed' : undefined}>
                {c.text}
                {c.inPeriod && (area === 'results' || area === 'samples') ? <Badge size="xs" variant="light" color="orange" ml={6}>in the period</Badge> : null}
              </Text>
            ))}
            {list.length > shown.length && (
              <Anchor component="button" type="button" size="xs" onClick={() => setAll((s) => new Set([...s, area]))}>
                and {list.length - shown.length} more
              </Anchor>
            )}
          </div>
        );
      })}
    </Stack>
  );
}

const usePhone = () => !!useMediaQuery('(max-width: 36em)');

function ChangesModal({ title, diff, onClose }: { title: string; diff: IssueDiff | null; onClose: () => void }) {
  const phone = usePhone();
  return (
    <Modal opened={!!diff} onClose={onClose} title={title} size="lg" fullScreen={phone} scrollAreaComponent={ScrollArea.Autosize}>
      {diff && (
        <Stack gap="sm">
          <Text size="sm" fw={500}>
            {diff.summary}
          </Text>
          <ChangesList diff={diff} />
        </Stack>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------ history and checking a file

function revisionLine(i: IssuedReport) {
  return [when(i.at), i.by && `by ${i.by}`, i.to && `to ${i.to}`].filter(Boolean).join(' ');
}

function HistoryModal({ opened, onClose, revisions, all, now, onOpen }: { opened: boolean; onClose: () => void; revisions: IssuedReport[]; all: IssuedReport[]; now: ReportNow; onOpen: (i: IssuedReport) => void }) {
  const [compare, setCompare] = useState<{ title: string; diff: IssueDiff } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const showChanges = async (i: number) => {
    const a = revisions[i];
    const b = revisions[i + 1];
    setBusy(a.id);
    try {
      const before = await loadIssued(a);
      const after = b ? await loadIssued(b) : snapshotContent({ ...now, issuedOn: todayStr() });
      setCompare({ title: b ? `${a.revision} → ${b.revision}` : `Since ${a.revision} was issued`, diff: diffSnapshots(before, after) });
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const phone = usePhone();
  const others = all.filter((x) => !revisions.includes(x)).sort((a, b) => (a.at < b.at ? 1 : -1));
  const stored = revisions.reduce((n, r) => n + r.snapshot.added, 0);
  return (
    <>
      <Modal opened={opened && !compare} onClose={onClose} title="Issued" size="xl" fullScreen={phone} scrollAreaComponent={ScrollArea.Autosize}>
        <Stack gap="md">
          {revisions.length > 0 && (
            <div>
              <Text fw={600} size="sm" mb={4}>
                This report
              </Text>
              <Stack gap={0}>
                {[...revisions].reverse().map((r) => {
                  const i = revisions.indexOf(r);
                  return (
                    <Group key={r.id} justify="space-between" align="flex-start" gap="xs" py={8} style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
                      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                        <Text size="sm">
                          <b>{r.revision}</b>
                          {r.purpose && <Text span size="xs" c="dimmed">{` · ${r.purpose}`}</Text>}
                        </Text>
                        <Text size="xs">{revisionLine(r)}</Text>
                        {r.reason && <Text size="xs" c="dimmed">Why: {r.reason}</Text>}
                        {r.files.map((f) => (
                          <Tooltip key={f.sha256} label={`SHA-256 ${f.sha256}`} multiline maw={360}>
                            <Text size="xs" c="dimmed" style={{ wordBreak: 'break-word' }}>
                              <IconFingerprint size={11} /> {f.kind === 'pdf' ? 'PDF' : 'Word'} · {f.sha256.slice(0, 12)}…
                            </Text>
                          </Tooltip>
                        ))}
                        <Text size="xs" c="dimmed">
                          EnviroDB {r.appVersion} · kept: {sizeText(r.snapshot.added)}
                        </Text>
                      </div>
                      <Stack gap={4} align="flex-end">
                        <IssuedDownloads issue={r} />
                        <Button size="compact-xs" variant="subtle" leftSection={<IconGitCompare size={13} />} loading={busy === r.id} onClick={() => void showChanges(i)}>
                          {revisions[i + 1] ? `Changes in ${revisions[i + 1].revision}` : 'Changes since'}
                        </Button>
                        {i === revisions.length - 1 && <DeleteIssue issue={r} onDone={onClose} />}
                      </Stack>
                    </Group>
                  );
                })}
              </Stack>
              <Text size="xs" c="dimmed">
                Downloads are rebuilt from what each revision was built from. The files sent are the ones with the fingerprints – check one with “Check a file”. Kept for this report: {sizeText(stored)}.
              </Text>
            </div>
          )}
          <div>
            <Text fw={600} size="sm" mb={4}>
              {revisions.length ? 'The project’s other issued reports' : 'The project’s issued reports'}
            </Text>
            {others.length ? (
              <Stack gap={4}>
                {others.map((r) => (
                  <Group key={r.id} justify="space-between" wrap="nowrap" gap="xs">
                    <Anchor component="button" type="button" size="sm" ta="left" onClick={() => onOpen(r)}>
                      {r.report} – {r.period.label} · {r.revision}
                    </Anchor>
                    <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                      {when(r.at)}
                    </Text>
                  </Group>
                ))}
              </Stack>
            ) : (
              <Text size="xs" c="dimmed">
                None yet.
              </Text>
            )}
          </div>
        </Stack>
      </Modal>
      <ChangesModal title={compare?.title ?? ''} diff={compare?.diff ?? null} onClose={() => setCompare(null)} />
    </>
  );
}

function DeleteIssue({ issue, onDone }: { issue: IssuedReport; onDone: () => void }) {
  const [sure, setSure] = useState(false);
  if (!sure)
    return (
      <Button size="compact-xs" variant="subtle" color="red" leftSection={<IconTrash size={13} />} onClick={() => setSure(true)}>
        Issued by mistake
      </Button>
    );
  return (
    <Group gap={4} wrap="nowrap">
      <Text size="xs">Take back {issue.revision}?</Text>
      <Button
        size="compact-xs"
        color="red"
        onClick={() => {
          void deleteIssue(issue);
          onDone();
        }}
      >
        Take back
      </Button>
      <Button size="compact-xs" variant="default" onClick={() => setSure(false)}>
        No
      </Button>
    </Group>
  );
}

/** Check a file against the fingerprints of every file issued. */
export function CheckFile() {
  const [result, setResult] = useState<{ name: string; found: Awaited<ReturnType<typeof findIssuedFile>> } | null>(null);
  const check = async (file: File | null) => {
    if (!file) return;
    setResult({ name: file.name, found: await findIssuedFile(await sha256(file)) });
  };
  return (
    <>
      <FileButton accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(f) => void check(f)}>
        {(props) => (
          <Button {...props} size="compact-xs" variant="subtle" leftSection={<IconFingerprint size={13} />}>
            Check a file
          </Button>
        )}
      </FileButton>
      <Modal opened={!!result} onClose={() => setResult(null)} title="Check a file">
        {result &&
          (result.found ? (
            <Alert color="teal" icon={<IconCheck size={18} />} title="This is the file issued">
              <Text size="sm">
                “{result.name}” is {result.found.issue.report} – {result.found.issue.period.label}, {result.found.issue.revision}, issued {revisionLine(result.found.issue)}. It hasn’t been changed since.
              </Text>
            </Alert>
          ) : (
            <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="Not a file as issued">
              <Text size="sm">
                “{result.name}” doesn’t match any file issued from EnviroDB. It may have been changed or re-saved after it was downloaded, downloaded again later, or not issued here.
              </Text>
            </Alert>
          ))}
      </Modal>
    </>
  );
}

// ------------------------------------------------------------ the Reports tab's panel

/** The report's issue: locked with what has changed since, or being revised, or not yet issued. */
export function IssuedPanel({
  revisions,
  all,
  issued,
  now,
  showCurrent,
  onShowCurrent,
  onIssue,
  onOpen,
  checks,
}: {
  revisions: IssuedReport[];
  all: IssuedReport[];
  issued: { content?: SnapshotContent; error?: string };
  /** What's missing before issuing. */
  checks?: ReportCheck[];
  now: ReportNow;
  showCurrent: boolean;
  onShowCurrent: (v: boolean) => void;
  onIssue: () => void;
  onOpen: (i: IssuedReport) => void;
}) {
  const latest = revisions[revisions.length - 1];
  const [history, setHistory] = useState(false);
  const [revise, setRevise] = useState<IssuedReport | null>(null);
  const [details, setDetails] = useState(false);
  // what has changed since: worked out a moment after the report settles
  const [diff, setDiff] = useState<IssueDiff | null>(null);
  const locked = !!latest && !latest.revising;
  useEffect(() => {
    setDiff(null);
    if (!locked || !issued.content) return;
    const h = setTimeout(() => setDiff(diffSnapshots(issued.content!, snapshotContent({ ...now, issuedOn: todayStr() }))), 300);
    return () => clearTimeout(h);
  }, [locked, issued.content, now]);
  const historyModal = <HistoryModal opened={history} onClose={() => setHistory(false)} revisions={revisions} all={all} now={now} onOpen={(i) => (setHistory(false), onOpen(i))} />;
  const tools = (
    <Group gap={2}>
      <Button size="compact-xs" variant="subtle" leftSection={<IconHistory size={13} />} onClick={() => setHistory(true)}>
        Issued{all.length ? ` (${all.length})` : ''}
      </Button>
      <CheckFile />
    </Group>
  );

  if (!latest)
    return (
      <Stack gap={4}>
        <Group justify="space-between" gap={4}>
          <Group gap={4} wrap="nowrap">
            <Tooltip label="Download the files to send and lock the report as issued (Rev 0), keeping what it was built from" multiline maw={280}>
              <Button size="xs" variant="default" leftSection={<IconLock size={14} />} onClick={onIssue}>
                Issue…
              </Button>
            </Tooltip>
            {checks && <ChecksLine checks={checks} projectId={now.bundle.project.id} />}
          </Group>
          {tools}
        </Group>
        {historyModal}
      </Stack>
    );

  if (latest.revising)
    return (
      <Stack gap={6}>
        <Alert color="blue" variant="light" p="xs" icon={<IconLockOpen size={16} />}>
          <Text size="xs">
            Revising {latest.revision}
            {latest.revising.reason ? ` – ${latest.revising.reason}` : ''}. Downloads are drafts until it is issued as {nextRevision([latest.revision])}.
          </Text>
          <Group gap={6} mt={6}>
            <Button size="compact-xs" leftSection={<IconLock size={13} />} onClick={onIssue}>
              Issue {nextRevision([latest.revision])}…
            </Button>
            <Button size="compact-xs" variant="subtle" onClick={() => void cancelRevision(latest)}>
              Lock again unchanged
            </Button>
          </Group>
        </Alert>
        {tools}
        {historyModal}
      </Stack>
    );

  return (
    <Stack gap={6}>
      <Alert color="teal" variant="light" p="xs" icon={<IconLock size={16} />} title={`Issued – ${latest.revision}${latest.purpose ? ` (${latest.purpose})` : ''}`}>
        <Text size="xs">{revisionLine(latest)}.</Text>
        {latest.reason && <Text size="xs" c="dimmed">Why: {latest.reason}</Text>}
        <Text size="xs" mt={4}>
          Locked as issued. Download it as issued:
        </Text>
        <div style={{ marginTop: 4 }}>
          <IssuedDownloads issue={latest} size="xs" />
        </div>
      </Alert>
      {issued.error ? (
        <Alert color="orange" variant="light" p="xs">
          <Text size="xs">{issued.error}</Text>
        </Alert>
      ) : !diff ? (
        <Group gap={6}>
          <Loader size="xs" />
          <Text size="xs" c="dimmed">
            Checking for changes since…
          </Text>
        </Group>
      ) : (
        <Alert color={diff.dataInPeriod ? 'orange' : diff.changes.length ? 'blue' : 'gray'} variant="light" p="xs" icon={diff.changes.length ? <IconAlertTriangle size={16} /> : <IconCheck size={16} />}>
          <Text size="xs">
            {diff.changes.length ? `Since it was issued: ${diff.summary[0].toLowerCase()}${diff.summary.slice(1)}` : 'Nothing has changed since it was issued.'}
          </Text>
          {diff.changes.length > 0 && (
            <Group gap={6} mt={4}>
              <Anchor component="button" type="button" size="xs" onClick={() => setDetails(true)}>
                What changed
              </Anchor>
              {diff.dataInPeriod && (
                <Text size="xs" c="dimmed">
                  – a revision may be needed.
                </Text>
              )}
            </Group>
          )}
        </Alert>
      )}
      <SegmentedControl
        size="xs"
        fullWidth
        value={showCurrent ? 'now' : 'issued'}
        onChange={(v) => onShowCurrent(v === 'now')}
        data={[
          { value: 'issued', label: `Preview ${latest.revision} as issued` },
          { value: 'now', label: 'With today’s data' },
        ]}
      />
      <Group justify="space-between" gap={4}>
        <Button size="xs" variant="default" leftSection={<IconLockOpen size={14} />} onClick={() => setRevise(latest)}>
          Revise…
        </Button>
        {tools}
      </Group>
      <ReviseModal issue={revise} onClose={() => setRevise(null)} />
      <ChangesModal title={`Since ${latest.revision} was issued`} diff={details ? diff : null} onClose={() => setDetails(false)} />
      {historyModal}
    </Stack>
  );
}

/** The latest revision of each report issued for the project. */
export function useLatestIssues(all: IssuedReport[] | undefined) {
  return useMemo(() => {
    const m = new Map<string, IssuedReport>();
    for (const i of all ?? []) {
      const k = `${i.templateId}|${i.period.start}|${i.period.end}`;
      const cur = m.get(k);
      if (!cur || cur.at < i.at) m.set(k, i);
    }
    return [...m.values()];
  }, [all]);
}
