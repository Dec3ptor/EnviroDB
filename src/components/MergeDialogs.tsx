// Two of the same thing made one: a parameter merged into another, or a site into another of its project – what it
// would do said first, in a list to check before saying yes.

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Group, List, Modal, Select, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { mergeParameters, mergeSites, parameterMergeImpact, siteMergeImpact, type ParameterMergeImpact, type SiteMergeImpact } from '../db/merge';
import type { Parameter, Site } from '../db/types';
import { compareParams } from '../data/parameters';
import { likeParams } from '../lib/calculated';
import { formatDate } from '../lib/dates';
import { unitLabel } from '../lib/units';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const some = (xs: string[], max = 4) => `${xs.slice(0, max).join(', ')}${xs.length > max ? ` and ${xs.length - max} more` : ''}`;

/** What a parameter merge does, to check. */
function ParameterImpactList({ impact, from, into }: { impact: ParameterMergeImpact; from: Parameter; into: Parameter }) {
  const items: string[] = [];
  if (impact.results) items.push(`${plural(impact.results, 'result')} of ${from.name} ${impact.results === 1 ? 'becomes' : 'become'} ${into.name}${impact.projects.length ? ` – in ${some(impact.projects.map((p) => `${p.name} (${p.results})`), 3)}` : ''}`);
  if (impact.same) items.push(`${plural(impact.same, 'sample')} ${impact.same === 1 ? 'has' : 'have'} the same value for both: one is kept`);
  if (impact.rules) items.push(`${plural(impact.rules, 'consent rule')} for it ${impact.rules === 1 ? 'goes' : 'go'} by ${into.name}`);
  if (impact.schedules) items.push(`${plural(impact.schedules, 'sampling schedule')} ${impact.schedules === 1 ? 'names' : 'name'} ${into.name} instead`);
  if (impact.guidelineSets.length) items.push(`Its values in your guideline sets (${some(impact.guidelineSets)}) become ${into.name}’s, where it has none`);
  if (impact.templates.length) items.push(`Report templates that choose it (${some(impact.templates)}) choose ${into.name}`);
  if (impact.formulas.length) items.push(`${some(impact.formulas)} – worked out from it – ${impact.formulas.length === 1 ? 'is' : 'are'} worked out from ${into.name}`);
  if (impact.names.length) items.push(`${into.name} also goes by ${some(impact.names.map((n) => `“${n}”`), 5)}, so the next import matches`);
  return (
    <Stack gap="xs">
      {items.length ? (
        <List size="sm" spacing={3}>
          {items.map((x) => (
            <List.Item key={x}>{x}</List.Item>
          ))}
        </List>
      ) : (
        <Text size="sm">Nothing uses {from.name}: it just goes.</Text>
      )}
      {impact.clashes.length > 0 && (
        <Alert color="orange" variant="light" p="xs" title={`${plural(impact.clashes.length, 'sample')} ${impact.clashes.length === 1 ? 'has' : 'have'} a different value for each`}>
          <Text size="sm">
            {into.name}’s value stays. {from.name}’s is kept with the sample, left out of the data and saying why – look at {impact.clashes.length === 1 ? 'it' : 'them'} in the sample’s details afterwards.
          </Text>
          {impact.clashes.slice(0, 5).map((c, i) => (
            <Text key={i} size="xs">
              {c.text}
            </Text>
          ))}
          {impact.clashes.length > 5 && (
            <Text size="xs" c="dimmed">
              … and {impact.clashes.length - 5} more
            </Text>
          )}
        </Alert>
      )}
      {impact.builtInValues.length > 0 && (
        <Text size="sm" c="orange.8">
          {some(impact.builtInValues)} {impact.builtInValues.length === 1 ? 'has' : 'have'} a guideline value for {from.name} and none for {into.name}: its results won’t be compared with {impact.builtInValues.length === 1 ? 'it' : 'them'} any more. Merging the
          other way round keeps the guideline.
        </Text>
      )}
    </Stack>
  );
}

/** Merge a parameter into another: for a lab's name that became a parameter of its own. */
export function MergeParameterModal({ param, onClose }: { param: Parameter; onClose: () => void }) {
  const all = useLiveQuery(() => db.parameters.toArray(), []);
  const [intoId, setIntoId] = useState<string | null>(null);
  const [impact, setImpact] = useState<ParameterMergeImpact | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const others = useMemo(() => [...(all ?? [])].filter((p) => p.id !== param.id).sort(compareParams), [all, param.id]);
  // the likeliest first: names with the same words
  const likely = useMemo(() => likeParams(param, others, () => 0, 5), [param, others]);
  const data = useMemo(() => {
    const label = (p: Parameter) => `${p.name}${p.unit ? ` (${unitLabel(p.unit)})` : ''}`;
    const groups = new Map<string, Array<{ value: string; label: string }>>();
    const liked = new Set(likely.map((p) => p.id));
    for (const p of others) if (!liked.has(p.id)) groups.set(p.group, [...(groups.get(p.group) ?? []), { value: p.id, label: label(p) }]);
    return [...(likely.length ? [{ group: 'Named alike', items: likely.map((p) => ({ value: p.id, label: label(p) })) }] : []), ...[...groups].map(([group, items]) => ({ group, items }))];
  }, [others, likely]);
  const into = others.find((p) => p.id === intoId);
  useEffect(() => {
    setImpact(null);
    setError('');
    if (!intoId) return;
    let live = true;
    parameterMergeImpact(param.id, intoId).then(
      (i) => live && setImpact(i),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [param.id, intoId]);
  const merge = async () => {
    if (!into) return;
    setBusy(true);
    try {
      const r = await mergeParameters(param.id, into.id);
      notifications.show({ color: 'teal', message: `${param.name} merged into ${into.name}: ${plural(r.moved, 'result')} moved${r.same ? `, ${r.same} the same in both` : ''}${r.clashes ? `, ${plural(r.clashes, 'sample')} with a different value kept apart` : ''}.`, autoClose: 9000 });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} title={`Merge ${param.name} into another parameter`} size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          For two parameters that are the same thing – a lab’s name that became a parameter of its own. {param.name} goes; everything that named it names the other.
        </Text>
        <Select label="Merge it into" placeholder="Search the parameters…" searchable data={data} value={intoId} onChange={setIntoId} maxDropdownHeight={300} comboboxProps={{ withinPortal: true }} data-autofocus />
        {into && impact && !impact.blocked && <ParameterImpactList impact={impact} from={param} into={into} />}
        {(impact?.blocked || error) && (
          <Alert color="red" variant="light" p="xs">
            <Text size="sm">{impact?.blocked ?? error}</Text>
          </Alert>
        )}
        {into && impact && !impact.blocked && (
          <Text size="sm" c="dimmed">
            It applies to every project in this workspace, for everyone. It can only be undone from a backup.
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button color="orange" onClick={() => void merge()} loading={busy} disabled={!into || !impact || !!impact.blocked}>
            {into ? `Merge into ${into.name}` : 'Merge'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Merge a site into another of its project: for a site imported under a second name. */
export function MergeSiteModal({ site, sites, onClose }: { site: Site; sites: Site[]; onClose: () => void }) {
  const [intoId, setIntoId] = useState<string | null>(null);
  const [impact, setImpact] = useState<SiteMergeImpact | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const others = sites.filter((s) => s.id !== site.id);
  const into = others.find((s) => s.id === intoId);
  useEffect(() => {
    setImpact(null);
    setError('');
    if (!intoId) return;
    let live = true;
    siteMergeImpact(site.id, intoId).then(
      (i) => live && setImpact(i),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [site.id, intoId]);
  const merge = async () => {
    if (!into) return;
    setBusy(true);
    try {
      const r = await mergeSites(site.id, into.id);
      notifications.show({ color: 'teal', message: `${site.code} merged into ${into.code}: ${plural(r.samples, 'sample')}, ${plural(r.results, 'result')}.`, autoClose: 9000 });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const items = impact && into
    ? [
        impact.samples ? `${plural(impact.samples, 'sample')} (${plural(impact.results, 'result')}) at ${site.code} ${impact.samples === 1 ? 'becomes' : 'become'} ${into.code}’s` : `${site.code} has no samples`,
        impact.sharedDays.length ? `${plural(impact.sharedDays.length, 'day')} ${impact.sharedDays.length === 1 ? 'has' : 'have'} a sample at both (${some(impact.sharedDays.map((d) => formatDate(d)), 3)}): both samples are kept – look them over afterwards` : '',
        impact.rules ? `${plural(impact.rules, 'consent rule')} that ${impact.rules === 1 ? 'names' : 'name'} it ${impact.rules === 1 ? 'names' : 'name'} ${into.code}` : '',
        impact.schedules ? `${plural(impact.schedules, 'sampling schedule')} ${impact.schedules === 1 ? 'names' : 'name'} ${into.code} instead` : '',
        impact.calendarRows ? `${plural(impact.calendarRows, 'row')} of the monitoring calendar ${impact.calendarRows === 1 ? 'counts' : 'count'} ${into.code}’s results` : '',
        impact.names.length ? `${into.code} also goes by ${some(impact.names.map((n) => `“${n}”`), 5)}, so the next import of ${impact.names.length === 1 ? 'it' : 'them'} goes there` : '',
        ...impact.details,
      ].filter(Boolean)
    : [];
  return (
    <Modal opened onClose={onClose} title={`Merge site ${site.code} into another`} size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          For one place that became two sites – imported under a second name, say. {site.code} goes; its samples and everything that named it go to the other.
        </Text>
        <Select
          label="Merge it into"
          placeholder="Choose the site…"
          searchable
          data={others.map((s) => ({ value: s.id, label: `${s.code}${s.name ? ` – ${s.name}` : ''}` }))}
          value={intoId}
          onChange={setIntoId}
          comboboxProps={{ withinPortal: true }}
          data-autofocus
        />
        {items.length > 0 && !impact?.blocked && (
          <List size="sm" spacing={3}>
            {items.map((x) => (
              <List.Item key={x}>{x}</List.Item>
            ))}
          </List>
        )}
        {(impact?.blocked || error) && (
          <Alert color="red" variant="light" p="xs">
            <Text size="sm">{impact?.blocked ?? error}</Text>
          </Alert>
        )}
        {into && impact && !impact.blocked && (
          <Text size="sm" c="dimmed">
            Issued reports keep what they were built from. This can only be undone from a backup.
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button color="orange" onClick={() => void merge()} loading={busy} disabled={!into || !impact || !!impact.blocked}>
            {into ? `Merge into ${into.code}` : 'Merge'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
