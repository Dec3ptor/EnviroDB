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
      expect(text, f).not.toMatch(/\bXMLHttpRequest\b|\bnew WebSocket\b|\bsendBeacon\b|\bnew EventSource\b/);
      expect(text, f).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(|new Function\(/);
      // the one service worker is field mode's offline copy (below)
      if (!f.replace(/\\/g, '/').endsWith('src/field/offline.ts')) expect(text, f).not.toMatch(/serviceWorker\.register/);
    }
  });

  it('the phone-to-computer link is direct only: no outside servers, and in one place', () => {
    const at = (f: string) => f.replace(/\\/g, '/');
    for (const { f, text } of source) {
      // the Wi-Fi link: only in its own file, with no servers to pass through or find addresses with
      if (!at(f).endsWith('src/field/link/rtc.ts')) expect(text, f).not.toMatch(/new RTCPeerConnection|webkitRTCPeerConnection|createDataChannel/);
      expect(text, f).not.toMatch(/\b(stun|turns?):/i);
      // the camera: only to read QR codes
      if (!at(f).endsWith('src/field/link/scan.ts')) expect(text, f).not.toMatch(/getUserMedia|getDisplayMedia/);
    }
    const rtc = readFileSync('src/field/link/rtc.ts', 'utf8');
    expect(rtc).toMatch(/const NO_SERVERS: RTCConfiguration = \{ iceServers: \[\] \};/);
    expect(rtc.match(/new RTCPeerConnection\(([^)]*)\)/g)).toEqual(['new RTCPeerConnection(NO_SERVERS)', 'new RTCPeerConnection(NO_SERVERS)']);
  });

  it('field mode’s offline copy only keeps the app’s own files', () => {
    const sw = readFileSync('public/sw.js', 'utf8');
    // it answers only reads of the app's own address, and never names another
    expect(sw).toMatch(/req\.method !== 'GET' \|\| !ours\(req\.url\)\) return;/);
    expect(sw).toMatch(/new URL\(url, self\.location\.href\)\.origin === self\.location\.origin/);
    expect(sw).not.toMatch(/https?:\/\/|importScripts|postMessage\(|indexedDB|\.put\(new Request/);
    expect(readFileSync('src/field/offline.ts', 'utf8')).toMatch(/register\('\.\/sw\.js'/);
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
