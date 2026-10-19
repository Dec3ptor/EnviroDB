# EnviroDB

**Environmental monitoring, consent compliance and reporting – in your browser.**

EnviroDB is a free, open-source web app for routine consent compliance monitoring.
It runs entirely in the browser and is hosted on GitHub Pages. A team works together through a
**shared workspace folder** (SharePoint, OneDrive or a network drive): everyone's changes are saved
there as they work and show up for the others within seconds.

- **Import** lab results from Hill Labs, ALS and Linnaeus – Excel, CSV or the PDF reports, several
  files at once or the zip they came in – your existing monitoring master spreadsheets
  (dates down the rows, analytes across the columns, one sheet per site, units rows,
  guideline rows…), monitoring-database exports or long tables. Sites and analytes are matched
  automatically, and the matches are remembered for next time. Results from different labs for the
  same site and day (field pH and conductivity from one, the chemistry from another) become one sample.
- **Set up projects** with monitoring sites, consent limits and trigger levels, sampling
  frequencies and reporting due dates.
- **Check compliance** right after import. The supported rule types are:
  - limits on each result (maximum, minimum, or a range such as pH 6.5–8.5)
  - change from an upstream/background site (e.g. turbidity increase > 20 %)
  - statistical limits (annual median, 95th percentile, rolling windows)
  - consecutive exceedances
  - comparison against a guideline set – every analyte in it, or only the analytes you choose
    (e.g. dissolved copper and zinc against ANZG 95%)

  A limit, statistical limit or consecutive rule can also take its value from a guideline set
  instead of a number you type: choose the analyte, then *A guideline value* and the set (e.g. the
  annual median of dissolved zinc against its ANZG 95% value). The value follows the set, shows on
  graphs and in report tables, and the consent set-up with AI reads these too.

  Non-detects are handled conservatively, and metals guideline values can be
  hardness-modified using the measured hardness (for each sample's own result).

  To see every consent limit and trigger at once, switch the Compliance tab to *Limits & triggers*:
  a row per parameter and level, a column per site, each value coloured by how that site did in the
  period (red exceeded, with how many times; amber check the detection limit; green complied; grey no
  results). Show limits only or triggers only; hover a value for its rule, condition and required
  action and the latest exceedance; click it to change the rule. Changes from an upstream site and
  comparisons with a whole guideline set are listed under it. The tab's *Word* download includes
  the same table.
- **Browse, sort and filter data.** Click a column to sort (e.g. highest TSS first), filter by
  value (TSS > 100, zinc not detected…), show only samples with exceedances, search lab jobs
  and notes, and export exactly what you see to Excel, CSV or Word. Analytes are always listed in
  the same order – field measurements, laboratory physical, general chemistry, nutrients,
  microbiology, dissolved metals, total metals, then hydrocarbons and the rest – and a switch shows
  just those in the consent (with limits, triggers or other conditions, or required by a sampling
  schedule), only those with limits, or only those with triggers.
- **Compare with guidelines.** Built-in values are ANZG (2018) / ANZECC (2000) freshwater
  and marine toxicant values at 99/95/90/80 % species protection, the ANZECC NZ physical and
  chemical stressor values, and selected DWSNZ (2022) MAVs. You can also add your own
  sets, such as site-specific trigger values, or import one from CSV/Excel. The Guidelines page
  can show concentrations in g/m³, mg/L or µg/L (it remembers your choice); comparisons always
  convert units automatically. With several guideline sets chosen, each set's exceedances have a
  colour of their own (amber, blue, green, pink, teal) in tables, Excel exports and reports, with a key.
- **Graph** any parameter by site, with consent limits (solid red), triggers (dashed amber) and
  guideline values (dotted grey) drawn as lines and named in a key below the graph. Graphs export
  as high-resolution PNGs, can be copied straight into Word, or exported all at once to a
  Word document.
- **Put the sites on a map.** A project's *Map* tab shows its monitoring sites on LINZ aerial
  imagery (or street or topographic maps), labelled in the colours the graphs use. Choose a site's
  *Place* and click where it is, or click the map and pick the site for that point (or *New site
  here*); drag a pin to move it, and undo any change from its notice. Search for a place, or type
  latitude and longitude or NZTM coordinates. Locations are kept as NZTM2000 easting/northing (the
  same numbers as in *Setup*), and the sites download as GeoJSON for QGIS/ArcGIS or KML for Google
  Earth. The map needs the internet for its imagery; only the area you look at is asked for, and a
  place search sends just what you type to OpenStreetMap's search.
- **Report** from customisable block-based templates (title page with your logo, automatic
  summary, compliance table, exceedances with your follow-up notes, results tables with
  guideline and consent limit / trigger columns to compare against and highlighting,
  statistics, graphs, site and sampling tables, and your own text with `{{placeholders}}`).
  Reports export to **PDF** and **Word**. The preview shows the actual PDF pages, portrait
  and landscape, so what you see is what you download.
- **Quick check – no project needed.** Drop lab results (Excel, CSV, PDF, or a zip) on *Quick check* and
  see them straight away against the guideline sets you choose, exceedances highlighted in each set's
  colour, with a count per set and a list of analytes EnviroDB couldn't match. Nothing is saved: download
  the table to Excel or a short Word / PDF report, or *Make a project of it* to keep the results. The
  Word / PDF report follows the *Quick check* template – change it with the pencil beside the layout
  list (its sections, header and footer, page), or pick another of your templates. In it, the file's
  name is the project's ([project]) and its lab job the project number ([project code]); tables
  without guideline sets of their own use the sets chosen on the page.
- **Templates for every kind of report – your own, easily.** *Report templates* groups them: monitoring
  reports, letters, management plans, site investigations, ecology and others. *New template* starts one
  from a blank page, a starter (a **management plan** with the monitoring programme, trigger–action–response
  plan and reporting tables filled in from the project; a **site investigation report** for contaminated
  land; an **ecology survey report**), or **from a document of yours** – a Word report, plan or letter
  you've written before, or a PDF of one: its headings become the template's, its text the starting text
  for each report, and the tables, graphs and summaries EnviroDB makes from the data go under the headings
  that call for them (you check and change which). Built-in templates you don't use can be deleted (for
  everyone in the workspace) and put back with *Restore built-ins*.
- **Build templates by dragging sections in.** The template editor has a palette of sections – text and
  layout, sections from the results, compliance, programme and plans – that stays in view: drag one into
  place, or click it to add it after the section selected. Among them: **Space** (blank space as tall as
  you like), **Calculations** (a table or list of values worked out from each report's period – the
  median nitrate-N at DS1, the highest TSS, how many results were over a limit), **Monitoring
  programme**, **Trigger–action–response plan** and **Reporting requirements** (from the project's
  schedules, consent rules and reporting obligations). *Insert a calculation* puts a value into text –
  `{{calc:median:no3-n:DS1}}` – so a sentence reads "the median nitrate-N at DS1 was 0.82 mg/L". On a
  project's Reports tab (or previewing a template with a project), *Insert a calculation* and the
  Calculations section offer only that project's sites and the parameters it has results for, by group –
  as do the sections' own parameter choices (*Only these*, *All except*).
- **An automatic summary, and a draft to edit.** The *Automatic summary* section describes the sampling,
  the monitoring programme, compliance and guideline exceedances, and now compares the period with the
  one before (samples, limits exceeded, and whether the key parameters' medians were higher, lower or
  similar). On the Reports tab, *Draft from the results* writes the same sentences into a commentary
  box, for you to edit.
- **Report the latest monitoring round.** The *Monitoring round summary* template is titled by the
  round's month ("Monitoring results – September 2026") and opens on the latest round; earlier rounds
  are in the period list. Each site's result sits beside its previous result, the change, the earlier
  median and usual range (5th–95th percentile), with unusual and record values noted, plus consent and
  guideline columns – choose the columns and how many years back to compare. Graphs shade the round.
- **Choose the sites a report covers.** On the Reports tab, tap sites in or out, or pick *Groundwater
  only* (or any other site type), so a groundwater report has no effluent results. Every table, graph,
  compliance check and summary follows, the title page lists the sites covered, and the choice is
  remembered for that reporting obligation. Each table, graph, statistics or rounds section can also
  choose its own sites and parameters – *All*, *Only these* or *All except* – e.g. a table of just
  water levels above the main results table, which leaves water levels out, or a *Results vs
  previous rounds* table without the discharge. On the Reports tab, *Edit layout*, open the section
  (⋯ → *Duplicate* makes a second one); sites are chosen there, parameters there or in the template.
  Badges in the section list show each choice ("only GWL", "not DP1").
- **Pick up where you left off.** Each tab keeps how you set it up – the graphs chosen and their
  options, the data filters and sort, the report's template, period and layout tab, the compliance
  and overview periods – when you go to another tab and come back, and next time in this browser.
  Each project keeps its own; the usual periods (*Last 12 months*, *This reporting year*) move on
  with the date.
- **Sign off reports.** A *Signatures* section puts the people signing side by side – role,
  signature, name and the lines under it (job title, company). Click a person's signature box and
  paste: an image, or a whole signature copied from an email or a Word document (the image, name and
  lines are filled in; a sign-off table copied from an earlier report adds everyone in it). You can
  also drop or upload an image; blank paper around a signature is trimmed off. Set your own signature
  once in Settings and every report you sign as *Me* uses it. Without an image, a line is left to sign
  by hand. The built-in templates end with a sign-off (people without a name are left out).
- **Write letter reports on your letterhead.** The *Annual report (letter)* and *Monitoring event
  report (letter)* templates are written as letters: date, who it's to, a bold subject, your reference
  and greeting (who a project's letters go to is saved with the project), then site-by-site tables of
  this round's results beside the previous rounds and the site's limits and triggers, with a comment on
  each result ("Increase – Compliant", "Decrease – Exceedance") and exceedances in red. Under each site's
  table is a summary drafted from its results ("Nitrate-N (1.92 g/m³) continues to exceed the trigger…")
  that you edit with the rest of the report's commentary. There's also a trigger levels table
  (a parameter per row, a column per site), consent conditions quoted with "> " lines, a closing line
  ("Kind regards,") above your signature, and an attachments / CC list.
- **Use your company's letterhead.** In *Settings → Letterhead*, upload your company's Word letter
  template – or any letter or report written on it (.docx or .dotx). EnviroDB reads its logo, the
  address in the first page's footer, the page numbers, margins, fonts and heading colour. Word
  downloads are built on the file's own header and footers, exactly as they are in Word; PDFs and the
  preview draw them. Only the letterhead is kept – none of the document's text – and it is shared
  with everyone in the workspace. You can also set a letterhead up by hand (logo and footer lines),
  and any template can be switched to print on it.
- **Add figures.** A *Figures* section takes your own pictures – site photos, plans, graphs from
  Excel. Drop them on the box, choose them or paste them; caption them and drag them into order.
  Choose 1–4 to a row and their size, and whether each is numbered (Figure 1, Figure 2 …), the group
  shares one number with (a), (b) … under the pictures, or none – and call them Figures, Photos,
  Plates or anything else (each counts on its own). Give a picture a name and write `{{fig:name}}` in
  your text for its number, e.g. "see Figure 3(b)"; tables work the same with `{{table:name}}`, and the
  numbers stay right when sections move. Pictures for one report go under *Figures for this report* on
  the Reports tab; a site plan used every time goes in the section's own settings.
- **Captions or headings, and references you can click.** Each table, graph or figures section is
  labelled with a numbered caption ("Table 3. Monitoring results", the default) or a heading of its
  own, not numbered – set *Labelled with* in the section (the numbering carries on without it). In any
  text or commentary box, *Insert a reference* lists the report's tables and figures: pick one and its
  number goes in where you're typing ("see Table 3"), naming the table if it hasn't a name yet. In the
  PDF and Word files each reference is a link – click it to go to the table or figure – and a
  reference to a section under a heading gives the heading.
- **Word files you can carry on in Word.** The Word download is built the way Word builds a report:
  captions are Word's own (Insert Caption – "Table" and a caption number field), references in the
  text are Word cross-references (Ctrl+click to follow them), and numbered headings use Word's heading
  numbering. Add, move or delete a table, figure or heading in Word, select all and press F9 (or
  print), and the numbers and references update themselves; Insert → Cross-reference lists the report's
  tables and figures to refer to.
- **Write your own captions and notes.** Every table and graph has a *Caption* box (on the Reports tab,
  *Edit layout*, open the section) holding the wording it uses now, e.g. "Monitoring results – [site
  code] ([site name])". Change any of it; the words in square brackets are filled in for each table:
  [site], [site code], [site name], [site type], [date] (the site's sample), [period], [period name],
  [project], [project code], [consent] – and on graphs [parameter], [unit], [sites] and [dates]. Type
  "[" for a list of them, or click one under the box; an example underneath shows what the caption
  will say. *Back to the usual wording* undoes it. Under any table, *Write my own notes* starts from the
  notes it has now ("“<” indicates a result below the laboratory detection limit." …) for you to
  change, add to or delete – a line each.
- **Calculation columns in tables.** A results table or a *Results vs previous rounds* table can add
  columns after the results – *Add a calculation column* – for each parameter's mean, median, minimum,
  maximum, 95th or any other percentile, total, number of results or geometric mean. Each is worked out
  from the results in the table (or the rounds shown), the report period, the last few years, or all
  results to the report's end, at the table's sites; give it your own heading or keep "Mean", "95th
  %ile (5 yr)" …. In a table with samples down they're rows at the foot. A note under the table says
  what each is worked out from, with non-detects and percentiles treated as set for the project.
- **Choose the earlier rounds.** A *Results vs previous rounds* table shows the last 1, 2 … up to 24
  rounds beside this one, or the rounds you choose by date (each site's sample on the day, or the
  nearest within two weeks; "–" where a site wasn't sampled). Many rounds shrink the table to fit – a
  landscape page gives them more room. Each result's comment still says whether it complies when
  there's no earlier result ("No earlier result – Compliant"), and gives the change since the last
  result shown when the round before has none ("Increase since Apr-26 – Compliant").
- **Numbers in full.** Results are written out in full everywhere – 0.00005, never 5e-5 – in the
  app, the reports and the Excel download. In PDF and Word tables a number too wide for its column is set
  a little smaller so it stays whole on one line, rather than breaking or spilling out.
- **Headers and footers.** Each template has a header and a footer with left, centre and right text –
  in the template editor, or on the Reports tab under *Edit layout → Header and footer* for one
  project's report. Type "[" to fill in [page] of [pages], [project], [project code], [period],
  [report], [company], [date] and more; a small page shows how they'll look. Choose whether they go on
  the first page too. On a letterhead they're the letterhead's own, unless you switch on *Add my own
  lines* – then yours go under its header and above its footer, in Word (on the company's own Word
  letterhead) and in the PDF.
- **Choose the look.** Templates are written as a report or a letter, with table headers in the accent
  colour or grey, exceedances shaded or in red text, and headings numbered or not, separately from
  tables and figures.
- **Change a report's layout on the spot.** On the Reports tab, *Edit layout* lets you drag
  sections exactly where you want them (a heading takes its whole section with it, so you can put a
  heading straight above a table), add, duplicate or
  remove sections, graphs and tables, start a section on a new page, and put the whole
  report – or just one section, such as a wide results table – on landscape pages. Graphs
  fill the page width, or sit two per row. Keep the changes for that project, save them as a
  new template to reuse, or discard them.
- **Review the latest results at a glance.** Each project's overview shows the latest sample at
  every site (or any recent month) with exceedances highlighted, values that are unusual for that
  site marked ▲/▼, and the previous result on hover.
- **A monitoring calendar for the whole team – your monitoring spreadsheet, connected.** *Monitoring
  calendar* is laid out like a team's "Schedule All Monitoring" sheet: a row per job with its job code and
  purchase order, the twelve months, then the monitoring schedule details, monitoring notes, annual report
  due, management plan, notes, consents and folder link. Months hold the marks you use (● ▲ ■ R # % @ …, typed
  or picked from the toolbar) and sampling windows (drawn like the sheet's merged "(_____)" cells – select
  the months and click *Window*). Colour cells as the year goes – **done** (green: don't mark it green until
  the results are sent or reported), **currently doing** (yellow) and **cancelled / on hold** (pink) – from
  the toolbar or with Alt+1, 2, 3 (Alt+0 clears); a whole job can be put on hold, and other cells
  highlighted yellow. The plan stays the same from year to year, the colours are kept for each year.
  It works like a spreadsheet: click or drag to select, type to change a cell (Enter edits what's there,
  Alt+Enter for a new line), arrow keys, copy and paste with Excel, Delete, and undo (Ctrl+Z). A note can be
  added to any month. *Import* brings in your existing spreadsheet – its rows, windows and colours – and
  *Excel* downloads the calendar in the same layout. A row linked to a project shows the project's job
  code, PO, consents and folder (changing them on the calendar changes the project's), dots the months its
  results came in, lists its reports due, and can be filled in from the project's sampling schedules
  (a schedule's mark and sampling window are set when editing it). Results in for a month that isn't green
  yet show up in *Actions to take*, with a button to mark it done. Each project's *Schedule* tab shows its
  rows.
- **Your own dashboard.** The dashboard is made of widgets you arrange yourself (*Customise*): drag them
  by their title, resize them from their sides or corners on a fine grid, and make them as small as
  you like – a widget smaller than its contents need shows everything smaller to fit (the *Tt* button
  sets a widget's text size yourself, 60–130%). Turn off *Close the gaps* to leave widgets exactly
  where you put them, gaps and all. Remove the ones you don't need and add others –
  *Actions to take* (reports due, results to send or report – tick them off – sampling still to do,
  exceedances with no follow-up yet), *This month's monitoring*, the *Monitoring calendar*, *Upcoming
  deadlines*, *Reports due*, *Recent exceedances*, *Projects*, *Recent imports*, *My notes* and *Quick
  links*. Your layout is your own; *Reset* goes back to the standard one. The *Monitoring calendar*
  widget shows the job and the months; its *Columns* button adds any of the calendar's other columns
  (job code, purchase order, schedule details, notes, report due, consents…) – your choice for the
  dashboard, separate from the full calendar's. Deadlines can be exported to Outlook (.ics).
- **Set up from consent documents with AI.** Copy EnviroDB's instructions into your AI tool
  with the consent attached, paste the answer back, then check the sites, limits, triggers,
  sampling schedules and reporting dates it found (with the consent wording beside each) and
  import them in one go. Unclear parameters are flagged for you to choose, and the import can be
  undone.
- **Ask an AI tool about your data.** *Copy for AI input* packages a project's results,
  statistics, compliance assessment, consent conditions, guideline values and reporting dates
  as text you can paste into Claude, ChatGPT, Copilot or similar with your question. Ready-made
  requests cover trend tests, upstream/downstream comparisons, data checks and drafting report
  text. EnviroDB doesn't send anything itself, and names can be left out.

## Finding your way around

- **Dashboard** – your own arrangement of widgets: actions to take, this month's monitoring, deadlines,
  exceedances, projects and more. **Monitoring calendar** – the team's monitoring schedule spreadsheet, linked to the projects.
  **Import data** brings in lab results for any project.
- **A project** has tabs for each job: *Overview* (latest results at a glance), *Data*, *Graphs*,
  *Map*, *Compliance*, *Schedule* (reporting dates and sampling rounds), *Reports* and *Setup*. Its main
  action, *Import results*, is top right; less common ones (*Copy for AI input* on a phone,
  *Download project file*) are under ⋯.
- **Library** – reference data shared by every project: *Guidelines*, *Report templates* and
  *Parameters* (the analyte dictionary: names, units and the aliases used in lab files). A parameter
  can be deleted from the library, or removed from one project in its Setup tab (▸ *Display units or
  remove*); you're shown first what goes with it – its results in each project, its consent rules,
  the sampling schedules and guideline sets that name it.
- **Settings & backup** – your name, company, signature and letterhead, the workspace (who's connected)
  and backups. The **Saved** badge top right shows when your changes are in the folder and who else is
  connected.

**Unsaved changes stand out.** A row or card you've changed but not saved turns yellow and its save
button turns orange and pulses until you click it; closing the page with unsaved changes asks first.

Everyday controls are on show. Settings most people leave alone are folded away with a summary of
what they're set to (▸ *Assessment settings* and ▸ *Display units* in Setup, ▸ *Placeholders* in the
template editor), and rarely used actions sit in ⋯ menus. Filters stay on one line: a picker shows
"US1, DP1" or "5 parameters" and opens a popup with every choice laid out in groups (field, physical,
dissolved metals…; sites by type; guideline sets by family) – tick a whole group at once, search by
any words ("zinc", "dissolved metals"; Enter ticks the first match), or use a quick pick such as
*In the consent*, *Limits* or *Triggers*. Nothing changes until *Done*; *Cancel* leaves it as it was.
Parameters, sites and guideline sets are chosen this way everywhere – graphs, data, reports, rules,
sampling schedules and the calendar. The period works the same way: its popup lays out each report's
recent periods (with whether they're submitted or when they're due), the monitoring rounds, the usual
periods, the last six reporting years and dates of your own.

## The shared workspace (where the data is stored)

GitHub Pages only serves static files, so it can't run a server database. Instead, EnviroDB keeps
everything in a **workspace folder** that the whole team can reach – a SharePoint or OneDrive folder
synced to each person's computer, or a shared network drive – with a working copy in each browser
(IndexedDB) so it's fast. Client data goes nowhere else: the folder is only as shared as you make it.

**EnviroDB doesn't open until it's connected to the workspace folder**, so nobody works on a copy
nobody else can see. It needs **Microsoft Edge or Google Chrome on a computer** – phones, tablets,
Firefox and Safari can't work with folders from a web page.

### Setting it up

1. One person makes an empty folder for it, e.g. *EnviroDB workspace* in the team's SharePoint, and
   shares it with the team.
2. Everyone syncs it to their computer (in SharePoint: *Sync* or *Add shortcut to My files*). In
   OneDrive, right-click the folder → **Always keep on this device**, so the latest files are always
   there.
3. Each person opens EnviroDB, enters their name and chooses the folder. The first person is asked to
   start a workspace in it; everyone after that joins it. Anything already in a browser can be added to
   the workspace (or left out) when it first connects.
4. Next time, EnviroDB reconnects by itself – or after one click if the browser asks for permission
   again (choose *Allow on every visit* to skip that).

If the folder can't be reached (the drive is disconnected, the folder was moved), EnviroDB shows a
notice and waits; changes already made are kept and saved as soon as the folder is back.

### Working at the same time

- **Changes appear by themselves.** EnviroDB checks the folder every few seconds (and as soon as you
  come back to the window); colleagues' changes show up on every screen without reloading, with a
  short notice saying who changed what.
- **Different changes to the same thing are both kept.** If you edit a project's consent number
  while a colleague edits its client, both changes stay. Forms save only the fields you changed onto
  the record as it is now, so a colleague's change made while your form was open is never undone.
- **Reports are each person's own.** Your commentary, figures, layout changes and site choices stay in
  your browser (and your own backups); everyone makes their own reports from the shared data.
- **The same thing changed by two people at once:** the later change is kept everywhere, and the
  person whose change was replaced is told ("Bo Jones also changed project … – their later change is
  the one kept"). A deletion wins over changes made to the record at the same time, and you're told
  if something you had just changed was deleted.
- **The same lab file imported by two people** gives one set of samples and results, not two.

### How the folder is organised

```
envirodb-workspace.json          which workspace this is
clients/<person>/client.json     who that is and when they were last connected
clients/<person>/*.json          the changes that person made (projects, sites, results by year …)
backups/EnviroDB backup <date>.json   a copy of everything, made each day (the last ten are kept)
```

Each browser writes only its own files, so OneDrive, SharePoint and network drives never see two
people saving the same file (no "conflicted copy" files) – files can arrive in any order and every
browser still ends up with the same data. Don't edit or delete files in the folder by hand.

### Backups and sharing outside the team

- **Daily copies** are kept in the folder's *backups* folder. **Download a backup** (Settings & backup)
  at any time; *Restore…* opens either kind. Restoring changes the workspace for everyone.
- **Share a single project** with someone outside the team using the project menu → *Download project
  file*. They open it from the Projects page.

Backups hold the projects and data, templates and the settings. A backup you download also holds your
report work (commentary, figures, layout changes and site choices); the daily copies in the folder
don't, as that's each person's own – restoring one leaves yours as it is. The team shares the company
name and letterhead; your name, signature, date format and other preferences are your own and stay in
your browser.

## Getting started

1. Open the site in Edge or Chrome and connect to your team's workspace folder (see above). Choose
   **Load demo project** to explore with synthetic data, or **New project**.
2. In the project's **Setup** tab, add your monitoring sites (paste a list with *Add several*).
3. **Import results**: drag in the lab's files (or the zip from the lab's email) or your master
   spreadsheet. Try the example files on the import page first.
4. On the **Compliance** tab, add consent limits and triggers (presets are included, e.g.
   pH range, change from upstream, NPS-FM nitrate / ammonia bottom lines).
5. On the **Schedule** tab, add reporting obligations (e.g. annual report due 30 September for
   1 July – 30 June) and sampling schedules (e.g. monthly at SW1–SW3).
6. On the **Reports** tab, pick a template and period, add your commentary, and download PDF or Word.
   Use *Edit layout* to reorder sections or put some on landscape pages.

### Import formats

| Layout | Example | Notes |
| --- | --- | --- |
| Lab certificate (samples across, analytes down) | Hill Labs Excel results and CSV exports (`…-SSFC-1.csv`) | Detects the `Sample Name` / `Lab Number` rows, the analyte and units columns and section headings (e.g. *Heavy metals, dissolved*). Sampling dates come from a *Date Sampled* row, or from the sample name (`SW1 12-Mar-2024 10:30 am`, `W1 28-Sept-2026 9:40 am`). The lab's numbered comments (`< 2 #1`) are saved with the sample. |
| Monitoring spreadsheet (one row per sample) | Master sheets | Header row, optional units row, date (and time) columns, and the site from a column, the sheet name or a fixed value. Guideline / statistics rows without a valid date are skipped automatically. Dates-across-columns sheets are supported too. |
| Monitoring-database export | `Sample:` and `Unit:` rows above a `Date, Status, Lab Reference, …` header | The site and units come from the rows above the header, lined up with their analytes even when they're written a column to the left. *Lab Reference* becomes the lab number. Rows marked *Missed*, *Due* or *Waiting* are left out (and counted); samples still *At Lab* are imported with a provisional note that goes when the final results are imported. `No Result` / `Completed` cells, processing dates and the ion balance check are ignored, and 00:00 / 01:00 clock times on dates are dropped. |
| Long table (one row per result) | LIMS / database exports | Columns such as Site, Date, Analyte, Result, Units, Detection limit. |
| ALS results, a row per result | ALS *CSV_Simple* files | The site is the name in *ClientSampleReference* without the number in front (`2026000101 - Upstream` → *Upstream*): the numbers change every round, the names don't. Dissolved and total metals are told apart from ALS's analyte codes (`ICPM_WS_…`, `ICPM_WT_…`). Surrogate recoveries (%) are left out. |
| ALS ESdat files | `NH…_0.csv` / `.xlsx` chemistry files | They only number the samples: drop them with the ALS PDF report (or the ESdat sample file) and the site names and sampling dates are taken from it. The lab's QC (blanks, spikes, duplicates and other clients' samples in the batch) is left out and counted. |
| Linnaeus analysis reports | CSV exports (`2026000101-0106.csv`) | Site and number from *SAMPLE_ID*, date and time from the cell beside it; the *Analytica Laboratories Report* rows (the reference to ALS's report) and empty results are skipped. |
| Lab PDF reports | ALS certificates of analysis, Linnaeus analysis reports, Hill Laboratories certificates | Read from where the words sit on the page: a column per sample (its name and sampling date above or below the lab number), a row per test, the report's sections (e.g. *Elements in Water (Soluble)*). Footnote marks (`ø`, `*`) are dropped. A sample another lab names only by ALS's number (`NH2600001_003`) gets its site from ALS's files. |

Drop **several files at once, or the zip** they came in. When a lab sends the same results as a PDF and
as a spreadsheet, they're taken from the spreadsheet (the PDF still names the samples); the same
file sent twice (CSV and Excel) is read once. Parameters that are new to you – e.g. a leachate's
organics suite – can be added in one go, grouped (hydrocarbons, pesticides, other organics, PFAS).

Results such as `< 0.0010`, `>2420`, `ND`, `NS`, `1,200` and `0.5*` are understood. Units are converted
automatically (g/m³ ↔ mg/L ↔ µg/L, mS/m ↔ µS/cm…). Dates are read day-first (NZ format).
Re-importing a file (or an amended lab report) replaces existing results by default, so nothing is duplicated.
Every import can be undone from the Data tab.

### Guideline values – please check

Built-in guideline values are provided as a convenience and **must be checked against the
current published source** before you rely on them for compliance. ANZG is progressively publishing
revised default guideline values (e.g. boron 2021, which is included; zinc 2024; copper, nickel and
ammonia, which are bioavailability-based). Built-in sets are read-only. Duplicate one to edit it.
Sources are listed on each set.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + integration tests (Vitest)
npm run build      # type-check and production build into dist/
npm run samples    # regenerate the synthetic example import files in public/samples/
```

Tech: React 18, TypeScript, Vite, Mantine UI, Dexie (IndexedDB), the File System Access API (the
workspace folder), SheetJS (Excel import), ECharts, pdfmake (PDF), docx (Word) and ExcelJS (styled
Excel export).

```
src/
  data/        built-in parameters (analyte dictionary), guideline sets, report templates
  db/          IndexedDB schema, CRUD, backup/restore, demo project
  sync/        the workspace folder: change capture (Dexie middleware), clock stamps, merge, files, connection
  lib/         units, values, dates, statistics, matching, guidelines, compliance engine, schedules
  importers/   workbook reading, lab-certificate / master-sheet / long-table parsers, import commit
  charts/      ECharts time-series builder and PNG rendering
  reports/     report document model, builder, PDF preview (pdf.js), PDF and Word renderers, Excel export
  components/  shared UI, including the report sections editor
  pages/       dashboard, projects, project tabs, import wizard, guidelines, templates, settings
tests/         unit and integration tests (fake IndexedDB)
public/samples synthetic example files (one in a Hill Laboratories certificate layout)
```

All example and demo data is synthetic.
