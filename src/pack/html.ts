// The data pack as one HTML file: the viewer and the data, with a security policy that lets it run only its own
// script and make no connections at all – it opens offline and sends nothing anywhere.

import viewerSource from './viewer.js?raw';
import type { PackData } from './model';
import { toBase64 } from '../lib/issued';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** JSON that is safe inside a <script> element (no "</script>", no line separators). */
export function scriptJson(x: unknown): string {
  return JSON.stringify(x).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** The script that draws the pack: the viewer, then a call with the data in the page. */
export const PACK_SCRIPT = `${viewerSource.trim()}\nrenderPack(JSON.parse(document.getElementById('pack-data').textContent), document.getElementById('pack'));\n`;

async function scriptHash(script: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script));
  return `sha256-${toBase64(new Uint8Array(digest))}`;
}

export async function packHtml(data: PackData): Promise<string> {
  const csp = `default-src 'none'; script-src '${await scriptHash(PACK_SCRIPT)}'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'`;
  const dark = data.look.theme === 'dark';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
<meta name="generator" content="EnviroDB ${esc(data.pack.app)} – data pack v${data.pack.version}">
<title>${esc(data.look.title)}</title>
<style>html,body{margin:0;background:${dark ? '#15191e' : '#f6f7f9'}}${data.look.theme === 'auto' ? '@media (prefers-color-scheme: dark){html,body{background:#15191e}}' : ''}noscript{display:block;padding:24px;font:16px sans-serif}</style>
</head>
<body>
<div id="pack"></div>
<noscript>This data pack needs JavaScript to show its graphs and tables.</noscript>
<script type="application/json" id="pack-data">${scriptJson(data)}</script>
<script type="module">${PACK_SCRIPT}</script>
</body>
</html>
`;
}
