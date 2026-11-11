import { useEffect, useMemo, useState } from 'react';
import type { LabReportsBlock, ReportTemplate, Result, Sample } from '../db/types';
import { loadAttachments, periodFiles, type AttachedDoc, type AttachedRef } from '../lib/attachments';
import { samplesByImport } from '../lib/projectFiles';
import { useProjectFiles, useRoundRows } from './useProjectFiles';

const NONE: Record<string, AttachedRef[]> = {};

/**
 * The documents a report's Laboratory reports sections put in – which of the project's files, for its period and
 * sites – and their pages, read from the shared folder. `docs` is undefined while they're being read (and when the
 * layout has no such section). `issued`: the documents an issued report had, when it's shown as issued.
 */
export function useReportAttachments(input: {
  projectId: string;
  template: ReportTemplate | null | undefined;
  period: { start: string; end: string };
  /** Every sample of the project, QC samples included. */
  samples: Sample[];
  results: Result[];
  siteIds?: string[];
  issued?: Record<string, AttachedRef[]>;
}): { refs: Record<string, AttachedRef[]>; docs: Record<string, AttachedDoc[]> | undefined; loading: boolean } {
  const { projectId, template, period, samples, results, siteIds, issued } = input;
  const files = useProjectFiles(projectId);
  const rows = useRoundRows(projectId);
  const blocks = useMemo(() => (template?.blocks ?? []).filter((b): b is LabReportsBlock => b.type === 'labReports'), [template]);
  const blocksKey = blocks.map((b) => `${b.id}:${b.kinds.join(',')}`).join('|');
  const refs = useMemo(() => {
    if (!blocks.length) return NONE;
    if (issued) return Object.fromEntries(blocks.map((b) => [b.id, issued[b.id] ?? []]));
    const byImport = samplesByImport(samples, results);
    return Object.fromEntries(blocks.map((b) => [b.id, periodFiles({ files, kinds: b.kinds.length ? b.kinds : ['results'], period, samples, byImport, rows, siteIds })]));
  }, [blocksKey, files, rows, period.start, period.end, samples, results, siteIds, issued]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = refs === NONE ? '' : JSON.stringify(refs);
  const [state, setState] = useState<{ key: string; docs: Record<string, AttachedDoc[]> }>({ key: '', docs: {} });
  useEffect(() => {
    if (!key) return;
    let live = true;
    void (async () => {
      const docs: Record<string, AttachedDoc[]> = {};
      for (const [blockId, list] of Object.entries(refs)) docs[blockId] = await loadAttachments(list);
      if (live) setState({ key, docs });
    })();
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!key) return { refs, docs: undefined, loading: false };
  const ready = state.key === key;
  return { refs, docs: ready ? state.docs : undefined, loading: !ready };
}
