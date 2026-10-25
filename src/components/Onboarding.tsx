// Easing people in: a first-run checklist on the dashboard that ticks itself off, a short tour of where things are,
// and a small ⓘ on each page and project view with two sentences and a link to the manual.

import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { ActionIcon, Anchor, Button, Card, Checkbox, Group, Paper, Popover, Portal, Stack, Text, Title } from '@mantine/core';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconBook2, IconExternalLink, IconHelp, IconX } from '@tabler/icons-react';
import { db } from '../db/db';

const README = 'https://github.com/Dec3ptor/EnviroDB#readme';
const anchor = (slug: string) => `https://github.com/Dec3ptor/EnviroDB#${slug}`;

// ------------------------------------------------------------ this browser's own notes (what's been seen)

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* a private window: shown again next time */
  }
};
const CHECKLIST_KEY = 'edb.checklist.dismissed';
const TOUR_KEY = 'edb.tour.done';
const EXPORTED_KEY = 'edb.firstReport';

/** Call when a report is exported or issued: the checklist's last step. */
export const noteFirstReport = () => write(EXPORTED_KEY, '1');

// ------------------------------------------------------------ the checklist

/** The first things to do in a workspace, ticked off as they're done; shown until they are, or it's closed. */
export function FirstRunChecklist({ onTour }: { onTour: () => void }) {
  const [gone, setGone] = useState(() => read(CHECKLIST_KEY) === '1');
  const counts = useLiveQuery(
    async () => ({
      projects: await db.projects.count(),
      sites: await db.sites.count(),
      samples: await db.samples.limit(1).count(),
      rules: await db.rules.limit(1).count(),
      issued: await db.issues.limit(1).count(),
    }),
    [],
  );
  const firstProject = useFirstProject();
  if (gone || !counts) return null;
  const base = firstProject ? `/projects/${firstProject}` : '/projects';
  const steps = [
    { done: counts.projects > 0, label: 'Create a project', to: '/projects', hint: 'The consent or site you monitor.' },
    { done: counts.sites > 0, label: 'Add its monitoring sites', to: `${base}/setup`, hint: 'Codes as the lab files use them; place them on the map later.' },
    { done: counts.samples > 0, label: 'Import the first results', to: `${base}/import`, hint: 'A lab file or your master spreadsheet.' },
    { done: counts.rules > 0, label: 'Add consent limits and triggers', to: `${base}/compliance`, hint: 'So every import is checked against them.' },
    { done: counts.issued > 0 || read(EXPORTED_KEY) === '1', label: 'Make the first report', to: `${base}/reports`, hint: 'Pick a template, write the commentary, download Word or PDF.' },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (!left) return null;
  return (
    <Card withBorder padding="md" style={{ borderColor: 'var(--mantine-primary-color-3)' }}>
      <Group justify="space-between" align="flex-start" mb={6}>
        <div>
          <Title order={5}>Getting started</Title>
          <Text size="xs" c="dimmed">
            {steps.length - left} of {steps.length} done. Each step takes you to the right place.
          </Text>
        </div>
        <Group gap={4}>
          <Button size="compact-xs" variant="subtle" onClick={onTour}>
            Take the 2-minute tour
          </Button>
          <ActionIcon
            size="sm"
            variant="subtle"
            aria-label="Hide the checklist"
            onClick={() => {
              write(CHECKLIST_KEY, '1');
              setGone(true);
            }}
          >
            <IconX size={14} />
          </ActionIcon>
        </Group>
      </Group>
      <Stack gap={6}>
        {steps.map((s, i) => (
          <Group key={s.label} gap="sm" wrap="nowrap" align="flex-start">
            <Checkbox checked={s.done} readOnly size="sm" mt={2} />
            <div>
              <Anchor component={Link} to={s.to} size="sm" fw={500} c={s.done ? 'dimmed' : undefined} td={s.done ? 'line-through' : undefined}>
                {i + 1}. {s.label}
              </Anchor>
              {!s.done && (
                <Text size="xs" c="dimmed">
                  {s.hint}
                </Text>
              )}
            </div>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

function useFirstProject(): string | undefined {
  const p = useLiveQuery(() => db.projects.where('status').equals('active').first(), []);
  return p?.id;
}

// ------------------------------------------------------------ the tour

interface TourStep {
  /** The element to point at: `data-tour="…"`; none = the middle of the screen. */
  at?: string;
  title: string;
  text: string;
  /** Go here first. */
  path?: string;
}

const TOUR: TourStep[] = [
  { title: 'Welcome to EnviroDB', text: 'Five quick stops: where your projects are, how results come in, what a project’s tabs do, and where to switch more features on. Skip any time.', path: '/' },
  { at: 'nav-projects', title: 'Projects', text: 'A project is a consent or a site you monitor: its sites, results, limits and reports. Recent ones are listed below for a quick jump.' },
  { at: 'nav-import', title: 'Import data', text: 'Drop a lab file or your master spreadsheet here. Sites and analytes are matched for you, and the results are checked against the consent straight away.' },
  { at: 'nav-library', title: 'Library', text: 'What every project shares: guideline values, report templates and the analyte dictionary (names, units, the aliases labs use).' },
  { at: 'project-tabs', title: 'A project’s tabs', text: 'Overview, Data, Graphs, Map, Compliance, Reports and Setup. A tab with more than one view has a switch under the tabs. Setup says what else the project can show.', path: 'first-project' },
  { at: 'nav-settings', title: 'Features and settings', text: 'EnviroDB starts with the essentials. Settings → Team → Features switches on field mode, NPS-FM bands, client data packs and more, for the whole team.' },
];

/** The tour: a card beside each thing in turn. */
export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const firstProject = useFirstProject();
  const step = TOUR[i];
  useEffect(() => {
    if (open) setI(0);
  }, [open]);
  // go where the step is
  useEffect(() => {
    if (!open || !step) return;
    const path = step.path === 'first-project' ? (firstProject ? `/projects/${firstProject}` : undefined) : step.path;
    if (path && location.pathname !== path) navigate(path);
  }, [open, i]); // eslint-disable-line react-hooks/exhaustive-deps
  // find the element (a moment after any navigation)
  useLayoutEffect(() => {
    if (!open || !step) return;
    let tries = 0;
    const find = () => {
      const el = step.at ? document.querySelector(`[data-tour="${step.at}"]`) : null;
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        setBox(el.getBoundingClientRect());
      } else if (step.at && tries++ < 20) setTimeout(find, 100);
      else setBox(null);
    };
    find();
    const onResize = () => find();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, i, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || !step) return null;
  const done = () => {
    write(TOUR_KEY, '1');
    onClose();
  };
  const last = i === TOUR.length - 1;
  // the card: to the right of the element (or below it when there's no room), else centred
  const W = 340;
  let style: React.CSSProperties = { position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)', width: W, zIndex: 1000 };
  if (box) {
    const right = box.right + 12 + W < window.innerWidth;
    style = right ? { position: 'fixed', top: Math.max(12, Math.min(box.top, window.innerHeight - 220)), left: box.right + 12, width: W, zIndex: 1000 } : { position: 'fixed', top: box.bottom + 12, left: Math.max(12, Math.min(box.left, window.innerWidth - W - 12)), width: W, zIndex: 1000 };
  }
  return (
    <Portal>
      {/* the dimming, with a hole for the element (a clip-path: a huge box-shadow spread is clipped by the browser) */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          zIndex: 999,
          pointerEvents: box ? 'none' : undefined,
          clipPath: box ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${box.left - 6}px ${box.top - 6}px, ${box.left - 6}px ${box.bottom + 6}px, ${box.right + 6}px ${box.bottom + 6}px, ${box.right + 6}px ${box.top - 6}px, ${box.left - 6}px ${box.top - 6}px)` : undefined,
        }}
        onClick={box ? undefined : done}
      />
      {box && <div style={{ position: 'fixed', top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12, borderRadius: 10, boxShadow: '0 0 0 3px var(--mantine-primary-color-5)', zIndex: 999, pointerEvents: 'none' }} />}
      <Paper shadow="lg" p="md" radius="md" withBorder style={style} role="dialog" aria-label={`Tour: ${step.title}`}>
        <Group justify="space-between" mb={4}>
          <Text fw={600}>{step.title}</Text>
          <Text size="xs" c="dimmed">
            {i + 1} / {TOUR.length}
          </Text>
        </Group>
        <Text size="sm" mb="sm">
          {step.text}
        </Text>
        <Group justify="space-between">
          <Button size="xs" variant="subtle" onClick={done}>
            {last ? 'Close' : 'Skip the tour'}
          </Button>
          <Group gap={6}>
            {i > 0 && (
              <Button size="xs" variant="default" onClick={() => setI(i - 1)}>
                Back
              </Button>
            )}
            {!last && (
              <Button size="xs" onClick={() => setI(i + 1)}>
                Next
              </Button>
            )}
            {last && (
              <Button size="xs" onClick={done}>
                Done
              </Button>
            )}
          </Group>
        </Group>
      </Paper>
    </Portal>
  );
}

/** Whether to offer the tour by itself: never taken here, and there's something to show. */
export const tourNotTaken = () => read(TOUR_KEY) !== '1';
const OFFERED_KEY = 'edb.tour.offered';
/** Offered once by itself; after that only when asked. */
export const tourToOffer = () => tourNotTaken() && read(OFFERED_KEY) !== '1';
export const noteTourOffered = () => write(OFFERED_KEY, '1');

/** Start the tour from anywhere (the checklist, Settings): the shell listens. */
export const startTour = () => window.dispatchEvent(new CustomEvent('edb:tour'));

// ------------------------------------------------------------ ⓘ on each page

export interface HelpText {
  title: string;
  text: string;
  /** A section of the manual (a GitHub README anchor). */
  more?: string;
}

/** Two sentences on what a page or view is for, and a link to the manual. */
export function HelpTip({ help, size = 'sm' }: { help: HelpText; size?: 'sm' | 'xs' }) {
  return (
    <Popover width={340} position="bottom-start" withArrow shadow="md">
      <Popover.Target>
        <ActionIcon variant="subtle" color="gray" size={size} aria-label={`What is ${help.title}?`} title={`What is ${help.title}?`}>
          <IconHelp size={size === 'sm' ? 16 : 14} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Text size="sm" fw={600} mb={4}>
          {help.title}
        </Text>
        <Text size="sm" mb="xs">
          {help.text}
        </Text>
        <Anchor href={help.more ? anchor(help.more) : README} target="_blank" rel="noreferrer" size="xs">
          <IconBook2 size={12} style={{ verticalAlign: -2 }} /> Read more in the manual <IconExternalLink size={11} style={{ verticalAlign: -1 }} />
        </Anchor>
      </Popover.Dropdown>
    </Popover>
  );
}

/** The help for each page and project view. */
export const HELP: Record<string, HelpText> = {
  dashboard: { title: 'the Dashboard', text: 'What needs doing across your projects: actions to take, this month’s monitoring, deadlines and recent exceedances. Customise arranges the widgets; each person has their own.', more: 'finding-your-way-around' },
  projects: { title: 'Projects', text: 'A project is a consent or a site you monitor. Each holds its sites, results, limits and triggers, schedules and reports.', more: 'finding-your-way-around' },
  calendar: { title: 'the Monitoring calendar', text: 'The team’s year of monitoring jobs, laid out like the spreadsheet, linked to the projects. Record each round as it goes: sampled, to the lab, results back, sent.', more: 'finding-your-way-around' },
  import: { title: 'Import data', text: 'Lab files (Hill Labs, ALS, Linnaeus …), master spreadsheets or long tables. Sites and analytes are matched for you; the results are checked against the consent straight away.', more: 'import-formats' },
  quickcheck: { title: 'the Quick check', text: 'A lab file against the guideline values you choose, with no project and nothing saved: exceedances highlighted, a count per set.', more: 'finding-your-way-around' },
  library: { title: 'the Library', text: 'Reference data shared by every project: guideline values, report templates and the analyte dictionary – names, units and the aliases labs use.', more: 'finding-your-way-around' },
  settings: { title: 'Settings', text: 'You: your name, signature and colours. Team: the features in use, the company, letterhead, workspace and backups. Advanced: the rarely changed.', more: 'finding-your-way-around' },
  overview: { title: 'Overview', text: 'The project at a glance: samples in the period, the latest results against the consent, key trends and the next report due.', more: 'finding-your-way-around' },
  schedule: { title: 'Sampling & reporting', text: 'The project’s rows on the monitoring calendar, its sampling schedules and its reporting obligations – with each report or plan due as a card.', more: 'finding-your-way-around' },
  data: { title: 'Data', text: 'Every result, sorted and filtered; click a row for the sample’s details, comments and QA. Imports are listed below, to review or undo.', more: 'finding-your-way-around' },
  qa: { title: 'QA/QC', text: 'Duplicates that disagree, unusual results and bottles that may have been swapped, for you to accept, leave out or query.', more: 'finding-your-way-around' },
  charts: { title: 'Graphs', text: 'Each parameter over time, one line per site, with the consent limits and guideline values. Customise a graph with the sliders button.', more: 'finding-your-way-around' },
  trends: { title: 'Trends', text: 'Whether each analyte is rising or falling at each site (Mann-Kendall with Sen’s slope), once there are two years of results.', more: 'finding-your-way-around' },
  map: { title: 'the Map', text: 'The sites on aerial imagery. Click the map to place a site, or move one; coordinates are kept as NZTM.', more: 'finding-your-way-around' },
  compliance: { title: 'Compliance', text: 'The consent’s limits, triggers and guideline comparisons as rules, checked on every import. Follow-up lists the exceedances to action; the Register covers every condition.', more: 'finding-your-way-around' },
  npsfm: { title: 'NPS-FM', text: 'Freshwater sites graded against the NPS-FM attribute bands, with the statistics behind each grade.', more: 'finding-your-way-around' },
  reports: { title: 'Reports', text: 'A template, a period and your commentary make the report; download Word or PDF, or Issue it to lock it as sent. The check beside Issue says what’s missing.', more: 'finding-your-way-around' },
  pack: { title: 'the Client data pack', text: 'One HTML file of the project’s data for the client – graphs, a map and tables – set up the way you want them to see it.', more: 'finding-your-way-around' },
  setup: { title: 'Setup', text: 'The project’s details, sites and what it shows; the parameters in it; its history of who did what; archive or delete.', more: 'finding-your-way-around' },
};

/** A heading with its ⓘ beside it. */
export function WithHelp({ children, help }: { children: ReactNode; help?: HelpText }) {
  if (!help) return <>{children}</>;
  return (
    <Group gap={4} wrap="nowrap">
      {children}
      <HelpTip help={help} />
    </Group>
  );
}
