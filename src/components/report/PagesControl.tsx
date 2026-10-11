import { SegmentedControl, Text } from '@mantine/core';
import type { ReportBlock } from '../../db/types';
import { hasMixedPages, samePages, type Orientation } from './sections';

/**
 * Portrait or landscape for the whole report. When some sections are on pages the other way round, neither is
 * selected; picking one then applies it to every page.
 */
export function PagesControl({ orientation, blocks, onChange }: { orientation: Orientation; blocks: ReportBlock[]; onChange: (orientation: Orientation, blocks: ReportBlock[]) => void }) {
  const mixed = hasMixedPages(blocks, orientation);
  return (
    <div>
      <Text size="sm" fw={500} mb={4}>
        Pages
      </Text>
      <SegmentedControl
        fullWidth
        value={mixed ? '' : orientation}
        onChange={(v) => onChange(v as Orientation, samePages(blocks))}
        data={[
          { value: 'portrait', label: 'Portrait' },
          { value: 'landscape', label: 'Landscape' },
        ]}
      />
      {mixed && (
        <Text size="xs" c="dimmed" mt={4}>
          Mixed – some sections are on {orientation === 'portrait' ? 'landscape' : 'portrait'} pages. Pick one to use it for every page.
        </Text>
      )}
    </div>
  );
}
