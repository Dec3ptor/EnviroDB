import zlib from 'node:zlib';
import { db } from '../src/db/db';
import { buildIndex } from '../src/lib/dataIndex';
import type { ProjectBundle } from '../src/lib/analysis';
import { compareParams } from '../src/data/parameters';
import { isQcSite } from '../src/lib/qc';

/** Everything the report and analysis code needs about a project, read from the database. */
export async function loadBundle(projectId: string): Promise<ProjectBundle> {
  const project = (await db.projects.get(projectId))!;
  const sites = (await db.sites.where('projectId').equals(projectId).toArray()).sort((a, b) => a.order - b.order);
  const samples = (await db.samples.where('projectId').equals(projectId).toArray()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const results = await db.results.where('projectId').equals(projectId).toArray();
  const params = (await db.parameters.toArray()).sort(compareParams);
  const sets = await db.guidelineSets.toArray();
  // as the app does: quality control sites and samples apart
  const qcSites = sites.filter((s) => isQcSite(s));
  const isQc = (s: (typeof samples)[number]) => !!s.qc || qcSites.some((q) => q.id === s.siteId);
  return {
    project,
    sites: sites.filter((s) => !isQcSite(s)),
    siteMap: new Map(sites.map((s) => [s.id, s])),
    samples: samples.filter((s) => !isQc(s)),
    params,
    paramMap: new Map(params.map((p) => [p.id, p])),
    guidelineSets: sets,
    setMap: new Map(sets.map((s) => [s.id, s])),
    rules: (await db.rules.where('projectId').equals(projectId).toArray()).sort((a, b) => a.order - b.order),
    notes: await db.notes.where('projectId').equals(projectId).toArray(),
    schedules: await db.schedules.where('projectId').equals(projectId).toArray(),
    obligations: await db.obligations.where('projectId').equals(projectId).toArray(),
    index: buildIndex(samples, results, sites, params),
    qc: { sites: qcSites, samples: samples.filter(isQc), records: await db.qa.where('projectId').equals(projectId).toArray() },
    register: { conditions: await db.conditions.where('projectId').equals(projectId).toArray(), assessments: await db.assessments.where('projectId').equals(projectId).toArray() },
    continuous: { series: await db.series.where('projectId').equals(projectId).toArray(), days: await db.seriesDays.where('projectId').equals(projectId).toArray() },
  };
}

/** A plain white PNG of this size, as a data URL. */
export function png(width: number, height: number): string {
  const crc = (buf: Buffer) => zlib.crc32(buf);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td) >>> 0);
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = Buffer.alloc((width * 3 + 1) * height, 0xff);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0; // filter byte
  const file = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${file.toString('base64')}`;
}
