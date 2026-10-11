import type { EChartsCoreOption } from 'echarts/core';
import { echarts } from './echarts';

export const cmToPx = (cm: number) => Math.round((cm / 2.54) * 96);

/** Render an ECharts option off-screen and return a PNG data URL. */
export function renderChartPng(option: EChartsCoreOption, widthPx: number, heightPx: number, pixelRatio = 3): string {
  const div = document.createElement('div');
  div.style.cssText = `position:fixed;left:-20000px;top:0;width:${widthPx}px;height:${heightPx}px;`;
  document.body.appendChild(div);
  const chart = echarts.init(div, undefined, { renderer: 'canvas', width: widthPx, height: heightPx, devicePixelRatio: pixelRatio });
  try {
    chart.setOption({ ...option, animation: false }, { notMerge: true, lazyUpdate: false });
    return chart.getDataURL({ type: 'png', pixelRatio, backgroundColor: '#ffffff' });
  } finally {
    chart.dispose();
    div.remove();
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/data:(.*?);/)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(',')[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Copy a PNG to the clipboard (Chrome/Edge) so it can be pasted straight into Word. */
export async function copyPngToClipboard(dataUrl: string): Promise<boolean> {
  try {
    const blob = dataUrlToBlob(dataUrl);
    const CI = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (!CI || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new CI({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
