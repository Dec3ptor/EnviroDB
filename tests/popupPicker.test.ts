import { describe, expect, it } from 'vitest';
import { pickerSummary, type PickerData } from '../src/components/PopupPicker';

const data: PickerData = [
  { group: 'Physical', items: [{ value: 'ph', label: 'pH' }, { value: 'tss', label: 'Total Suspended Solids', short: 'TSS' }] },
  { group: 'Metals (dissolved)', items: [{ value: 'zn-d', label: 'Dissolved Zinc', short: 'Zn (D)' }, { value: 'cu-d', label: 'Dissolved Copper', short: 'Cu (D)' }] },
];

describe('popup picker summary', () => {
  it('names up to three, then counts', () => {
    expect(pickerSummary(data, [], 'parameters')).toBe('');
    expect(pickerSummary(data, ['tss', 'zn-d'], 'parameters')).toBe('TSS, Zn (D)');
    expect(pickerSummary(data, ['ph', 'tss', 'zn-d', 'cu-d'], 'parameters')).toBe('4 parameters');
    expect(pickerSummary(data, ['gone', 'ph'], 'parameters')).toBe('pH');
  });
});
