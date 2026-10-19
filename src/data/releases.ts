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
