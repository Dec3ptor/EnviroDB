import { List, Stack, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import type { Parameter } from '../db/types';
import { deleteParameter, parameterImpact, type ParameterImpact } from '../db/repo';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const names = (xs: Array<{ name: string }>, max = 4) => xs.slice(0, max).map((x) => `“${x.name}”`).join(', ') + (xs.length > max ? ` and ${xs.length - max} more` : '');

/** What will go, in a list the person can check before saying yes. */
function ImpactList({ impact, inProject }: { impact: ParameterImpact; inProject: boolean }) {
  const items: string[] = [];
  if (impact.results)
    items.push(
      inProject
        ? `${plural(impact.results, 'result')} in this project`
        : `${plural(impact.results, 'result')} in ${plural(impact.projects.length, 'project')}: ${impact.projects.map((p) => `${p.name} (${p.results})`).join(', ')}`,
    );
  if (impact.emptySamples) items.push(`${plural(impact.emptySamples, 'sample')} with no other results`);
  if (impact.rules.length) items.push(`${plural(impact.rules.length, 'consent rule')} for it: ${names(impact.rules)}`);
  const keep: string[] = [];
  if (impact.schedules.length) keep.push(`It comes off ${plural(impact.schedules.length, 'sampling schedule')} (${names(impact.schedules)}); they keep their other parameters.`);
  if (impact.guidelineSets.length) keep.push(`Its values in your guideline sets ${names(impact.guidelineSets)} go.`);
  if (impact.templates.length) keep.push(`Report templates that choose it (${names(impact.templates)}) leave it out.`);
  return (
    <Stack gap="xs">
      {items.length ? (
        <>
          <Text size="sm" fw={600}>
            This also deletes:
          </Text>
          <List size="sm" spacing={2}>
            {items.map((x) => (
              <List.Item key={x}>{x}</List.Item>
            ))}
          </List>
        </>
      ) : (
        <Text size="sm">{inProject ? 'The project has no results or rules for it.' : 'Nothing uses it: no results, rules or schedules.'}</Text>
      )}
      {keep.map((x) => (
        <Text key={x} size="sm">
          {x}
        </Text>
      ))}
    </Stack>
  );
}

/**
 * Asks before deleting a parameter – from the library (everywhere) or, given a project, from that project only –
 * showing what goes with it.
 */
export async function confirmDeleteParameter(p: Parameter, project?: { id: string; name: string }): Promise<void> {
  const impact = await parameterImpact(p.id, project?.id);
  const big = impact.results > 0 || impact.rules.length > 0;
  modals.openConfirmModal({
    title: project ? `Remove ${p.name} from ${project.name}?` : `Delete ${p.name} from the parameter library?`,
    size: 'lg',
    children: (
      <Stack gap="sm">
        <ImpactList impact={impact} inProject={!!project} />
        <Text size="sm" c="dimmed">
          {project
            ? 'The parameter stays in the library for other projects.'
            : `It goes for everyone using this workspace.${p.builtIn ? ' It is a built-in parameter: it stays deleted, and you can add it again with Add parameter.' : ''}`}{' '}
          {big ? 'This can only be undone from a backup.' : ''}
        </Text>
      </Stack>
    ),
    labels: { confirm: project ? 'Remove from project' : 'Delete parameter', cancel: 'Cancel' },
    confirmProps: { color: 'red' },
    onConfirm: async () => {
      await deleteParameter(p.id, project?.id);
      notifications.show({ message: project ? `${p.name} removed from ${project.name}` : `${p.name} deleted`, color: 'teal' });
    },
  });
}
