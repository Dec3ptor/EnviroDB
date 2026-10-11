// Generates the synthetic example import files in public/samples/ (run: npm run samples).
// All data is made up. The lab file mimics the layout of a Hill Laboratories Excel certificate.
import * as XLSX from '@e965/xlsx';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = new URL('../public/samples/', import.meta.url);
mkdirSync(out, { recursive: true });

// ------------------------------------------------------------------ lab certificate layout
{
  const aoa = [
    ['Example laboratory results – Hill Laboratories certificate layout (SYNTHETIC DATA)'],
    ['Certificate of Analysis'],
    [],
    ['Client:', 'Demo Aggregates Ltd', '', '', 'Lab No:', '3512345'],
    ['Contact:', 'J Bloggs', '', '', 'Date Received:', '14-Mar-2026'],
    ['', '', '', '', 'Date Reported:', '21-Mar-2026'],
    ['', '', '', '', 'Client Reference:', 'Kowhai Quarry monthly'],
    [],
    ['Sample Type: Aqueous'],
    ['Sample Name:', '', 'US1 12-Mar-2026 9:10 am', 'DP1 12-Mar-2026 9:45 am', 'DS1 12-Mar-2026 10:20 am'],
    ['Lab Number:', '', '3512345.1', '3512345.2', '3512345.3'],
    ['Individual Tests'],
    ['pH', 'pH Units', 7.2, 7.8, 7.3],
    ['Total Suspended Solids', 'g/m³', '< 3', 112, 9],
    ['Turbidity', 'NTU', 2.1, 95, 14],
    ['Electrical Conductivity (EC)', 'mS/m', 10.8, 31.5, 13.9],
    ['Total Hardness', 'g/m³ as CaCO3', 35, 88, 44],
    ['Total Ammoniacal-N', 'g/m³', '< 0.010', 0.052, 0.016],
    ['Nitrate-N', 'g/m³', 0.61, 2.3, 1.12],
    ['Dissolved Reactive Phosphorus', 'g/m³', 0.006, '', 0.009],
    ['Escherichia coli', 'cfu / 100mL', 210, '', 330],
    ['Heavy metals, dissolved, trace As,Cd,Cr,Cu,Ni,Pb,Zn'],
    ['Dissolved Copper', 'g/m³', 0.0006, 0.0021, 0.0009],
    ['Dissolved Lead', 'g/m³', '< 0.00010', 0.00038, 0.00012],
    ['Dissolved Nickel', 'g/m³', '< 0.0005', 0.0013, '< 0.0005'],
    ['Dissolved Zinc', 'g/m³', 0.0019, 0.0112, 0.0046],
    [],
    ["Analyst's Comments"],
    ['Synthetic example file for testing imports.'],
    ['Summary of Methods'],
    ['Test', 'Method Description', 'Default Detection Limit', 'Sample No'],
    ['pH', 'pH meter. APHA 4500-H+ B', '0.1 pH Units', '1-3'],
    ['Total Suspended Solids', 'Filtration, gravimetric. APHA 2540 D', '3 g/m³', '1-3'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '3512345');
  writeFileSync(new URL('example-lab-results-hill-layout.xlsx', out), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// ------------------------------------------------------------------ master sheet (dates per row)
{
  const wb = XLSX.utils.book_new();
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sites = [
    ['US1', { tss: 4, turb: 2.5, zn: 0.002, cu: 0.0006 }],
    ['DP1', { tss: 30, turb: 32, zn: 0.009, cu: 0.002 }],
    ['DS1', { tss: 7, turb: 6, zn: 0.004, cu: 0.0009 }],
  ];
  for (const [code, base] of sites) {
    const aoa = [
      [`Kowhai Quarry – ${code} monitoring results (SYNTHETIC EXAMPLE)`],
      [],
      ['Date', 'Time', 'pH', 'TSS', 'Turbidity', 'EC', 'Dissolved Cu', 'Dissolved Zn', 'NH4-N', 'Comments'],
      ['', '', 'pH units', 'g/m3', 'NTU', 'uS/cm', 'mg/L', 'mg/L', 'g/m3', ''],
      ['ANZECC 95%', '', '', '', '', '', 0.0014, 0.008, 0.9, 'guideline row – skipped on import'],
    ];
    for (let i = 0; i < 24; i++) {
      const date = new Date(Date.UTC(2022, 6 + i, 10 + Math.floor(rand() * 8)));
      const serial = date.getTime() / 86400000 + 25569;
      const storm = rand() < 0.2 ? 3 : 1;
      const row = [
        serial,
        (9 + rand() * 2) / 24,
        Number((7.1 + rand() * 0.6).toFixed(1)),
        Math.round(base.tss * storm * (0.6 + rand())),
        Number((base.turb * storm * (0.6 + rand())).toFixed(1)),
        Math.round(100 + rand() * 250),
        Number((base.cu * (0.6 + rand())).toFixed(4)),
        Number((base.zn * storm * (0.6 + rand())).toFixed(4)),
        rand() < 0.3 ? '<0.010' : Number((0.01 + rand() * 0.05).toFixed(3)),
        storm > 1 ? 'Raining' : '',
      ];
      if (i === 5) row.splice(6, 2, 'NS', 'NS');
      aoa.push(row);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    for (let r = 5; r < aoa.length; r++) {
      const a = XLSX.utils.encode_cell({ r, c: 0 });
      const t = XLSX.utils.encode_cell({ r, c: 1 });
      if (ws[a]) ws[a].z = 'dd/mm/yyyy';
      if (ws[t]) ws[t].z = 'hh:mm';
    }
    ws['!cols'] = [{ wch: 12 }, { wch: 8 }, ...Array(8).fill({ wch: 12 })];
    XLSX.utils.book_append_sheet(wb, ws, code);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Notes'], ['This workbook is a synthetic example of a monitoring master sheet.']]), 'Notes');
  writeFileSync(new URL('example-master-sheet.xlsx', out), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// ------------------------------------------------------------------ long format CSV
{
  const rows = [['Site', 'Date Sampled', 'Analyte', 'Result', 'Units', 'Detection Limit']];
  const days = ['14/04/2026', '12/05/2026', '09/06/2026'];
  for (const d of days) {
    for (const [site, zn] of [['US1', 0.0018], ['DS1', 0.0051]]) {
      rows.push([site, d, 'Dissolved Zinc', String(zn), 'g/m3', '0.001']);
      rows.push([site, d, 'Total Suspended Solids', site === 'US1' ? '<3' : '8', 'g/m3', '3']);
      rows.push([site, d, 'pH', site === 'US1' ? '7.2' : '7.4', 'pH units', '']);
    }
  }
  writeFileSync(new URL('example-long-format.csv', out), rows.map((r) => r.join(',')).join('\n') + '\n');
}

console.log('Sample files written to public/samples/');
