// What a file has that isn't going in (or didn't), and why – shown before an import and after it, so a result is never
// left out without it being said.

import { useState } from 'react';
import { Alert, Anchor, Button, Group, Stack, Table, Text } from '@mantine/core';
import { IconAlertTriangle, IconChecks } from '@tabler/icons-react';
import { accountText, LEFT_WHY, leftSummary, type ImportAccount } from '../importers/account';
import { formatDate } from '../lib/dates';

const n = (v: number) => v.toLocaleString('en-NZ');

export function ImportAccountPanel({ account, done, onSites, onAnalytes }: { account: ImportAccount; done?: boolean; onSites?: () => void; onAnalytes?: () => void }) {
  const [open, setOpen] = useState(false);
  const out = account.read - account.going;
  const left = leftSummary(account.left);
  const leftCount = account.left.length;
  if (!out && !leftCount) {
    return (
      <Group gap={6} wrap="nowrap">
        <IconChecks size={16} color="var(--mantine-color-teal-6)" />
        <Text size="sm" c="dimmed">
          Every result in the file {done ? 'went in' : 'goes in'}: {n(account.read)} read, none left out.
        </Text>
      </Group>
    );
  }
  // repeats with the same value lose nothing; anything else is worth a look
  const harmless = account.lines.every((l) => l.why === 'twice') && !account.clashes.length && !leftCount;
  return (
    <Stack gap="xs">
      {out > 0 && (
        <Alert color={harmless ? 'gray' : 'orange'} variant="light" icon={harmless ? undefined : <IconAlertTriangle size={18} />} title={`${n(out)} of the file’s ${n(account.read)} results ${done ? (out === 1 ? 'wasn’t' : 'weren’t') : out === 1 ? 'isn’t' : 'aren’t'} ${done ? 'imported' : 'going in'}`}>
          <Stack gap={4}>
            {account.lines.map((l) => (
              <Text size="sm" key={l.why}>
                {accountText(l)}.
                {!done && l.why === 'no-parameter' && onAnalytes && (
                  <>
                    {' '}
                    <Anchor size="sm" onClick={onAnalytes}>
                      Match them
                    </Anchor>
                  </>
                )}
                {!done && (l.why === 'no-site' || l.why === 'no-date') && onSites && (
                  <>
                    {' '}
                    <Anchor size="sm" onClick={onSites}>
                      {l.why === 'no-site' ? 'Choose sites' : 'Give them dates'}
                    </Anchor>
                  </>
                )}
              </Text>
            ))}
            {account.merged.map((m) => (
              <Text size="sm" key={`${m.site}|${m.day}`}>
                {m.site} on {formatDate(m.day)} is there {m.names.length === 2 ? 'twice' : `${m.names.length} times`} ({m.names.map((x) => `“${x}”`).join(', ')}) and {done ? 'went' : 'goes'} into one sample: where both have a result, the later {done ? 'replaced' : 'replaces'} the earlier.
                {done ? '' : ' To keep the other value, skip one of the two analytes on the Analytes step; if they’re separate samples, give one another date or leave it out.'}
              </Text>
            ))}
            {account.clashes.length > 0 && (
              <>
                <Button size="compact-xs" variant="subtle" w="fit-content" px={0} onClick={() => setOpen(!open)}>
                  {open ? 'Hide' : 'Show'} the {account.clashes.length === 1 ? 'result' : `${n(account.clashes.length)} results`} replaced by another in the file
                </Button>
                {open && (
                  <Table.ScrollContainer minWidth={560}>
                    <Table verticalSpacing={2} fz="xs">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Site</Table.Th>
                          <Table.Th>Date</Table.Th>
                          <Table.Th>Parameter</Table.Th>
                          <Table.Th>Kept</Table.Th>
                          <Table.Th>Replaced</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {account.clashes.slice(0, 40).map((c, i) => (
                          <Table.Tr key={i}>
                            <Table.Td>{c.site}</Table.Td>
                            <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDate(c.day)}</Table.Td>
                            <Table.Td>{c.parameter}</Table.Td>
                            <Table.Td>
                              {c.kept}{' '}
                              <Text span size="xs" c="dimmed">
                                ({c.from[0]})
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              {c.dropped}{' '}
                              <Text span size="xs" c="dimmed">
                                ({c.from[1]})
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
              </>
            )}
          </Stack>
        </Alert>
      )}
      {leftCount > 0 && (
        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={18} />} title={`${n(leftCount)} ${leftCount === 1 ? 'entry' : 'entries'} in the file ${leftCount === 1 ? 'isn’t' : 'aren’t'} read as ${leftCount === 1 ? 'a result' : 'results'}`}>
          <Text size="sm" mb={6}>
            {leftCount === 1 ? 'It isn’t blank, and isn’t a number or a “less than” value' : 'They aren’t blank, and aren’t numbers or “less than” values'}
            {done ? '' : leftCount === 1 ? ' – so it won’t be imported' : ' – so they won’t be imported'}. If {leftCount === 1 ? 'it' : 'one'} is a result, type it into the Data tab{done ? '' : ' afterwards'}.
          </Text>
          <Table.ScrollContainer minWidth={520}>
            <Table verticalSpacing={2} fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>In the file</Table.Th>
                  <Table.Th ta="right">How many</Table.Th>
                  <Table.Th>For</Table.Th>
                  <Table.Th>Why not</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {left.slice(0, 25).map((x, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>“{x.text}”</Table.Td>
                    <Table.Td ta="right">{n(x.n)}</Table.Td>
                    <Table.Td>
                      {x.where.slice(0, 3).join('; ')}
                      {x.n > 3 ? ' …' : ''}
                    </Table.Td>
                    <Table.Td>{LEFT_WHY[x.why]}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {left.length > 25 && (
            <Text size="xs" c="dimmed" mt={4}>
              And {n(left.length - 25)} more kinds.
            </Text>
          )}
        </Alert>
      )}
    </Stack>
  );
}

/** The account in a few lines of words, for the import's own record. */
export function accountNotes(account: ImportAccount): string[] {
  const out = account.lines.filter((l) => l.why !== 'twice' || account.clashes.length).map(accountText);
  if (account.left.length) {
    const kinds = leftSummary(account.left);
    out.push(`${n(account.left.length)} ${account.left.length === 1 ? 'entry' : 'entries'} not read as results (${kinds.slice(0, 4).map((k) => `“${k.text}”${k.n > 1 ? ` ×${k.n}` : ''}`).join(', ')}${kinds.length > 4 ? ' …' : ''})`);
  }
  return out;
}
