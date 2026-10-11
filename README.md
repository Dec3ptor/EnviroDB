# EnviroDB

**Environmental monitoring, consent compliance and reporting – in your browser.**

EnviroDB is a free, open-source web app for routine consent compliance monitoring.
It runs entirely in the browser and is hosted on GitHub Pages.

- **Import** Hill Labs Excel results, your existing monitoring master spreadsheets
  (dates down the rows, analytes across the columns, one sheet per site, units rows,
  guideline rows…) or long tables. Sites and analytes are matched automatically, and
  the matches are remembered for next time.
- **Set up projects** with monitoring sites, consent limits and trigger levels, sampling
  frequencies and reporting due dates.
- **Check compliance** right after import. The supported rule types are:
  - limits on each result (maximum, minimum, or a range such as pH 6.5–8.5)
  - change from an upstream/background site (e.g. turbidity increase > 20 %)
  - statistical limits (annual median, 95th percentile, rolling windows)
  - consecutive exceedances
  - comparison against whole guideline sets

  Non-detects are handled conservatively, and metals guideline values can be
  hardness-modified using the measured hardness.
- **Browse, sort and filter data.** Click a column to sort (e.g. highest TSS first), filter by
  value (TSS > 100, zinc not detected…), show only samples with exceedances, search lab jobs
  and notes, and export exactly what you see to Excel, CSV or Word.
- **Compare with guidelines.** Built-in values are ANZG (2018) / ANZECC (2000) freshwater
  and marine toxicant values at 99/95/90/80 % species protection, the ANZECC NZ physical and
  chemical stressor values, and selected DWSNZ (2022) MAVs. You can also add your own
  sets, such as site-specific trigger values, or import one from CSV/Excel. The Guidelines page
  can show concentrations in g/m³, mg/L or µg/L (it remembers your choice); comparisons always
  convert units automatically.
- **Graph** any parameter by site, with guideline and consent-limit lines. Graphs export
  as high-resolution PNGs, can be copied straight into Word, or exported all at once to a
  Word document.
- **Report** from customisable block-based templates (title page, automatic summary,
  compliance table, exceedances with your follow-up notes, results tables with highlighting,
  statistics, graphs, site and sampling tables, and your own text with `{{placeholders}}`).
  Reports export to **PDF** and **Word**.
- **Review the latest results at a glance.** Each project's overview shows the latest sample at
  every site (or any recent month) with exceedances highlighted, values that are unusual for that
  site marked ▲/▼, and the previous result on hover.
- **Track deadlines.** The dashboard shows upcoming reports, sampling rounds still to do,
  recent exceedances and the status of each project. Deadlines can be exported to Outlook (.ics).
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

## Where is the data stored? (the "database")

GitHub Pages only serves static files, so it can't run a server database.
EnviroDB keeps its database **inside your browser** (IndexedDB), which has some
advantages:

- **Private.** Client data never leaves your computer. Nothing is uploaded, and files
  are read locally.
- **Fast and offline.** There's no server to wait for.
- **Free.** There's no hosting, accounts or subscriptions.

Because the data lives in one browser on one computer, keep a copy:

1. **Autosave to a file** (Settings & backup → *Choose autosave file…*). Every change is
   written to a `.json` file you pick. Put it in a OneDrive / SharePoint / Teams folder and
   it's backed up and available on another computer (open it with *Restore…*). This needs
   Microsoft Edge or Google Chrome.
2. **Download a backup** at any time, and restore or merge it later.
3. **Share a single project** with a colleague using the project menu → *Download project file*.
   They open it from the Projects page.

If you later want a shared multi-user database, the storage layer can be connected to a
hosted database (e.g. Supabase, Firebase or an Azure service). Client data would then be
stored by that provider, so check with your IT / data-governance team first.

## Getting started

1. Open the site. Choose **Load demo project** to explore with synthetic data, or **New project**.
2. In the project's **Setup** tab, add your monitoring sites (paste a list with *Add several*).
3. **Import results**: drag in a Hill Labs Excel file or your master spreadsheet. Try the
   example files on the import page first.
4. On the **Compliance** tab, add consent limits and triggers (presets are included, e.g.
   pH range, change from upstream, NPS-FM nitrate / ammonia bottom lines).
5. On the **Schedule** tab, add reporting obligations (e.g. annual report due 30 September for
   1 July – 30 June) and sampling schedules (e.g. monthly at SW1–SW3).
6. On the **Reports** tab, pick a template and period, add your commentary, and download PDF or Word.

### Import formats

| Layout | Example | Notes |
| --- | --- | --- |
| Lab certificate (samples across, analytes down) | Hill Labs Excel results | Detects the `Sample Name` / `Lab Number` rows, units column and section headings (e.g. *Heavy metals, dissolved*). Sampling dates come from a *Date Sampled* row, or from the sample name (`SW1 12-Mar-2024 10:30 am`). |
| Monitoring spreadsheet (one row per sample) | Master sheets | Header row, optional units row, date (and time) columns, and the site from a column, the sheet name or a fixed value. Guideline / statistics rows without a valid date are skipped automatically. Dates-across-columns sheets are supported too. |
| Long table (one row per result) | LIMS / database exports | Columns such as Site, Date, Analyte, Result, Units, Detection limit. |

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

## Deploying to GitHub Pages

The repository includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that tests,
builds and publishes the site whenever `main` changes.

1. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Merge to `main`, or run the *Deploy to GitHub Pages* workflow manually from the Actions tab.
3. The site appears at `https://<your-user>.github.io/EnviroDB/`.

The build uses relative paths and hash-based routing, so it works under any repository name.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + integration tests (Vitest)
npm run build      # type-check and production build into dist/
npm run samples    # regenerate the synthetic example import files in public/samples/
```

Tech: React 18, TypeScript, Vite, Mantine UI, Dexie (IndexedDB), SheetJS (Excel import), ECharts,
pdfmake (PDF), docx (Word) and ExcelJS (styled Excel export).

```
src/
  data/        built-in parameters (analyte dictionary), guideline sets, report templates
  db/          IndexedDB schema, CRUD, backup/restore/autosave, demo project
  lib/         units, values, dates, statistics, matching, guidelines, compliance engine, schedules
  importers/   workbook reading, lab-certificate / master-sheet / long-table parsers, import commit
  charts/      ECharts time-series builder and PNG rendering
  reports/     report document model, builder, HTML preview, PDF and Word renderers, Excel export
  pages/       dashboard, projects, project tabs, import wizard, guidelines, templates, settings
tests/         unit and integration tests (fake IndexedDB)
public/samples synthetic example files (one in a Hill Laboratories certificate layout)
```

All example and demo data is synthetic.
