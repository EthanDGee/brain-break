// Watches which website the user is actually looking at and records
// { domain, start_ms, end_ms } sessions, then sends them to the FastAPI server.
//
// A session ends when the user switches tab, navigates to another site,
// leaves the browser, or goes idle. Every minute the current session is also
// "checkpointed" (saved and restarted) so nothing big is lost if Brave closes.

const API = 'http://localhost:8000';
const IDLE_SECONDS = 60;

interface Current { domain: string; start: number }
interface SessionOut { domain: string; start_ms: number; end_ms: number }

// Run handlers one at a time so events that fire together don't clash.
let chain: Promise<unknown> = Promise.resolve();
const run = (fn: () => Promise<void>) => {
  chain = chain.then(fn).catch((e) => console.error('[tracker]', e));
};

function domainOf(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null; // skip brave://, new tab, etc.
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// The in-progress session survives the service worker going to sleep.
async function getCurrent(): Promise<Current | null> {
  const { current } = await chrome.storage.session.get('current');
  return (current as Current) ?? null;
}
const setCurrent = (current: Current | null) => chrome.storage.session.set({ current });

// Finished sessions wait here until the server confirms it saved them.
async function enqueue(s: SessionOut) {
  if (s.end_ms - s.start_ms < 1000) return; // ignore sub-second blips
  const { pending = [] } = await chrome.storage.local.get('pending');
  await chrome.storage.local.set({ pending: [...(pending as SessionOut[]), s] });
}

async function flush() {
  const { pending = [] } = await chrome.storage.local.get('pending');
  const batch = pending as SessionOut[];
  if (batch.length === 0) return;
  try {
    const res = await fetch(`${API}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { pending: latest = [] } = await chrome.storage.local.get('pending');
    await chrome.storage.local.set({ pending: (latest as SessionOut[]).slice(batch.length) });
  } catch (e) {
    console.warn('[tracker] server unreachable, will retry', e);
  }
}

/** Which domain is the user looking at right now? null = nothing / away. */
async function activeDomain(): Promise<string | null> {
  const win = await chrome.windows.getLastFocused();
  if (!win.focused) return null;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return null;
  const idle = await chrome.idle.queryState(IDLE_SECONDS);
  // Watching a video with no mouse movement still counts as active.
  if (idle !== 'active' && !tab.audible) return null;
  return domainOf(tab.url);
}

/** Close the current session if the user moved on, and start a new one. */
async function refresh() {
  const now = Date.now();
  const domain = await activeDomain();
  const current = await getCurrent();
  if (current?.domain === domain) return;
  if (current) await enqueue({ domain: current.domain, start_ms: current.start, end_ms: now });
  await setCurrent(domain ? { domain, start: now } : null);
  await flush();
}

/** Save the current session so far and keep going (runs every minute). */
async function checkpoint() {
  const now = Date.now();
  const current = await getCurrent();
  if (current) {
    await enqueue({ domain: current.domain, start_ms: current.start, end_ms: now });
    await setCurrent({ domain: current.domain, start: now });
  }
  await refresh();
  await flush();
}

chrome.idle.setDetectionInterval(IDLE_SECONDS);
chrome.alarms.create('checkpoint', { periodInMinutes: 1 });

chrome.tabs.onActivated.addListener(() => run(refresh));
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.url || info.audible !== undefined) run(refresh);
});
chrome.windows.onFocusChanged.addListener(() => run(refresh));
chrome.idle.onStateChanged.addListener(() => run(refresh));
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'checkpoint') run(checkpoint);
});
chrome.runtime.onStartup.addListener(() => run(refresh));
chrome.runtime.onInstalled.addListener(() => run(refresh));

run(refresh);


// --- Daily limits -------------------------------------------------------------
// Webpages ask "am I allowed?" here. We save the current session first so the
// server's total is up to date, then ask the server.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'check-limit') return;
  run(checkpoint);
  chain
    .then(() => fetch(`${API}/check?domain=${encodeURIComponent(msg.domain)}`))
    .then((r) => (r as Response).json())
    .then(sendResponse)
    .catch(() => sendResponse(null)); // server down → don't block
  return true; // we'll answer asynchronously
});


// --- Employer focus filters ------------------------------------------------
// The employer turns Grayscale / Block Shorts & Reels on or off in the admin
// dashboard. We copy those settings into extension storage, and the content
// script on every page applies them instantly.
async function syncPolicy() {
  try {
    const res = await fetch(`${API}/policy`);
    if (!res.ok) return;
    const p = await res.json();
    await chrome.storage.local.set({ grayscale: !!p.grayscale, blockReels: !!p.block_reels });
  } catch {
    // Server unreachable: keep the last known settings.
  }
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'checkpoint') syncPolicy(); // every minute
});
chrome.tabs.onActivated.addListener(() => syncPolicy()); // and whenever you switch tabs
syncPolicy();