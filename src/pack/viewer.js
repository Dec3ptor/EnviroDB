// The client data pack's viewer: plain JavaScript with no libraries and no network. It draws the pack's data – a
// summary, the site map, graphs and tables – from the data in the file. Text from the data is only ever set as
// text (never as HTML). The same code shows the preview in EnviroDB and runs in the pack itself.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 864e5;
const SVGNS = 'http://www.w3.org/2000/svg';
const FLAG_TEXT = ['', 'Above a consent limit', 'Above a consent trigger', 'Above a guideline value', 'Detection limit above the limit'];
const STATUS = {
  compliant: ['Complied', 'ok'],
  exceeded: ['Exceeded', 'bad'],
  inconclusive: ['Inconclusive', 'check'],
  'no-data': ['No results', 'none'],
};

const CSS = `
:host { --accent: #0f766e; --bg: #f6f7f9; --card: #ffffff; --ink: #1d232b; --muted: #5d6673; --line: #e3e6ea; --soft: #eef1f4;
  --bad: #c92a2a; --bad-bg: #ffe3e3; --warn: #b35c00; --warn-bg: #fff0d6; --guide-bg: #fdeccf; --check: #6741d9; --check-bg: #ece6fb; --ok: #2b8a3e; --ok-bg: #e2f5e7;
  display: block; color: var(--ink); background: var(--bg); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
:host(.dark) { --bg: #15191e; --card: #1e242b; --ink: #e7eaee; --muted: #9aa4b0; --line: #333b44; --soft: #262d35;
  --bad: #ff8787; --bad-bg: #4a1f22; --warn: #ffc078; --warn-bg: #45311a; --guide-bg: #3d3220; --check: #b197fc; --check-bg: #30284a; --ok: #69db7c; --ok-bg: #1d3a26; }
@media (prefers-color-scheme: dark) { :host(.auto) { --bg: #15191e; --card: #1e242b; --ink: #e7eaee; --muted: #9aa4b0; --line: #333b44; --soft: #262d35;
  --bad: #ff8787; --bad-bg: #4a1f22; --warn: #ffc078; --warn-bg: #45311a; --guide-bg: #3d3220; --check: #b197fc; --check-bg: #30284a; --ok: #69db7c; --ok-bg: #1d3a26; } }
* { box-sizing: border-box; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 0 16px; }
header.top { background: var(--card); border-bottom: 4px solid var(--accent); }
header.top .wrap { display: flex; gap: 20px; align-items: center; padding-top: 22px; padding-bottom: 18px; flex-wrap: wrap; }
header.top img.logo { max-height: 56px; max-width: 200px; object-fit: contain; }
header.top .titles { flex: 1 1 320px; min-width: 0; }
h1 { font-size: 26px; line-height: 1.25; margin: 0; overflow-wrap: anywhere; }
.sub { color: var(--muted); margin-top: 2px; }
.badge { font-size: 12px; color: var(--muted); text-align: right; }
nav { position: sticky; top: 0; z-index: 5; background: var(--card); border-bottom: 1px solid var(--line); }
nav .wrap { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
nav button { flex: none; border: 0; background: none; color: var(--muted); font: inherit; font-size: 14px; padding: 12px 10px; cursor: pointer; border-bottom: 2px solid transparent; }
nav button:hover { color: var(--ink); }
nav button.on { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
main { padding: 20px 0 8px; }
section.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; margin: 0 0 18px; scroll-margin-top: 60px; }
h2 { font-size: 19px; margin: 0 0 12px; display: flex; align-items: center; gap: 10px; }
h2::before { content: ""; width: 4px; height: 20px; background: var(--accent); border-radius: 2px; }
h3 { font-size: 15px; margin: 18px 0 6px; }
p { margin: 0 0 10px; }
ul { margin: 0 0 10px; padding-left: 22px; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.intro { font-size: 15.5px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.stat { background: var(--soft); border-radius: 8px; padding: 12px 14px; }
.stat .n { font-size: 22px; font-weight: 700; line-height: 1.2; }
.stat .n.bad { color: var(--bad); }
.stat .l { color: var(--muted); font-size: 13px; }
.controls { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-bottom: 10px; }
select, input[type=search] { font: inherit; font-size: 14px; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; max-width: 100%; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.seg button { border: 0; background: var(--card); color: var(--ink); font: inherit; font-size: 13px; padding: 6px 10px; cursor: pointer; }
.seg button + button { border-left: 1px solid var(--line); }
.seg button.on { background: var(--accent); color: #fff; }
.btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--accent); background: var(--accent); color: #fff; font: inherit; font-size: 14px; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.btn.ghost { background: var(--card); color: var(--accent); }
.btn:disabled { opacity: 0.5; cursor: default; }
label.check { display: inline-flex; gap: 6px; align-items: center; font-size: 14px; cursor: pointer; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); background: var(--card); color: var(--ink); border-radius: 999px; padding: 3px 10px 3px 8px; font: inherit; font-size: 13px; cursor: pointer; }
.chip .dot { width: 10px; height: 10px; border-radius: 50%; }
.chip.off { opacity: 0.45; }
.chip.off .dot { background: transparent !important; border: 1.5px solid var(--muted); }
.chart { position: relative; }
.chart > svg { display: block; width: 100%; height: auto; overflow: visible; }
.key svg { flex: none; display: inline-block; }
.chart .tip { position: absolute; pointer-events: none; background: var(--card); border: 1px solid var(--line); box-shadow: 0 4px 14px rgba(0,0,0,.14); border-radius: 6px; padding: 6px 9px; font-size: 13px; white-space: nowrap; z-index: 2; }
.chart .tip b { display: block; }
.axis text { fill: var(--muted); font-size: 11px; }
.axis line, .axis path { stroke: var(--line); }
.grid line { stroke: var(--line); stroke-dasharray: 2 3; }
.thr { stroke: var(--lc); }
:host(.dark) .thr { stroke: var(--lcd); }
@media (prefers-color-scheme: dark) { :host(.auto) .thr { stroke: var(--lcd); } }
.key { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; font-size: 12.5px; color: var(--muted); }
.key span { display: inline-flex; align-items: center; gap: 6px; }
.graph { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 14px; }
.graph:first-of-type { border-top: 0; margin-top: 0; padding-top: 0; }
.graph h3 { margin-top: 0; }
.scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: 12.5px; white-space: nowrap; background: var(--card); }
th.sort { cursor: pointer; user-select: none; }
th.sort:hover { color: var(--ink); }
td.num, th.num { text-align: right; white-space: nowrap; }
td.sticky, th.sticky { position: sticky; left: 0; background: var(--card); z-index: 1; }
td.f1 { background: var(--bad-bg); color: var(--bad); font-weight: 600; }
td.f2 { background: var(--warn-bg); color: var(--warn); font-weight: 600; }
td.f3 { background: var(--guide-bg); }
td.f4 { background: var(--check-bg); color: var(--check); }
.legend-cells { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: 12.5px; color: var(--muted); }
.legend-cells i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -1px; margin-right: 5px; }
.status { display: inline-block; font-size: 12px; font-weight: 600; border-radius: 999px; padding: 1px 9px; white-space: nowrap; }
.status.ok { background: var(--ok-bg); color: var(--ok); }
.status.bad { background: var(--bad-bg); color: var(--bad); }
.status.check { background: var(--check-bg); color: var(--check); }
.status.none { background: var(--soft); color: var(--muted); }
.rule { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.rule:last-child { border-bottom: 0; }
.rule .what { font-weight: 600; }
.pager { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-top: 10px; font-size: 13px; color: var(--muted); }
.map { position: relative; border-radius: 8px; overflow: hidden; border: 1px solid var(--line); background: var(--soft); }
.map svg { display: block; width: 100%; height: auto; }
.map .pin { cursor: pointer; }
.map .lbl { font-size: 15px; font-weight: 700; paint-order: stroke; stroke: rgba(255,255,255,.92); stroke-width: 4px; fill: #1d232b; }
.map .tip { position: absolute; pointer-events: none; background: var(--card); border: 1px solid var(--line); box-shadow: 0 4px 14px rgba(0,0,0,.14); border-radius: 6px; padding: 6px 9px; font-size: 13px; max-width: 260px; }
.sites { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 16px; margin-top: 12px; font-size: 13.5px; }
.sites button { all: unset; cursor: pointer; display: flex; gap: 8px; align-items: baseline; }
.sites button:hover b { text-decoration: underline; }
.sites .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; transform: translateY(1px); }
footer { color: var(--muted); font-size: 12.5px; padding: 8px 0 28px; }
footer p { margin: 0 0 6px; }
@media (max-width: 560px) {
  h1 { font-size: 21px; }
  section.card { padding: 14px 14px; border-radius: 8px; }
  .badge { text-align: left; }
  .stat .n { font-size: 19px; }
}
@media print {
  nav, .controls, .pager, .noprint { display: none !important; }
  :host { background: #fff; }
  section.card { break-inside: avoid; border: 0; padding: 0; }
}
`;

// ------------------------------------------------------------ helpers

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  setProps(e, props);
  append(e, kids);
  return e;
}

function sv(tag, props, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  setProps(e, props);
  append(e, kids);
  return e;
}

function setProps(e, props) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.setAttribute('class', v);
    else if (k === 'text') e.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(e, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    e.append(c instanceof Node ? c : String(c));
  }
}

const pad2 = (n) => String(n).padStart(2, '0');
const toTime = (d) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
function fmtDate(d) {
  if (!d) return '';
  const [y, m, dd] = d.slice(0, 10).split('-');
  return `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}`;
}
const fmtTime = (t) => {
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** As EnviroDB writes numbers: 3 significant figures, in full (never 5e-5). */
function fmtNum(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 10000) return Math.round(v).toLocaleString('en-NZ');
  if (a >= 100) return String(Math.round(v * 10) / 10);
  const x = Number(v.toPrecision(3));
  const s = String(x);
  if (!/e/i.test(s)) return s;
  const places = Math.min(100, Math.max(0, Math.ceil(-Math.log10(Math.abs(x))) + 3));
  return x.toFixed(places).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Text with **bold**, *italic* and "- " bullets, as elements. */
function richText(text) {
  const out = [];
  for (const block of String(text || '').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) out.push(el('ul', null, lines.map((l) => el('li', null, inline(l.replace(/^\s*[-•*]\s+/, ''))))));
    else out.push(el('p', null, inline(lines.join('\n'))));
  }
  return out;
}

function inline(s) {
  const parts = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(...lineBreaks(s.slice(last, m.index)));
    parts.push(m[1] !== undefined ? el('strong', { text: m[1] }) : el('em', { text: m[2] }));
    last = re.lastIndex;
  }
  if (last < s.length) parts.push(...lineBreaks(s.slice(last)));
  return parts;
}

function lineBreaks(s) {
  const out = [];
  s.split('\n').forEach((part, i) => {
    if (i) out.push(el('br'));
    out.push(part);
  });
  return out;
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // a leading = + - @ would be read as a formula by spreadsheets
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** File names in plain ASCII (macrons and en dashes make some browsers fall back to "download"). */
const fileSafe = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2012-\u2015]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'data';

/** Round numbers for an axis. */
function niceTicks(lo, hi, n) {
  if (!(hi > lo)) {
    const d = lo === 0 ? 1 : Math.abs(lo) * 0.5;
    lo -= d;
    hi += d;
  }
  const step0 = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const e = step0 / mag;
  const step = (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
  const a = Math.floor(lo / step + 1e-9) * step;
  const b = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let x = a; x <= b + step / 2; x += step) ticks.push(Number(x.toPrecision(12)));
  return ticks;
}

/** Dates along a time axis: months or years, as many as fit. */
function timeTicks(t0, t1, width) {
  const fit = Math.max(2, Math.floor(width / 72));
  const months = (t1 - t0) / (30.44 * DAY);
  for (const step of [1, 2, 3, 6, 12, 24, 60, 120]) {
    if (months / step > fit) continue;
    const s = new Date(t0);
    let y = s.getUTCFullYear();
    let m = s.getUTCMonth();
    m = Math.ceil((y * 12 + m + (s.getUTCDate() > 1 ? 1 : 0)) / step) * step;
    y = Math.floor(m / 12);
    m %= 12;
    const out = [];
    for (;;) {
      const t = Date.UTC(y, m, 1);
      if (t > t1) break;
      out.push({ t, label: step >= 12 ? String(y) : `${MONTHS[m]} ${String(y).slice(2)}` });
      m += step;
      y += Math.floor(m / 12);
      m %= 12;
    }
    return out;
  }
  return [];
}

const merc = (lat, lng) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
};

// ------------------------------------------------------------ the pack

export function renderPack(data, host) {
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
  root.replaceChildren();
  const theme = data.look.theme || 'light';
  host.classList.remove('dark', 'auto');
  if (theme !== 'light') host.classList.add(theme);
  host.style.setProperty('--accent', /^#[0-9a-f]{3,8}$/i.test(data.look.accent || '') ? data.look.accent : '#0f766e');
  root.append(el('style', { text: CSS }));

  // ---- the data, unpacked
  const P = data.params;
  const S = data.sites;
  const samples = data.samples.map(([site, date, name]) => ({ site, date, name, time: toTime(date) }));
  const results = data.results.map(([s, p, v, q, f, n, x]) => {
    const smp = samples[s];
    return { s, p, v: v === undefined ? null : v, q: q || '', f: f || 0, n: n === undefined || n === null ? -1 : n, x: x || '', site: smp.site, date: smp.date, time: smp.time };
  });
  const valueText = (r) => (r.v === null ? r.x : `${r.q ? `${r.q} ` : ''}${fmtNum(r.v)}`);
  const noteOf = (r) => (r.n >= 0 ? data.notes[r.n] : FLAG_TEXT[r.f]) || '';
  const bySeries = new Map();
  for (const r of results) {
    const k = `${r.p}|${r.site}`;
    if (!bySeries.has(k)) bySeries.set(k, []);
    bySeries.get(k).push(r);
  }
  bySeries.forEach((l) => l.sort((a, b) => a.time - b.time));
  const paramsWithData = P.map((_, i) => i).filter((p) => S.some((_, s) => bySeries.has(`${p}|${s}`)));
  const lastTime = samples.reduce((m, s) => Math.max(m, s.time), 0);
  const firstTime = samples.reduce((m, s) => Math.min(m, s.time), Infinity);
  const can = data.can || {};
  const sections = data.sections || [];
  const graphsApi = {}; // lets the map open a site's graphs

  // ---- header and navigation
  const made = data.pack;
  root.append(
    el(
      'header',
      { class: 'top' },
      el(
        'div',
        { class: 'wrap' },
        data.look.logo && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(data.look.logo) ? el('img', { class: 'logo', src: data.look.logo, alt: '' }) : null,
        el('div', { class: 'titles' }, el('h1', { text: data.look.title }), data.look.subtitle ? el('div', { class: 'sub', text: data.look.subtitle }) : null),
        el('div', { class: 'badge' }, el('div', { text: `Data pack v${made.version}` }), el('div', { text: fmtDate(made.made) })),
      ),
    ),
  );
  const nav = el('nav', { class: 'noprint' }, el('div', { class: 'wrap' }));
  const main = el('main', null);
  const wrap = el('div', { class: 'wrap' }, main);
  root.append(nav, wrap);

  if (data.look.intro) main.append(el('section', { class: 'card intro' }, richText(data.look.intro)));

  const navButtons = [];
  for (const sec of sections) {
    const body = sectionBody(sec);
    if (!body) continue;
    const card = el('section', { class: 'card', id: `sec-${sec.id}` }, el('h2', { text: sec.title }), body);
    main.append(card);
    const b = el('button', { type: 'button', text: sec.title, onclick: () => card.scrollIntoView({ behavior: 'smooth', block: 'start' }) });
    navButtons.push([b, card]);
    nav.firstChild.append(b);
  }
  if (navButtons.length < 2) nav.remove();
  // the section being read is marked in the bar: the last one whose top has passed under it
  if (host.__packScroll) document.removeEventListener('scroll', host.__packScroll, true);
  if (navButtons.length >= 2) {
    let queued = false;
    const mark = () => {
      queued = false;
      const line = nav.getBoundingClientRect().bottom + 24;
      let current = navButtons[0][0];
      for (const [b, card] of navButtons) if (card.getBoundingClientRect().top <= line) current = b;
      navButtons.forEach(([b]) => b.classList.toggle('on', b === current));
    };
    host.__packScroll = () => {
      if (!queued) (queued = true), requestAnimationFrame(mark);
    };
    document.addEventListener('scroll', host.__packScroll, { capture: true, passive: true });
    requestAnimationFrame(mark);
  }

  root.append(
    el(
      'footer',
      null,
      el(
        'div',
        { class: 'wrap' },
        data.look.footer ? richText(data.look.footer) : null,
        el('p', {
          text: `Data pack v${made.version}, made ${fmtDate(made.made)}${made.company ? ` by ${made.company}` : ''} with EnviroDB ${made.app}. Results are as reported by the laboratory; “<” is below the detection limit. Opens offline – nothing in it is sent anywhere.`,
        }),
      ),
    ),
  );

  function sectionBody(sec) {
    switch (sec.type) {
      case 'summary':
        return summary();
      case 'map':
        return S.some((s) => s.lat !== undefined && s.lat !== null) ? siteMap() : null;
      case 'graphs':
        return paramsWithData.length ? graphs(sec) : el('p', { class: 'muted', text: 'No results in this period.' });
      case 'latest':
        return latest();
      case 'compliance':
        return can.limits && data.compliance && data.compliance.length ? compliance() : null;
      case 'data':
        return dataTable();
      case 'text':
        return sec.text ? el('div', null, richText(sec.text)) : null;
      default:
        return null;
    }
  }

  // ------------------------------------------------------------ summary
  function summary() {
    const inPeriod = samples.filter((s) => s.date.slice(0, 10) >= data.period.start && s.date.slice(0, 10) <= data.period.end);
    const sitesSampled = new Set(inPeriod.map((s) => s.site)).size;
    const over = results.filter((r) => r.f === 1).length;
    const trig = results.filter((r) => r.f === 2).length;
    const stats = [
      [String(sitesSampled), sitesSampled === 1 ? 'site sampled' : 'sites sampled'],
      [String(inPeriod.length), inPeriod.length === 1 ? 'sample' : 'samples'],
      [String(paramsWithData.length), paramsWithData.length === 1 ? 'analyte' : 'analytes'],
      [lastTime ? fmtTime(lastTime) : '–', 'latest sample'],
    ];
    if (can.limits) stats.push([String(over), over === 1 ? 'result above a consent limit' : 'results above consent limits', over ? 'bad' : '']);
    if (can.limits && trig) stats.push([String(trig), trig === 1 ? 'result above a trigger' : 'results above triggers']);
    return el(
      'div',
      null,
      el('p', {
        class: 'muted',
        text: `${data.period.label}.${firstTime < Infinity && (firstTime > toTime(data.period.start) || lastTime < toTime(data.period.end)) ? ` Results from ${fmtTime(firstTime)} to ${fmtTime(lastTime)}.` : ''}`,
      }),
      el(
        'div',
        { class: 'cards' },
        stats.map(([n, l, cls]) => el('div', { class: 'stat' }, el('div', { class: `n ${cls || ''}`, text: n }), el('div', { class: 'l', text: l }))),
      ),
    );
  }

  // ------------------------------------------------------------ the site map
  function siteMap() {
    const located = S.map((s, i) => ({ ...s, i })).filter((s) => s.lat !== undefined && s.lat !== null);
    const pts = located.map((s) => ({ s, m: merc(s.lat, s.lng) }));
    let box = data.map && data.map.box;
    const image = data.map && data.map.image && /^data:image\/(png|jpe?g|webp);base64,/i.test(data.map.image) ? data.map.image : null;
    if (!box || !image) {
      const xs = pts.map((p) => p.m[0]);
      const ys = pts.map((p) => p.m[1]);
      let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const minSpan = 0.6 / 40075; // about 600 m
      let w = Math.max(x1 - x0, minSpan), h = Math.max(y1 - y0, minSpan);
      // a 16:10 frame with room around the sites
      if (w / h < 1.6) w = h * 1.6;
      else h = w / 1.6;
      w *= 1.35;
      h *= 1.35;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
    }
    const W = 1000;
    const H = Math.round((W * (box[3] - box[1])) / (box[2] - box[0]));
    const X = (m) => ((m[0] - box[0]) / (box[2] - box[0])) * W;
    const Y = (m) => ((m[1] - box[1]) / (box[3] - box[1])) * H;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Map of the monitoring sites' });
    if (image) svg.append(sv('image', { href: image, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none' }));
    else {
      svg.append(sv('rect', { x: 0, y: 0, width: W, height: H, fill: 'var(--soft)' }));
      for (let i = 1; i < 10; i++) svg.append(sv('line', { x1: (W * i) / 10, y1: 0, x2: (W * i) / 10, y2: H, stroke: 'var(--line)' }), sv('line', { x1: 0, y1: (H * i) / 10, x2: W, y2: (H * i) / 10, stroke: 'var(--line)' }));
    }
    // a scale bar and north
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * ((box[1] + box[3]) / 2)))) * 180) / Math.PI;
    const metresAcross = (box[2] - box[0]) * 40075016.7 * Math.cos((lat * Math.PI) / 180);
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].filter((m) => (m / metresAcross) * W <= 180).pop() || 10;
    const len = (nice / metresAcross) * W;
    const sb = sv('g', { transform: `translate(20 ${H - 24})` });
    sb.append(
      sv('rect', { x: -8, y: -22, width: len + 16, height: 34, rx: 4, fill: 'rgba(255,255,255,.85)' }),
      sv('path', { d: `M0 0 V6 H${len} V0`, fill: 'none', stroke: '#1d232b', 'stroke-width': 2 }),
      sv('text', { x: len / 2, y: -6, 'text-anchor': 'middle', 'font-size': 13, fill: '#1d232b', text: nice >= 1000 ? `${nice / 1000} km` : `${nice} m` }),
    );
    svg.append(sb);
    svg.append(
      sv('g', { transform: `translate(${W - 34} 30)` }, sv('circle', { r: 17, fill: 'rgba(255,255,255,.85)' }), sv('path', { d: 'M0 -11 L6 6 L0 2 L-6 6 Z', fill: '#1d232b' }), sv('text', { y: 14, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 700, fill: '#1d232b', text: 'N' })),
    );
    const box2 = el('div', { class: 'map' }, svg);
    const tip = el('div', { class: 'tip', style: 'display:none' });
    box2.append(tip);
    const counts = new Map();
    const latestOf = new Map();
    for (const smp of samples) {
      counts.set(smp.site, (counts.get(smp.site) || 0) + 1);
      if (!latestOf.has(smp.site) || latestOf.get(smp.site) < smp.date) latestOf.set(smp.site, smp.date);
    }
    const about = (s) => [`${s.code}${s.name ? ` – ${s.name}` : ''}`, [s.type, counts.get(s.i) ? `${counts.get(s.i)} samples, latest ${fmtDate(latestOf.get(s.i))}` : 'no samples in the pack'].filter(Boolean).join(' · ')];
    const show = (s, x, y) => {
      const [a, b] = about(s);
      tip.replaceChildren(el('b', { text: a }), el('div', { class: 'small muted', text: b }));
      tip.style.display = 'block';
      const r = svg.getBoundingClientRect();
      const k = r.width / W;
      tip.style.left = `${Math.min(Math.max(4, x * k + 12), r.width - 200)}px`;
      tip.style.top = `${Math.max(4, y * k - 10)}px`;
    };
    for (const { s, m } of pts) {
      const x = X(m), y = Y(m);
      const g = sv('g', { class: 'pin', tabindex: 0, role: 'button', 'aria-label': about(s).join('. ') });
      g.append(sv('circle', { cx: x, cy: y, r: 10, fill: s.color, stroke: '#fff', 'stroke-width': 3 }), sv('text', { class: 'lbl', x: x + 15, y: y + 5, text: s.code }));
      g.addEventListener('pointerenter', () => show(s, x, y));
      g.addEventListener('pointerleave', () => (tip.style.display = 'none'));
      g.addEventListener('click', () => graphsApi.showSite && graphsApi.showSite(s.i));
      g.addEventListener('keydown', (e) => e.key === 'Enter' && graphsApi.showSite && graphsApi.showSite(s.i));
      svg.append(g);
    }
    const list = el(
      'div',
      { class: 'sites' },
      S.map((s, i) =>
        el(
          'button',
          { type: 'button', onclick: () => graphsApi.showSite && graphsApi.showSite(i), title: 'Show its graphs' },
          el('span', { class: 'dot', style: `background:${s.color}` }),
          el('span', null, el('b', { text: s.code }), s.name ? ` ${s.name}` : '', el('div', { class: 'small muted', text: [s.type, counts.get(i) ? `${counts.get(i)} samples` : ''].filter(Boolean).join(' · ') })),
        ),
      ),
    );
    const missing = S.length - located.length;
    return el(
      'div',
      null,
      box2,
      el('p', { class: 'small muted', style: 'margin:6px 0 0', text: [image ? data.map.attribution || '' : 'Site positions; no background map.', missing ? `${missing} site${missing === 1 ? ' has' : 's have'} no location.` : '', 'Tap a site for its graphs.'].filter(Boolean).join(' ') }),
      list,
    );
  }

  // ------------------------------------------------------------ graphs
  function graphs(sec) {
    const ranges = [
      ['All', null],
      ['5 years', 5],
      ['2 years', 2],
      ['1 year', 1],
    ].filter(([, y]) => y === null || (lastTime - firstTime) / (365.25 * DAY) > y * 1.05);
    const state = { range: null, limits: !!can.limits, overlay: !!data.overlay, sites: new Set(S.map((_, i) => i)), param: paramsWithData[0] };
    const charts = [];
    const redraw = () => charts.forEach((c) => c.draw());
    const out = el('div', null);
    const controls = el('div', { class: 'controls' });
    const picker = sec.mode !== 'all';
    if (picker) {
      const select = el('select', { 'aria-label': 'Analyte' });
      const groups = new Map();
      for (const p of paramsWithData) {
        const g = P[p].group || 'Other';
        if (!groups.has(g)) groups.set(g, el('optgroup', { label: g }));
        groups.get(g).append(el('option', { value: p, text: P[p].name }));
      }
      groups.forEach((g) => select.append(g));
      select.addEventListener('change', () => {
        state.param = Number(select.value);
        redraw();
      });
      graphsApi.select = select;
      controls.append(select);
    }
    if (can.controls && ranges.length > 1) {
      const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Dates' });
      for (const [label, years] of ranges) {
        const b = el('button', { type: 'button', text: label, class: years === null ? 'on' : '' });
        b.addEventListener('click', () => {
          state.range = years;
          seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
          redraw();
        });
        seg.append(b);
      }
      controls.append(seg);
    }
    if (can.limits && data.lines.some((l) => l && l.length)) {
      const cb = el('input', { type: 'checkbox', checked: true });
      cb.addEventListener('change', () => {
        state.limits = cb.checked;
        redraw();
      });
      controls.append(el('label', { class: 'check' }, cb, 'Limits and guidelines'));
    }
    if (data.overlay) {
      const cb = el('input', { type: 'checkbox', checked: true });
      cb.addEventListener('change', () => {
        state.overlay = cb.checked;
        redraw();
      });
      controls.append(el('label', { class: 'check' }, cb, data.overlay.kind === 'rainfall' ? 'Rainfall' : data.overlay.kind === 'flow' ? 'Flow' : 'Water level'));
    }
    // sites shown: chips that turn sites on and off
    const chips = el('div', { class: 'chips' });
    const chipFor = new Map();
    S.forEach((s, i) => {
      if (!paramsWithData.some((p) => bySeries.has(`${p}|${i}`))) return;
      const c = el('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', title: s.name || s.code }, el('span', { class: 'dot', style: `background:${s.color}` }), s.code);
      c.addEventListener('click', () => {
        if (state.sites.has(i)) state.sites.delete(i);
        else state.sites.add(i);
        syncChips();
        redraw();
      });
      chipFor.set(i, c);
      chips.append(c);
    });
    const syncChips = () => chipFor.forEach((c, i) => (c.classList.toggle('off', !state.sites.has(i)), c.setAttribute('aria-pressed', String(state.sites.has(i)))));
    if (chipFor.size > 1) controls.append(chips);
    if (controls.childNodes.length) out.append(controls);

    if (picker) {
      const c = chart(() => state.param, state);
      charts.push(c);
      out.append(c.node);
    } else {
      for (const p of paramsWithData) {
        const c = chart(() => p, state);
        charts.push(c);
        out.append(el('div', { class: 'graph' }, el('h3', { text: `${P[p].name}${P[p].unit ? ` (${P[p].unit})` : ''}` }), c.node));
      }
    }
    graphsApi.showSite = (i) => {
      state.sites = new Set([i]);
      syncChips();
      if (picker && !paramsWithData.some((p) => p === state.param && bySeries.has(`${p}|${i}`))) {
        const first = paramsWithData.find((p) => bySeries.has(`${p}|${i}`));
        if (first !== undefined) {
          state.param = first;
          graphsApi.select.value = String(first);
        }
      }
      redraw();
      out.closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    return out;
  }

  /** An interactive graph of one analyte: a line per site, limits and guidelines, a value on hover. */
  function chart(paramOf, state) {
    const node = el('div', { class: 'chart' });
    const tip = el('div', { class: 'tip', style: 'display:none' });
    const keyBox = el('div', { class: 'key' });
    let lastWidth = 0;
    const draw = () => {
      const p = paramOf();
      const W = Math.max(300, Math.round(node.clientWidth || 720));
      lastWidth = node.clientWidth;
      const H = W < 520 ? 250 : 320;
      const ov = data.overlay && state.overlay ? data.overlay : null;
      const m = { l: 56, r: ov ? 40 : 14, t: 14, b: 30 };
      const from = state.range ? lastTime - state.range * 365.25 * DAY : -Infinity;
      const series = [];
      S.forEach((s, i) => {
        if (!state.sites.has(i)) return;
        const pts = (bySeries.get(`${p}|${i}`) || []).filter((r) => r.v !== null && r.time >= from);
        if (pts.length) series.push({ i, s, pts });
      });
      const all = series.flatMap((x) => x.pts);
      const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${P[p].name} by site` });
      node.replaceChildren(svg, tip, keyBox);
      keyBox.replaceChildren();
      if (!all.length) {
        svg.append(sv('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 14, text: 'No results for these sites and dates.' }));
        return;
      }
      let t0 = Math.min(...all.map((r) => r.time));
      let t1 = Math.max(...all.map((r) => r.time));
      if (t1 - t0 < 20 * DAY) {
        t0 -= 15 * DAY;
        t1 += 15 * DAY;
      }
      const tp = (t1 - t0) * 0.02;
      t0 -= tp;
      t1 += tp;
      const vals = all.map((r) => r.v);
      let lo = Math.min(...vals);
      let hi = Math.max(...vals);
      const lines = state.limits ? (data.lines[p] || []) : [];
      const drawn = [];
      for (const l of lines) {
        const fits = l.values.every((v) => v <= Math.max(hi, 1e-12) * 2.5 && v >= lo * 0.4 - Math.abs(hi) * 0.5);
        drawn.push(fits);
        if (fits) for (const v of l.values) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
      }
      if (lo > 0 && lo > hi * 0.5) lo -= (hi - lo) * 0.35 || hi * 0.1;
      else lo = Math.min(0, lo);
      const ticks = niceTicks(lo, hi * 1.04, H < 300 ? 4 : 5);
      const yLo = ticks[0], yHi = ticks[ticks.length - 1];
      const x = (t) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
      const y = (v) => H - m.b - ((v - yLo) / (yHi - yLo || 1)) * (H - m.t - m.b);
      // grid and axes
      const grid = sv('g', { class: 'grid' });
      const axis = sv('g', { class: 'axis' });
      for (const v of ticks) {
        grid.append(sv('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
        axis.append(sv('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', text: fmtNum(v) }));
      }
      for (const tk of timeTicks(t0, t1, W - m.l - m.r)) {
        axis.append(sv('line', { x1: x(tk.t), x2: x(tk.t), y1: H - m.b, y2: H - m.b + 4 }), sv('text', { x: x(tk.t), y: H - m.b + 16, 'text-anchor': 'middle', text: tk.label }));
      }
      axis.append(sv('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }));
      if (P[p].unit) axis.append(sv('text', { x: 8, y: m.t + 2, transform: `rotate(-90 8 ${m.t + 2})`, 'text-anchor': 'end', text: P[p].unit }));
      svg.append(grid, axis);
      // rainfall hanging from the top (flow or level as a line), on its own scale at the right
      if (ov) {
        const ot0 = toTime(ov.start);
        const pts = [];
        ov.v.forEach((v, i) => {
          const t = ot0 + i * DAY;
          if (v !== null && t >= t0 && t <= t1) pts.push([t, v]);
        });
        if (pts.length) {
          const top = Math.max(...pts.map((q) => q[1])) || 1;
          const rain = ov.kind === 'rainfall';
          const plotH = H - m.t - m.b;
          const scaleMax = rain ? top * 2.6 : top * 1.1;
          const yo = (v) => (rain ? m.t + (v / scaleMax) * plotH : H - m.b - (v / scaleMax) * plotH);
          const g = sv('g', null);
          if (rain) {
            const bw = Math.max(1, ((W - m.l - m.r) / Math.max(1, (t1 - t0) / DAY)) * 0.8);
            for (const [t, v] of pts) if (v > 0) g.append(sv('rect', { x: x(t) - bw / 2, y: m.t, width: bw, height: Math.max(0.6, yo(v) - m.t), fill: 'rgba(56,131,214,.42)' }));
          } else g.append(sv('polyline', { points: pts.map(([t, v]) => `${x(t).toFixed(1)},${yo(v).toFixed(1)}`).join(' '), fill: 'none', stroke: 'rgba(56,131,214,.75)', 'stroke-width': 1.4 }));
          svg.append(g);
          for (const v of niceTicks(0, top, 2)) if (v > 0 && v <= top * 1.05) axis.append(sv('text', { x: W - m.r + 5, y: yo(v) + 4, text: fmtNum(v) }));
          axis.append(sv('text', { x: W - m.r + 5, y: rain ? H - m.b : m.t + 2, text: ov.unit || '' }));
          const sw = sv('svg', { width: 22, height: 10 }, rain ? [3, 9, 15].map((xx, k) => sv('rect', { x: xx, y: 0, width: 4, height: [7, 4, 10][k], fill: 'rgba(56,131,214,.55)' })) : sv('line', { x1: 0, x2: 22, y1: 5, y2: 5, stroke: 'rgba(56,131,214,.8)', 'stroke-width': 2 }));
          keyBox.append(el('span', null, sw, `${rain ? 'Daily rainfall' : 'Daily mean'} (${ov.unit}) – ${ov.name}`));
        }
      }
      // limits, triggers and guidelines: each in its own colour (the stylesheet picks light or dark) and dashes
      lines.forEach((l, k) => {
        const own = { style: `--lc:${l.color[0]};--lcd:${l.color[1]}`, class: 'thr', 'stroke-dasharray': l.dash || null, 'stroke-linecap': 'round' };
        if (drawn[k]) for (const v of l.values) svg.append(sv('line', { ...own, x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), 'stroke-width': 1.8 }));
        const sw = sv('svg', { width: 26, height: 8 }, sv('line', { ...own, x1: 1, x2: 25, y1: 4, y2: 4, 'stroke-width': 2 }));
        keyBox.append(el('span', null, sw, `${l.text}${drawn[k] ? '' : ' (off the scale)'}`));
      });
      // the sites' results: lines through them, hollow circles for those below the detection limit
      const dots = [];
      for (const se of series) {
        if (se.pts.length > 1) svg.append(sv('polyline', { points: se.pts.map((r) => `${x(r.time).toFixed(1)},${y(r.v).toFixed(1)}`).join(' '), fill: 'none', stroke: se.s.color, 'stroke-width': 1.6, 'stroke-linejoin': 'round', opacity: 0.85 }));
        for (const r of se.pts) {
          const cx = x(r.time), cy = y(r.v);
          const nd = r.q === '<';
          svg.append(sv('circle', { cx, cy, r: r.f === 1 || r.f === 2 ? 4.2 : 3.2, fill: nd ? 'var(--card)' : se.s.color, stroke: r.f === 1 ? 'var(--bad)' : se.s.color, 'stroke-width': nd ? 1.6 : r.f === 1 ? 2 : 1 }));
          dots.push({ cx, cy, r, s: se.s });
        }
      }
      if (all.some((r) => r.q === '<')) keyBox.append(el('span', null, sv('svg', { width: 10, height: 10 }, sv('circle', { cx: 5, cy: 5, r: 3.5, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 1.5 })), 'below the detection limit (plotted at it)'));
      // a value on hover (or tap)
      const ring = sv('circle', { r: 7, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.5, style: 'display:none' });
      svg.append(ring);
      const hit = sv('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
      svg.append(hit);
      const find = (ev) => {
        const rect = svg.getBoundingClientRect();
        const k = W / rect.width;
        const px = (ev.clientX - rect.left) * k, py = (ev.clientY - rect.top) * k;
        let best = null, bd = Infinity;
        for (const d of dots) {
          const dd = (d.cx - px) ** 2 + ((d.cy - py) * 0.6) ** 2;
          if (dd < bd) (bd = dd), (best = d);
        }
        return bd < (40 * k) ** 2 ? { d: best, k } : null;
      };
      const move = (ev) => {
        const f = find(ev);
        if (!f) return hide();
        const { d, k } = f;
        ring.setAttribute('cx', d.cx);
        ring.setAttribute('cy', d.cy);
        ring.style.display = '';
        const note = d.r.f ? noteOf(d.r) : '';
        tip.replaceChildren(el('b', { text: `${d.s.code} · ${fmtDate(d.r.date)}` }), el('div', { text: `${valueText(d.r)} ${P[p].unit || ''}`.trim() }));
        if (note) tip.append(el('div', { class: 'small', style: `color:${d.r.f === 1 ? 'var(--bad)' : 'var(--muted)'}`, text: note }));
        if (ov) {
          const rain = ov.v[Math.round((toTime(d.r.date) - toTime(ov.start)) / DAY)];
          if (rain !== undefined && rain !== null) tip.append(el('div', { class: 'small muted', text: `${ov.kind === 'rainfall' ? 'Rain that day' : 'That day'}: ${fmtNum(rain)} ${ov.unit}` }));
        }
        tip.style.display = 'block';
        const left = d.cx / k + 14;
        const nodeW = node.clientWidth;
        tip.style.left = `${left + tip.offsetWidth > nodeW ? Math.max(0, d.cx / k - tip.offsetWidth - 14) : left}px`;
        tip.style.top = `${Math.max(0, d.cy / k - 20)}px`;
      };
      const hide = () => {
        ring.style.display = 'none';
        tip.style.display = 'none';
      };
      hit.addEventListener('pointermove', move);
      hit.addEventListener('pointerdown', move);
      hit.addEventListener('pointerleave', hide);
    };
    // redrawn to fit when its width changes
    if ('ResizeObserver' in window) new ResizeObserver(() => node.clientWidth && Math.abs(node.clientWidth - lastWidth) > 4 && draw()).observe(node);
    requestAnimationFrame(draw);
    return { node, draw };
  }

  // ------------------------------------------------------------ latest results
  function latest() {
    const inPeriod = samples.map((s, i) => ({ ...s, i })).filter((s) => s.date.slice(0, 10) >= data.period.start && s.date.slice(0, 10) <= data.period.end);
    const lastBySite = new Map();
    for (const s of inPeriod) if (!lastBySite.has(s.site) || lastBySite.get(s.site).date < s.date) lastBySite.set(s.site, s);
    const sites = [...lastBySite.keys()].sort((a, b) => a - b);
    if (!sites.length) return el('p', { class: 'muted', text: 'No samples in this period.' });
    const cell = new Map(); // `${site}|${param}` → result
    const lastSamples = new Set(sites.map((s) => lastBySite.get(s).i));
    for (const r of results) if (lastSamples.has(r.s)) cell.set(`${r.site}|${r.p}`, r);
    const params = paramsWithData.filter((p) => sites.some((s) => cell.has(`${s}|${p}`)));
    const table = el(
      'table',
      null,
      el('thead', null, el('tr', null, el('th', { class: 'sticky', text: 'Analyte' }), el('th', { text: 'Unit' }), sites.map((s) => el('th', { class: 'num' }, S[s].code, el('div', { class: 'small', style: 'font-weight:400', text: fmtDate(lastBySite.get(s).date) }))))),
      el(
        'tbody',
        null,
        params.map((p) =>
          el(
            'tr',
            null,
            el('td', { class: 'sticky', text: P[p].name }),
            el('td', { class: 'muted', text: P[p].unit || '' }),
            sites.map((s) => {
              const r = cell.get(`${s}|${p}`);
              return el('td', { class: `num${r && r.f ? ` f${r.f}` : ''}`, title: r && r.f ? noteOf(r) : null, text: r ? valueText(r) : '–' });
            }),
          ),
        ),
      ),
    );
    return el('div', null, el('p', { class: 'muted small', text: 'Each site’s latest sample in the period.' }), el('div', { class: 'scroll' }, table), cellKey());
  }

  function cellKey() {
    const kinds = new Set(results.map((r) => r.f).filter(Boolean));
    if (!kinds.size) return null;
    const sw = { 1: 'var(--bad-bg)', 2: 'var(--warn-bg)', 3: 'var(--guide-bg)', 4: 'var(--check-bg)' };
    return el('div', { class: 'legend-cells' }, [...kinds].sort().map((k) => el('span', null, el('i', { style: `background:${sw[k]}` }), FLAG_TEXT[k])));
  }

  // ------------------------------------------------------------ compliance
  function compliance() {
    return el(
      'div',
      null,
      el('p', { class: 'muted small', text: `The consent’s limits and triggers over ${data.period.label}.` }),
      data.compliance.map((c) => {
        const [label, cls] = STATUS[c.status] || [c.status, 'none'];
        return el(
          'div',
          { class: 'rule' },
          el('div', null, el('span', { class: `status ${cls}`, text: label })),
          el('div', null, el('div', { class: 'what', text: [c.name, c.condition ? `(${c.condition})` : ''].filter(Boolean).join(' ') }), c.summary ? el('div', { class: 'small muted', text: c.summary }) : null),
        );
      }),
    );
  }

  // ------------------------------------------------------------ all the results
  function dataTable() {
    const PAGE = 50;
    const state = { site: -1, param: -1, flagged: false, sort: 'date', dir: -1, page: 0 };
    const out = el('div', null);
    const controls = el('div', { class: 'controls' });
    const tableBox = el('div', { class: 'scroll' });
    const pager = el('div', { class: 'pager' });
    if (can.controls) {
      const siteSel = el('select', { 'aria-label': 'Site' }, el('option', { value: -1, text: 'All sites' }), S.map((s, i) => el('option', { value: i, text: s.name ? `${s.code} – ${s.name}` : s.code })));
      const paramSel = el('select', { 'aria-label': 'Analyte' }, el('option', { value: -1, text: 'All analytes' }), paramsWithData.map((p) => el('option', { value: p, text: P[p].name })));
      siteSel.addEventListener('change', () => ((state.site = Number(siteSel.value)), (state.page = 0), render()));
      paramSel.addEventListener('change', () => ((state.param = Number(paramSel.value)), (state.page = 0), render()));
      controls.append(siteSel, paramSel);
      if (results.some((r) => r.f)) {
        const cb = el('input', { type: 'checkbox' });
        cb.addEventListener('change', () => ((state.flagged = cb.checked), (state.page = 0), render()));
        controls.append(el('label', { class: 'check' }, cb, 'Highlighted only'));
      }
    }
    const shown = () =>
      results
        .filter((r) => (state.site < 0 || r.site === state.site) && (state.param < 0 || r.p === state.param) && (!state.flagged || r.f))
        .sort((a, b) => {
          const d = state.dir;
          if (state.sort === 'site') return d * (a.site - b.site) || b.time - a.time || a.p - b.p;
          if (state.sort === 'param') return d * (a.p - b.p) || b.time - a.time || a.site - b.site;
          if (state.sort === 'value') return d * ((a.v ?? -Infinity) - (b.v ?? -Infinity));
          return d * (a.time - b.time) || a.site - b.site || a.p - b.p;
        });
    if (can.download) {
      const dl = el('button', { type: 'button', class: 'btn ghost', text: 'Download (CSV)', title: 'The results shown, for a spreadsheet' });
      dl.addEventListener('click', () => {
        const rows = [['Site', 'Site name', 'Date', 'Analyte', 'Result', 'Unit', 'Qualifier', 'Value', 'Note']];
        for (const r of shown()) rows.push([S[r.site].code, S[r.site].name || '', samples[r.s].date, P[r.p].name, valueText(r), P[r.p].unit || '', r.q, r.v === null ? '' : r.v, r.f ? noteOf(r) : '']);
        download(`${fileSafe(data.look.title)} - results.csv`, `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`, 'text/csv;charset=utf-8');
      });
      controls.append(dl);
    }
    if (controls.childNodes.length) out.append(controls);
    out.append(tableBox, pager);
    const head = (key, label, cls) => {
      const th = el('th', { class: `sort ${cls || ''}`, text: `${label}${state.sort === key ? (state.dir < 0 ? ' ↓' : ' ↑') : ''}` });
      th.addEventListener('click', () => {
        state.dir = state.sort === key ? -state.dir : key === 'date' || key === 'value' ? -1 : 1;
        state.sort = key;
        render();
      });
      return th;
    };
    function render() {
      const rows = shown();
      const pages = Math.max(1, Math.ceil(rows.length / PAGE));
      state.page = Math.min(state.page, pages - 1);
      const page = rows.slice(state.page * PAGE, state.page * PAGE + PAGE);
      tableBox.replaceChildren(
        el(
          'table',
          null,
          el('thead', null, el('tr', null, head('date', 'Date'), head('site', 'Site'), head('param', 'Analyte'), head('value', 'Result', 'num'), el('th', { text: 'Unit' }))),
          el(
            'tbody',
            null,
            page.map((r) =>
              el(
                'tr',
                null,
                el('td', { style: 'white-space:nowrap', text: fmtDate(r.date) }),
                el('td', { text: S[r.site].code }),
                el('td', { text: P[r.p].name }),
                el('td', { class: `num${r.f ? ` f${r.f}` : ''}`, title: r.f ? noteOf(r) : null, text: valueText(r) }),
                el('td', { class: 'muted', text: P[r.p].unit || '' }),
              ),
            ),
          ),
        ),
      );
      const prev = el('button', { type: 'button', class: 'btn ghost', text: '‹ Newer', disabled: state.page === 0 });
      const next = el('button', { type: 'button', class: 'btn ghost', text: 'Older ›', disabled: state.page >= pages - 1 });
      prev.addEventListener('click', () => ((state.page -= 1), render()));
      next.addEventListener('click', () => ((state.page += 1), render()));
      pager.replaceChildren(el('span', { text: rows.length ? `${state.page * PAGE + 1}–${state.page * PAGE + page.length} of ${rows.length} results` : 'No results' }), rows.length > PAGE ? el('span', { style: 'display:flex;gap:6px' }, prev, next) : '');
    }
    render();
    out.append(cellKey());
    return out;
  }
}
