// Field mode works with no signal: a service worker keeps a copy of the app's files on the phone. It's started only
// by field mode, so EnviroDB on a computer is unchanged.

export type OfflineState = 'unsupported' | 'getting-ready' | 'ready' | 'failed';

/** Start keeping the app's files for offline use; resolves when they're kept. */
export async function keepOffline(): Promise<OfflineState> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return 'unsupported';
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    const worker = reg.active ?? (await new Promise<ServiceWorker | null>((resolve) => {
      const w = reg.installing ?? reg.waiting;
      if (!w) return resolve(null);
      w.addEventListener('statechange', () => w.state === 'activated' && resolve(w));
      setTimeout(() => resolve(reg.active), 8000);
    }));
    if (!worker) return 'failed';
    // every file this page has loaded: scripts, styles, fonts – and the page
    const urls = [location.href.split('#')[0], ...performance.getEntriesByType('resource').map((e) => e.name)].filter((u) => u.startsWith(location.origin));
    worker.postMessage({ type: 'keep', urls: [...new Set(urls)] });
    return 'ready';
  } catch {
    return 'failed';
  }
}
