import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CSP_DIRECTIVES, allows, contentSecurityPolicy, withCsp } from '../src/security/csp';

// Every source file, to find the outside addresses the app contacts.
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.(ts|tsx)$/.test(f) ? [join(dir, f)] : []));
const source = files('src').map((f) => ({ f, text: readFileSync(f, 'utf8') }));

describe('Content Security Policy', () => {
  it('lets the page run only its own code and contact only its own address and the place search', () => {
    expect(CSP_DIRECTIVES['default-src']).toEqual(["'self'"]);
    expect(CSP_DIRECTIVES['script-src']).toEqual(["'self'"]); // no inline code, no eval, nothing from elsewhere
    expect(CSP_DIRECTIVES['connect-src']).toEqual(["'self'", 'data:', 'blob:', 'https://nominatim.openstreetmap.org']);
    expect(CSP_DIRECTIVES['object-src']).toEqual(["'none'"]);
    expect(CSP_DIRECTIVES['frame-src']).toEqual(["'none'"]);
    // no wide-open sources anywhere
    for (const [k, v] of Object.entries(CSP_DIRECTIVES)) for (const s of v) expect(['*', 'https:', 'http:', "'unsafe-eval'"], `${k} ${s}`).not.toContain(s);
  });

  it('allows every outside address the app’s code uses – and nothing new can be added without changing the policy', () => {
    // map pictures (Leaflet tile layers) are images; fetch() calls are connections
    const tiles = source.flatMap(({ text }) => Array.from(text.matchAll(/tileLayer\(\s*[`'"](https:\/\/[^`'"]+)/g), (m) => m[1].replace(/\{s\}/, 'a').replace(/\{[^}]+\}/g, '1').replace(/\$\{[^}]+\}/g, 'k')));
    const fetched = source.flatMap(({ text }) => Array.from(text.matchAll(/fetch\(\s*[`'"](https?:\/\/[^`'"$]+)/g), (m) => m[1]));
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    expect(fetched).toEqual(['https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=nz&limit=6&accept-language=en&q=']);
    for (const url of tiles) expect(allows(CSP_DIRECTIVES['img-src'], url), url).toBe(true);
    for (const url of fetched) expect(allows(CSP_DIRECTIVES['connect-src'], url), url).toBe(true);
    // and nothing else
    expect(allows(CSP_DIRECTIVES['connect-src'], 'https://example.com/upload')).toBe(false);
    expect(allows(CSP_DIRECTIVES['img-src'], 'https://tracker.example.com/p.gif')).toBe(false);
    expect(allows(CSP_DIRECTIVES['img-src'], 'https://tile.openstreetmap.org.evil.com/x.png')).toBe(false);
  });

  it('no other way of sending data out is used in the code', () => {
    for (const { f, text } of source) {
      expect(text, f).not.toMatch(/\bXMLHttpRequest\b|\bnew WebSocket\b|\bsendBeacon\b|\bnew EventSource\b|serviceWorker\.register/);
      expect(text, f).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(|new Function\(/);
    }
  });

  it('goes into the built page, straight after the character set', () => {
    const html = withCsp(readFileSync('index.html', 'utf8'));
    const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy()}" />`;
    expect(html).toContain(meta);
    expect(html.indexOf(meta)).toBeLessThan(html.indexOf('<title>'));
    expect(html.indexOf('<meta charset')).toBeLessThan(html.indexOf(meta));
    expect(readFileSync('vite.config.ts', 'utf8')).toMatch(/apply: 'build', transformIndexHtml: \(html: string\) => withCsp\(html\)/);
  });
});
