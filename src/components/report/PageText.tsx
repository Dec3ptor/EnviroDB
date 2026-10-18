// A template's header and footer: left, centre and right, with fill-ins ([project], [page] of [pages] …), whether they
// go on the first page, and – on a letterhead – whether they're added to the letterhead's own.

import { Paper, SimpleGrid, Stack, Switch, Text } from '@mantine/core';
import type { ReportTemplate } from '../../db/types';
import { PAGE_FILL_INS, fillCaption, fillKey, tidyCaption, usualFooterRight } from '../../reports/captions';
import { FillInInput } from './FillInInput';

type PageTextKey = 'headerText' | 'headerCenter' | 'headerRight' | 'footerText' | 'footerCenter' | 'footerRight' | 'pageTextFirst' | 'pageTextWithLetterhead';
export type PageTextPatch = Partial<Pick<ReportTemplate, PageTextKey>>;

const EXAMPLES = Object.fromEntries(PAGE_FILL_INS.map((f) => [fillKey(f.name), f.example]));
const shown = (s: string) => tidyCaption(fillCaption(s, EXAMPLES));

export function PageTextEditor({ template: t, onChange, onLetterhead, disabled, title = true }: { template: ReportTemplate; onChange: (patch: PageTextPatch) => void; onLetterhead: boolean; disabled?: boolean; title?: boolean }) {
  const first = t.blocks[0];
  const titlePage = first?.type === 'title' && first.pageBreakAfter;
  const usualFirst = !onLetterhead && !titlePage;
  const off = onLetterhead && !t.pageTextWithLetterhead;
  const lines = {
    header: [t.headerText ?? '', t.headerCenter ?? '', t.headerRight ?? ''],
    footer: [t.footerText ?? '', t.footerCenter ?? '', t.footerRight ?? usualFooterRight(onLetterhead)],
  };
  const keys = { header: ['headerText', 'headerCenter', 'headerRight'], footer: ['footerText', 'footerCenter', 'footerRight'] } as const;
  const sides = ['left', 'centre', 'right'];
  const row = (part: 'header' | 'footer') => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 9, color: 'var(--mantine-color-dimmed)' }}>
      {lines[part].map((s, i) => (
        <span key={i} style={{ textAlign: i === 0 ? 'left' : i === 1 ? 'center' : 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {shown(s)}
        </span>
      ))}
    </div>
  );
  return (
    <Stack gap={6}>
      {title && (
        <Text size="sm" fw={500}>
          Header and footer
        </Text>
      )}
      {onLetterhead && (
        <Switch
          size="xs"
          label="Add my own lines to the letterhead’s header and footer"
          description="Under its header and above its footer – e.g. the project and page number on every page"
          checked={!!t.pageTextWithLetterhead}
          onChange={(e) => onChange({ pageTextWithLetterhead: e.currentTarget.checked })}
          disabled={disabled}
        />
      )}
      {off ? (
        <Text size="xs" c="dimmed">
          The letterhead’s own header and footer are used – change those in Settings → Letterhead.
        </Text>
      ) : (
        <>
          {(['header', 'footer'] as const).map((part) => (
            <SimpleGrid key={part} cols={{ base: 1, sm: 3 }} spacing="xs" verticalSpacing={4}>
              {lines[part].map((value, i) => (
                <FillInInput
                  key={keys[part][i]}
                  label={`${part === 'header' ? 'Header' : 'Footer'} – ${sides[i]}`}
                  value={value}
                  fillIns={PAGE_FILL_INS}
                  chips={0}
                  onChange={(v) => onChange({ [keys[part][i]]: v })}
                />
              ))}
            </SimpleGrid>
          ))}
          <Text size="xs" c="dimmed">
            Type [ to fill in [page] of [pages], [project], [project code], [period], [report], [company], [date] …
          </Text>
          <Paper withBorder p={8} maw={420} aria-label="How the header and footer look">
            {row('header')}
            <div style={{ height: 34, margin: '6px 0', borderRadius: 3, background: 'repeating-linear-gradient(transparent 0 5px, var(--mantine-color-default-border) 5px 6px)', opacity: 0.6 }} />
            {row('footer')}
          </Paper>
          <Switch size="xs" label="On the first page too" checked={t.pageTextFirst ?? usualFirst} onChange={(e) => onChange({ pageTextFirst: e.currentTarget.checked })} disabled={disabled} />
        </>
      )}
    </Stack>
  );
}
