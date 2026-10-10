// Content script: runs on every webpage.
//
// Applies the two popup switches:
//   grayscale  → turns the whole page black & white
//   blockReels → hides YouTube Shorts and Instagram Reels, and sends you
//                away if you open one directly

interface Settings {
  grayscale: boolean;
  blockReels: boolean;
}

const host = location.hostname.replace(/^www\./, '');
const onYouTube = host === 'youtube.com' || host.endsWith('.youtube.com');
const onInstagram = host === 'instagram.com' || host.endsWith('.instagram.com');

// One <style> tag we fill in or empty depending on the settings.
const style = document.createElement('style');
style.id = 'brain-break-style';
document.documentElement.appendChild(style);

const GRAYSCALE_CSS = `html { filter: grayscale(1) !important; }`;

// YouTube changes its page structure often; add selectors here if Shorts sneak back in.
const YOUTUBE_SHORTS_CSS = `
  ytd-reel-shelf-renderer,
  ytd-rich-shelf-renderer[is-shorts],
  ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
  ytd-rich-item-renderer:has(a[href^="/shorts/"]),
  ytd-video-renderer:has(a[href^="/shorts/"]),
  ytd-grid-video-renderer:has(a[href^="/shorts/"]),
  grid-shelf-view-model:has(a[href^="/shorts/"]),
  ytm-shorts-lockup-view-model,
  ytd-guide-entry-renderer:has(a[title="Shorts"]),
  ytd-mini-guide-entry-renderer[aria-label="Shorts"],
  yt-chip-cloud-chip-renderer:has(yt-formatted-string[title="Shorts"]),
  yt-tab-shape[tab-title="Shorts"]
  { display: none !important; }
`;

const INSTAGRAM_REELS_CSS = `
  a[href="/reels/"],
  a[href^="/reels/"],
  div:has(> a[href="/reels/"])
  { display: none !important; }
`;

let settings: Settings = { grayscale: false, blockReels: false };

function apply() {
  let css = '';
  if (settings.grayscale) css += GRAYSCALE_CSS;
  if (settings.blockReels && onYouTube) css += YOUTUBE_SHORTS_CSS;
  if (settings.blockReels && onInstagram) css += INSTAGRAM_REELS_CSS;
  style.textContent = css;
  redirectIfReel();
}

// If a Short or Reel is opened directly, leave it.
function redirectIfReel() {
  if (!settings.blockReels) return;
  const path = location.pathname;
  if (onYouTube && path.startsWith('/shorts/')) {
    const id = path.split('/')[2];
    // Open the same video as a normal video instead of in the Shorts player.
    location.replace(id ? `/watch?v=${id}` : '/');
  } else if (onInstagram && (path.startsWith('/reels') || path.startsWith('/reel/'))) {
    location.replace('/');
  }
}

// Load saved settings, then keep up with changes from the popup.
chrome.storage.local.get(['grayscale', 'blockReels']).then((s) => {
  settings = { grayscale: !!s.grayscale, blockReels: !!s.blockReels };
  apply();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('grayscale' in changes) settings.grayscale = !!changes.grayscale.newValue;
  if ('blockReels' in changes) settings.blockReels = !!changes.blockReels.newValue;
  if ('grayscale' in changes || 'blockReels' in changes) apply();
});

// YouTube and Instagram change pages without reloading, so watch the URL.
if (onYouTube || onInstagram) {
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      redirectIfReel();
    }
  }, 500);
}

// --- Daily limits & employer blocks -------------------------------------------
const CATEGORY_LABELS: Record<string, string> = {
  social: 'Social Media',
  shopping: 'Shopping',
  gaming: 'Gaming',
  productivity: 'Productivity',
  misc: 'Miscellaneous',
};

interface LimitInfo {
  category: string;
  used_seconds: number;
  limit_seconds: number | null;
  blocked: boolean;
  reason: 'limit' | 'blocked_site' | null;
}

let isBlocked = false;

async function checkLimit() {
  if (isBlocked) return;
  let info: LimitInfo | null = null;
  try {
    info = await chrome.runtime.sendMessage({ type: 'check-limit', domain: host });
  } catch {
    return; // extension reloading, etc.
  }
  if (info?.blocked) showBlockScreen(info);
}

function limitText(seconds: number | null) {
  const mins = Math.round((seconds ?? 0) / 60);
  if (mins % 60 === 0) return `${mins / 60} hour${mins === 60 ? '' : 's'}`;
  return `${mins} minutes`;
}

function showBlockScreen(info: LimitInfo) {
  isBlocked = true;
  window.stop(); // stop the rest of the site loading
  const label = CATEGORY_LABELS[info.category] ?? info.category;

  const title =
    info.reason === 'blocked_site' ? 'This site is blocked' : "Sorry, time's up for today";
  const message =
    info.reason === 'blocked_site'
      ? `Your organization has blocked <strong style="color:#fafafa;">${host}</strong> on work devices.`
      : `You've used your ${limitText(info.limit_seconds)} of <strong style="color:#fafafa;">${label}</strong>
         for today, so <strong style="color:#fafafa;">${host}</strong> is blocked until midnight.`;

  document.documentElement.innerHTML = `
    <head><title>Blocked · Brain Break</title></head>
    <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
                 background:#18181b;color:#fafafa;font-family:-apple-system,system-ui,sans-serif;">
      <div style="max-width:440px;padding:32px;text-align:center;">
        <div style="font-size:56px;margin-bottom:12px;">${info.reason === 'blocked_site' ? '🚫' : '🧠'}</div>
        <h1 style="font-size:24px;margin:0 0 12px;">${title}</h1>
        <p style="font-size:16px;line-height:1.5;color:#a1a1aa;margin:0 0 24px;">${message}</p>
        <p style="font-size:14px;color:#71717a;margin:0;">Questions? Contact your manager or IT team.</p>
      </div>
    </body>`;
  // Some sites keep playing sound after the page is replaced; keep it quiet.
  setInterval(() => {
    document.querySelectorAll('video, audio').forEach((m) => (m as HTMLMediaElement).pause());
  }, 1000);
}

// Check when the page opens, then every minute while it stays open.
checkLimit();
setInterval(checkLimit, 60_000);

export {};
