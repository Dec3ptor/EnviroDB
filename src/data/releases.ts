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
    version: '1.16.0',
    date: '2026-10-20',
    title: 'Printable field codes',
    items: [
      'Project ⋯ → Printable field codes makes a PDF of QR codes to take into the field: the project’s code (a cover page with how to use them and the sites) and a code for each site – cards (4 a page, to laminate), labels (8 a page) or a page each. They hold no dates, so print them once for every round.',
      'Scan the project’s code to open the day’s field sheet with all its sites. Scan a site’s code at the site and it opens that site with the time filled in and the phone’s location recorded – and says how far you are from the site’s recorded location, warning when it looks like the wrong site.',
      'Sites scanned one after another make one sheet for the day (the same sheet as Field sheet for a phone, so the two mix); last time’s readings come from what the phone recorded there before.',
      'In EnviroDB field: Scan a printed code, with the phone’s camera, without leaving the app.',
      'Options: the sites, readings to take, what to note, the layout, what to fill in when a site’s code is scanned, and what’s printed beside each code. The codes are kept small so a scuffed or laminated print still scans, and the PDF is previewed before you download it.',
      'Directions and notes are left out of the codes unless you ask: anyone who scans a code can read what it holds.',
    ],
  },
  {
    version: '1.15.1',
    date: '2026-10-20',
    title: 'Trigger lines you can tell apart',
    items: [
      'On graphs, each trigger line has a colour of its own instead of all being amber: the main trigger amber, then indigo, teal and plum (Trigger 1 before Trigger 2, and a trigger set for one site apart from another’s). Each keeps its own dash pattern too, for grey-scale print.',
      'Limits stay red, so red always means a consent limit; two limits on one graph are told apart by their dashes. A second guideline set is drawn in a lighter grey than the first.',
      'The colours were checked so they stay apart for colour-blind readers, in light and dark mode. Report graphs, Word exports and client data packs use them too.',
    ],
  },
  {
    version: '1.15.0',
    date: '2026-10-20',
    title: 'Big master spreadsheets: every analyte, and quicker',
    items: [
      'Master sheets with a row of categories over the names (e.g. “Dissolved Metals” and “Total Metals”, often merged across the columns) are read with it: the two “Zinc” columns go to Dissolved Zinc and Total Zinc instead of one hiding the other. The Layout step shows the row it found (Category row) and lets you change it.',
      'The same name twice with nothing over it: both columns are kept, told apart by their column letter, for you to match on the analytes step.',
      'Analytes only started late in a sheet (empty for the first years) are found, and the whole of each column is read.',
      'Merged cells: a site or category written once over several rows or columns applies to all of them; a note merged across a row of results isn’t copied into every column. A site written once over its rows applies to the rows under it, and the import says how many.',
      'Laying out a sheet of thousands of rows and dozens of analytes takes about a second (it could take 15 seconds or more).',
      'Saving a big file shows how far it has got (Saving results… 40,000 of 84,600), and the QA/QC checks afterwards take seconds rather than a minute or more. Everything in the file is still saved together, or not at all.',
      'Names remembered from a file are saved once each, and a bare “Zinc” whose category chose dissolved or total isn’t remembered – it would have overruled the category next time.',
      'A plain “Arsenic” is no longer taken for acid-soluble arsenic: its short name is now “As (acid sol)”.',
    ],
  },
  {
    version: '1.14.0',
    date: '2026-10-20',
    title: 'Acid-soluble metals, and importing again over a mistake',
    items: [
      'Acid-soluble metals (unfiltered, acidified but not digested) are parameters of their own – Acid Soluble Zinc and so on – rather than filed as total. Lab sections headed “acid soluble” are read as such.',
      'Dissolved also goes by “soluble” and “filtered” (the filtered fraction): the analytes step shows “Soluble Zinc → Dissolved Zinc”.',
      'A name you match to another parameter on import now moves to it, so the old match doesn’t come back next time.',
      'New on the import’s last step: Clear out earlier results for these samples first – for when an earlier file went in wrong. What earlier files put on those sites and days goes; field readings and results typed in stay.',
      'QA/QC: dissolved over acid soluble, and acid soluble over total, are flagged like dissolved over total.',
    ],
  },
  {
    version: '1.13.0',
    date: '2026-10-19',
    title: 'Share report templates',
    items: [
      'Report templates → Share… (or a template’s ⋯ → Share as a file…) saves the templates you pick as a file to send to anyone using EnviroDB outside your workspace.',
      'Import on the Report templates page reads such a file, shows what’s in it and anything changed to fit your workspace, and adds the templates you tick – nothing you have is changed.',
      'Analytes and guideline sets are matched by name; any your workspace doesn’t have are left out (and named). Sites and consent rules picked for the sender’s projects are cleared. Signature pictures are left out unless the sender ticks to include them.',
    ],
  },
  {
    version: '1.12.0',
    date: '2026-10-19',
    title: 'Send field results straight to the computer',
    items: [
      'On the computer: project ⋯ → Receive from a phone shows a code and turns on the webcam. On the phone: Send the results → Send to the computer, scan the code, then hold the phone up to the webcam. No file to save or upload.',
      'Where the phone and computer can reach each other over Wi-Fi, everything goes straight across in a second or two, photos at full size.',
      'Where the network keeps them apart (office networks often do), the phone flashes the results as a stream of QR codes the webcam reads: the readings in a second or two, then the photos made smaller (a few seconds each). It remembers a network where Wi-Fi didn’t work and goes to the flashing code sooner.',
      'Sealed with a key that’s only ever on the computer’s screen: only that computer can open the results, and any change on the way stops them opening. No server or internet is used.',
    ],
  },
  {
    version: '1.11.1',
    date: '2026-10-19',
    title: 'Clearer trend likelihoods',
    items: [
      'Trends tab and report trend tables: the likelihood is now the chance of the direction the trend names – “Likely degrading · 80% degrading”, not “20% improving”, which said the same but read as if it contradicted it.',
      'When one result’s high detection limit makes the trend test and Sen’s slope point different ways, the trend now says so (and marks the size ~ rough) – check the results below detection.',
    ],
  },
  {
    version: '1.11.0',
    date: '2026-10-19',
    title: 'Choose the app’s colour',
    items: [
      'Settings → App colour: pick the colour of EnviroDB’s buttons, links and highlights (a swatch, the picker or a hex code). It’s yours – colleagues choose their own – and Back to teal undoes it.',
      'Ticks, “saved” badges and other signs that something is done stay green whatever the colour. Reports and data packs keep the colours set in their template and pack.',
      'A light colour gets black writing on its buttons, and a darker shade of it for links and the chosen tab, so they stay readable.',
    ],
  },
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
