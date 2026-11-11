import { describe, expect, it } from 'vitest';
import { exceedanceNotice, MAILTO_MAX, noticeMailto, sameDayOpen, type NoticeItem } from '../src/lib/notice';

// A made-up discharge consent: a TSS limit at the pond outlet and a turbidity trigger downstream.
const tss: NoticeItem = {
  rule: { id: 'r1', name: 'Discharge TSS limit', level: 'Limit', condition: 'Condition 8(a)', action: 'Notify the Council within 24 hours, investigate the cause and re-sample within 7 days.' },
  ex: { key: 'dp1|2026-10-09T09:45|tss', ruleId: 'r1', siteId: 'dp1', parameterId: 'tss', date: '2026-10-09T09:45', value: 164, qualifier: '', unit: 'g/m3', limitText: '> 100 g/m³', detail: '', resultId: 'res1' },
};
const turb: NoticeItem = {
  rule: { id: 'r2', name: 'Turbidity increase downstream', level: 'Trigger', condition: 'Condition 10', action: 'Notify the Council and review discharge rate.' },
  ex: { key: 'ds1|2026-10-09T10:20|turbidity|chg', ruleId: 'r2', siteId: 'ds1', parameterId: 'turbidity', date: '2026-10-09T10:20', value: 85, qualifier: '', unit: '%', limitText: '> 50%', detail: 'DS1 22.2 vs US1 12 NTU → +85%' },
  note: { text: 'Pond flocculant dosing checked 10 Oct.\nRe-sample booked 14 Oct.', status: 'open' },
};
const ctx = {
  project: { name: 'Kōwhai Quarry stormwater discharge', consents: 'AUTH-123456', client: 'Demo Aggregates Ltd', regulator: 'Demo Regional Council', location: 'Kōwhai Road' },
  site: (id: string) => ({ dp1: { code: 'DP1', name: 'Sediment pond outlet' }, ds1: { code: 'DS1', name: 'Kōwhai Stream – downstream' } })[id],
  param: (id: string) => ({ tss: { name: 'Total Suspended Solids' }, turbidity: { name: 'Turbidity' } })[id],
  sampleOf: (resultId: string) => (resultId === 'res1' ? { labName: 'Hill Labs', labJob: '3300139', date: '2026-10-09T09:45' } : undefined),
  author: 'Sam Taylor',
  company: 'Example Environmental',
};

describe('an exceedance notice', () => {
  it('says who is notifying under which conditions, each exceedance with its limit, and what the consent requires', () => {
    const n = exceedanceNotice([turb, tss], ctx);
    expect(n.subject).toBe('Notification of exceedances – Kōwhai Quarry stormwater discharge – consent AUTH-123456 – DP1 and DS1 9 Oct 2026');
    expect(n.body.split('\n')).toEqual([
      'To Demo Regional Council,',
      '',
      'As required by Condition 8(a) and Condition 10 of resource consent AUTH-123456 (Kōwhai Quarry stormwater discharge, Kōwhai Road), Example Environmental, on behalf of Demo Aggregates Ltd, advises that monitoring on 9 Oct 2026 found 2 exceedances of consent limits or trigger levels:',
      '',
      '- DP1 (Sediment pond outlet), sampled 9 Oct 2026 at 09:45: Total Suspended Solids 164 g/m³',
      '  Limit: Discharge TSS limit – > 100 g/m³ (Condition 8(a))',
      '  Hill Labs, job 3300139',
      '- DS1 (Kōwhai Stream – downstream), sampled 9 Oct 2026 at 10:20: Turbidity 85%',
      '  Trigger: Turbidity increase downstream – > 50% (Condition 10)',
      '  DS1 22.2 vs US1 12 NTU → +85%',
      '',
      'The consent requires:',
      '- Notify the Council within 24 hours, investigate the cause and re-sample within 7 days.',
      '- Notify the Council and review discharge rate.',
      '',
      'Actions taken so far:',
      '- Pond flocculant dosing checked 10 Oct.',
      '  Re-sample booked 14 Oct.',
      '',
      'We will let you know the outcome.',
      '',
      'Kind regards,',
      'Sam Taylor',
      'Example Environmental',
    ]);
  });

  it('one trigger, no notes yet: a place to say what’s been done; the project’s own greeting', () => {
    const n = exceedanceNotice([{ ...turb, note: undefined }], { ...ctx, project: { ...ctx.project, salutation: 'Dear David,' }, company: undefined });
    expect(n.subject).toMatch(/^Notification of trigger level exceeded – /);
    expect(n.body).toMatch(/^Dear David,\n\nAs required by Condition 10 of resource consent AUTH-123456 \([^)]*\), Demo Aggregates Ltd advises that monitoring on 9 Oct 2026 found a result above a trigger level:/);
    expect(n.body).toContain('- [what has been done');
  });

  it('opens in the email program; a day’s open exceedances go together', () => {
    const n = exceedanceNotice([tss], ctx);
    const m = noticeMailto({ subject: n.subject, body: 'Short enough to hand over.' }, 'consents@example.govt.nz');
    expect(m.fits).toBe(true);
    expect(m.href.startsWith('mailto:consents%40example.govt.nz?subject=Notification%20of%20exceedance%20')).toBe(true);
    expect(decodeURIComponent(m.href.split('&body=')[1])).toBe('Short enough to hand over.');
    // a long notice: the subject only (the text is copied, to paste)
    const long = noticeMailto({ subject: n.subject, body: n.body.repeat(4) });
    expect(long.fits).toBe(false);
    expect(long.href).not.toContain('&body=');
    expect(long.href.length).toBeLessThan(MAILTO_MAX);
    // a threshold's detail that only repeats the value isn't said twice
    expect(exceedanceNotice([{ ...tss, ex: { ...tss.ex, detail: '164 g/m³' } }], ctx).body).not.toContain('\n  164 g/m³');
    const other = { ...tss, ex: { ...tss.ex, key: 'x', date: '2026-09-08' } };
    const closed = { ...turb, note: { text: '', status: 'closed' as const } };
    expect(sameDayOpen([tss, turb, other, closed], tss)).toEqual([tss, turb]);
    expect(sameDayOpen([tss, closed], closed)).toEqual([closed, tss]); // the one asked for goes in whatever its status
  });
});
