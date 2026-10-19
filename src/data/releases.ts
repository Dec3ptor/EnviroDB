// EnviroDB's releases, newest first. The first one's version is the app's version (package.json says the same – a
// test checks), shown in the sidebar and stamped on everything it makes. Add an entry with each release.

export interface Release {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  items: string[];
}

export const RELEASES: Release[] = [
  {
    version: '1.3.0',
    date: '2026-10-19',
    title: 'QA/QC checks',
    items: [
      'A QA/QC tab on each project: possible bottle swaps between sites (by the sampler, or the lab for one set of analytes), results unlike a site’s earlier ones, field duplicates’ RPDs, blanks, dissolved over total and other parts bigger than the whole, ion balance, EC against TDS, field against lab readings, holding times, the lab’s comments and detection limits.',
      'For each finding: Fine (with why), Leave out (kept, struck through, not used in statistics, compliance, graphs or reports), Swap back, or Query (an email to the lab to paste). Everything decided goes in the project’s QA/QC log, and can be undone.',
      'Duplicates and blanks are kept out of the monitoring data at a quality control site – made for you when importing a sample named like “DUP1” or “Field blank”. A duplicate’s original sample is suggested from its results.',
      'The import summary lists what the checks found in the new results, the dashboard’s actions include them, and a QA/QC report section sums it all up with an RPD table and the decisions made.',
      'Long tables (a row per result) without a detection limit column are now recognised as such.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-19',
    title: 'Lab inbox',
    items: [
      'Lab files waiting to be imported are listed on the Import data page, counted in the menu and added to the dashboard’s actions.',
      'Make an Inbox folder in the workspace folder (one click on the Import page) and save lab emails’ attachments there – by hand or with an Outlook rule.',
      'Or point EnviroDB at the folder your projects are kept in, and choose each project’s lab folder: its folders for each round or monitoring type are looked in too.',
      'Spreadsheets, CSVs, PDFs and zips that look like lab results are listed; photos, reports and EnviroDB’s own downloads are left out. A file named with a project’s code goes with that project.',
      'Tick files and Import – the import opens with them loaded. Imported and set-aside files are remembered for the whole team, and come back if the lab amends them.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-19',
    title: 'Sampling rounds',
    items: [
      'Track each round on the monitoring calendar: sampled, sent to the lab (which lab, job or chain of custody number), results back, results sent (and to whom). Select a month and click Round, or press Alt+R.',
      'Results back ticks itself when the lab’s results are imported, with the lab and job number from the file. A report sent covering the month counts as the results sent.',
      'The month’s colour follows: under way once anything is recorded, done (green) once the results are sent. A strip along the foot of the month shows how far the round has got.',
      'Overdue rounds are outlined in red and listed: results late from the lab, results back but not sent on, or planned and not sampled. The time allowed is in Settings → Sampling rounds.',
      'Rounds in progress are listed on the calendar and each project’s Schedule tab, and the dashboard’s actions include them. “Results sent” can be ticked straight from the dashboard.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-19',
    title: 'Version numbers',
    items: [
      'EnviroDB now has a version number, shown at the foot of the menu. Click it for what’s new.',
      'Reports, Excel files and backups record the version that made them.',
      'When a new version is published, EnviroDB offers to reload. If someone in your workspace is on a newer version, it tells you.',
      'Everything so far: imports from Hill Labs, ALS, Linnaeus and Analytica (Excel, CSV, PDF); consent limits, triggers and guideline checks; graphs; the monitoring calendar; PDF and Word reports from your own templates, with Word-native captions, cross-references and contents; Quick check; the site map; and the shared workspace folder.',
    ],
  },
];

export const APP_VERSION = RELEASES[0].version;
