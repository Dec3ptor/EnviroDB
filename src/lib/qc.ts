// Quality control samples – duplicates and blanks – are kept out of the monitoring data. They're at a site of type
// "Quality control", or marked on the sample.

import type { Sample, Site } from '../db/types';

export const QC_SITE_TYPE = 'Quality control';
export const isQcSite = (s?: Pick<Site, 'type'> | null) => s?.type === QC_SITE_TYPE;
export const isQcSample = (s: Pick<Sample, 'qc'>, site?: Pick<Site, 'type'> | null) => !!s.qc || isQcSite(site);
