// The page's Content Security Policy. EnviroDB keeps everything on the user's computer and in their workspace folder,
// and this makes the browser hold it to that: the page may load code only from its own address, and may contact
// nothing but its own address, the map services the Map tab draws its maps from, and the place search. Anything else –
// a later change, or a library gone bad – is refused by the browser. To contact another service, add it here: on
// purpose, and reviewed.
//
// The build adds it to index.html (not the dev server, which needs inline scripts and its own connection).

/** Map pictures for the Map tab: LINZ aerial photos, CARTO place names, OpenStreetMap streets, OpenTopoMap. */
export const MAP_TILE_HOSTS = ['https://basemaps.linz.govt.nz', 'https://*.basemaps.cartocdn.com', 'https://*.tile.openstreetmap.org', 'https://*.tile.opentopomap.org'];

/** The Map tab's place search (OpenStreetMap). */
export const PLACE_SEARCH_HOST = 'https://nominatim.openstreetmap.org';

export const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  // the app's own code only: nothing inline, nothing from elsewhere, no eval
  'script-src': ["'self'"],
  'worker-src': ["'self'", 'blob:'],
  // Mantine and the graph tooltips set styles inline
  'style-src': ["'self'", "'unsafe-inline'"],
  'font-src': ["'self'", 'data:', 'blob:'],
  'img-src': ["'self'", 'data:', 'blob:', ...MAP_TILE_HOSTS],
  // what the page may send requests to: itself, files in memory, and the place search
  'connect-src': ["'self'", 'data:', 'blob:', PLACE_SEARCH_HOST],
  'media-src': ["'self'", 'data:', 'blob:'],
  'object-src': ["'none'"],
  'frame-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
};

export const contentSecurityPolicy = (): string =>
  Object.entries(CSP_DIRECTIVES)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');

/** index.html with the policy as its first rule (straight after the character set). */
export function withCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy()}" />`;
  const at = html.search(/<meta charset[^>]*>/i);
  if (at < 0) return html.replace(/<head>/i, `<head>\n    ${meta}`);
  const end = html.indexOf('>', at) + 1;
  return `${html.slice(0, end)}\n    ${meta}${html.slice(end)}`;
}

/** Does a source list (e.g. img-src's) allow this address? Wildcards as CSP reads them: *.example.com. */
export function allows(sources: string[], url: string): boolean {
  const u = new URL(url);
  return sources.some((s) => {
    if (!/^https?:\/\//.test(s)) return false;
    const [scheme, host] = s.split('://');
    if (`${scheme}:` !== u.protocol) return false;
    return host.startsWith('*.') ? u.hostname.endsWith(host.slice(1)) && u.hostname !== host.slice(2) : u.hostname === host;
  });
}
