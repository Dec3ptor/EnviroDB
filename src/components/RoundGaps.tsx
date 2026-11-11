// What a sampling round is missing against its schedule – a site not sampled, an analyte the lab left off – as a
// short list, with a way to accept a round as it is (so it isn't asked about again).

import { Anchor, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { saveSchedule } from '../db/repo';
import { formatDate } from '../lib/dates';
import { gapLines, type RoundGaps } from '../lib/schedule';

/** Accept a round as it is – or take that back. */
export async function acceptRound(g: RoundGaps, accept: boolean): Promise<void> {
  const sch = g.schedule;
  const accepted = (sch.accepted ?? []).filter((d) => d !== g.start);
  if (accept) accepted.push(g.start);
  await saveSchedule({ ...sch, accepted: accepted.length ? accepted : undefined }, sch);
  if (accept) notifications.show({ message: `${sch.name}, the round from ${formatDate(g.start)}: accepted as it is.` });
}

/** The rounds with something missing, a few lines each. `showNotSampled`: also say which sites weren't sampled. */
export function RoundGapsList({ gaps, siteCode, paramName, showNotSampled = true, showName = true, size = 'sm' }: { gaps: RoundGaps[]; siteCode: (id: string) => string; paramName: (id: string) => string; showNotSampled?: boolean; showName?: boolean; size?: 'xs' | 'sm' }) {
  return (
    <Stack gap={6}>
      {gaps.map((g) => {
        const lines = gapLines(showNotSampled ? g : { ...g, notSampled: [] }, siteCode, paramName);
        if (!lines.length) return null;
        return (
          <div key={`${g.schedule.id}|${g.start}`}>
            <Group gap={6} wrap="wrap">
              <Text size={size} fw={600}>
                {showName ? `${g.schedule.name} · ` : 'Round of '}
                {formatDate(g.start)} – {formatDate(g.end)}
              </Text>
              {g.accepted ? (
                <Text size="xs" c="dimmed">
                  accepted as it is ·{' '}
                  <Anchor component="button" type="button" size="xs" onClick={() => void acceptRound(g, false)}>
                    undo
                  </Anchor>
                </Text>
              ) : (
                <Anchor component="button" type="button" size="xs" onClick={() => void acceptRound(g, true)} title="Nothing more is coming for this round: don’t ask about it again">
                  That’s all for this round
                </Anchor>
              )}
            </Group>
            {lines.map((l) => (
              <Text key={l} size={size} c={g.accepted ? 'dimmed' : undefined}>
                {l}
              </Text>
            ))}
          </div>
        );
      })}
    </Stack>
  );
}
