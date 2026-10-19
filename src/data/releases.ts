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
    version: '1.10.0',
    date: '2026-10-19',
    title: 'Field mode for phones',
    items: [
      'Make a field sheet for a sampling round (project ⋯ menu → Field sheet for a phone): the sites, the readings to take, last time’s readings, and weather, flow, appearance and photos to note.',
      'Scan its QR code with the phone (or open the link or the sheet’s file): EnviroDB field opens on the phone, without the team’s shared folder, and keeps working with no signal.',
      'At each site: the time, the readings (with a warning for a likely slip, or a big change from last time), what was seen, notes, the location and photos – kept on the phone as you go.',
      'Send the results as a file to the team’s Inbox folder in OneDrive (or by email): EnviroDB picks it up and adds each site’s readings to the day’s sample – the lab’s results for the day join it – with what was seen in its notes, photos in the shared folder, and the round marked sampled.',
    ],
  },
  {
    version: '1.9.0',
    date: '2026-10-19',
    title: 'Rainfall and flow',
    items: [
      'Add a rain gauge’s or flow recorder’s records to a project (Setup tab) from its data file – a council’s export, NIWA’s CliFlo, a logger’s CSV or a spreadsheet. EnviroDB finds the dates and readings and keeps daily values: rainfall the day’s total, flow and level the day’s mean and highest.',
      'Show it behind the graphs on the Graphs tab: daily rainfall as bars from the top, flow or level as a line, on its own scale; hover a result for the rain that day.',
      'In reports too: a graph section can show the project’s rain gauge (or flow) behind its graphs – and issued reports keep the records they showed.',
      'Each sample shows how wet it was: the rain on the day and in the 3 days before.',
      'The client data pack can show it behind its graphs, with a switch to turn it off.',
    ],
  },
  {
    version: '1.8.0',
    date: '2026-10-19',
    title: 'Client data pack',
    items: [
      'A Data pack tab on each project: one HTML file with the project’s data for the client – a summary, the sites on a map (with an aerial photo), interactive graphs, the latest results, consent compliance and every result.',
      'Set how it looks – title, introduction, colour, logo, light or dark – and what the client sees and can do: the sites, analytes and dates in it, the sections and their order, limits and guideline values, choosing sites and dates, downloading the data.',
      'See it as the client will, on a computer or a phone, as you set it up.',
      'It opens in any browser, offline, and sends nothing anywhere: its security policy lets it run only its own script and connect to nothing.',
      'Each pack is numbered (v1, v2 …), with the date and the EnviroDB version that made it.',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-10-19',
    title: 'Issued reports, locked',
    items: [
      'Issue a report from the Reports tab: the files are downloaded to send and the report is locked as issued – Rev 0, Rev 1 … on the title page and in the file name.',
      'What it was built from is kept – results, limits, layout, commentary, figures – so it can be downloaded again exactly as issued, and a fingerprint of each file: “Check a file” says whether a file is one issued, unchanged.',
      'Kept small: compressed, split by site and year, and each part kept once – shared by every revision and later report. A revision usually adds a few KB.',
      'What has changed since it was issued – lab re-issues, late results, results left out, limits, layout – is shown with the report, and results in its period are flagged.',
      'Revise a report with a reason; earlier revisions stay as issued, with what changed between them. Fill-ins [revision] and {{revision}}.',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-10-19',
    title: 'Compliance register',
    items: [
      'A compliance register on the Compliance tab: every consent condition – limits, monitoring, reporting, notification, management – graded for the period as councils do: full compliance, low risk, moderate or significant non-compliance.',
      'Make it from the project’s rules, sampling schedules and reports, or paste the consent’s conditions and each numbered condition becomes one, linked to its rules.',
      'For each condition EnviroDB says what it found – limits exceeded, triggers to follow up, samples missed, reports late – and suggests a grade; you grade it with your reasons and the action taken.',
      'Who graded it and when are kept, with every earlier grade: an audit trail. The overall grade is the worst of the conditions.',
      'A new report section, Compliance register, also in the Compliance tab’s Word download.',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-10-19',
    title: 'NPS-FM attribute bands',
    items: [
      'An NPS-FM tab on each project: each river and lake site graded against the National Objectives Framework bands – E. coli, nitrate and ammonia toxicity (ammonia adjusted to pH 8), periphyton, visual clarity by sediment class, DRP, MCI/QMCI/ASPM, and lake nitrogen, phosphorus and phytoplankton.',
      'Click a band for the statistics behind it; bands below the national bottom line are flagged, and grades on too few results are marked provisional.',
      'Set how each site is graded: river or lake, suspended sediment class, periphyton class, lake type, swimming site.',
      'A new report section, NPS-FM attribute bands, and the bands in Copy for AI input. New parameters: periphyton chlorophyll a, MCI, QMCI, ASPM.',
      'The NPS-FM is under review: check the version in force, and the bands against it, before relying on a grade.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-10-19',
    title: 'Trends and statistics',
    items: [
      'A Trends tab on each project: is each site improving or degrading? The Mann-Kendall test (seasonal Kendall when results vary with the season) with Sen’s slope, as LAWA does it – very likely improving, likely improving, indeterminate, likely degrading, very likely degrading – with the change a year and its likelihood.',
      'Results below detection are handled properly, and it says why a trend can’t be assessed when there are too few results.',
      'Upstream and downstream: results taken the same day compared – medians, the difference, how often downstream is higher, and whether the difference is significant (Wilcoxon signed-rank test).',
      'Trend lines on the Graphs tab and report graphs; notable trends on the project Overview; trends and comparisons in Copy for AI input.',
      'New report sections: Trends, and Upstream vs downstream.',
    ],
  },
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
