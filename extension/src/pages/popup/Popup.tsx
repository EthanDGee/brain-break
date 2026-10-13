import React, { useEffect, useMemo, useState } from 'react';

const API = 'http://localhost:8000';

type CategoryId = 'social' | 'shopping' | 'gaming' | 'productivity' | 'misc';

interface UsageEvent {
  domain: string;
  category: CategoryId;
  start: number;    // epoch milliseconds
  duration: number; // seconds
}

/* Category names + colors */
const CATEGORIES: { id: CategoryId; label: string; color: string }[] = [
  { id: 'social', label: 'Social Media', color: '#3B82F6' },
  { id: 'shopping', label: 'Shopping', color: '#EC4899' },
  { id: 'gaming', label: 'Gaming', color: '#22C55E' },
  { id: 'productivity', label: 'Productivity', color: '#F59E0B' },
  { id: 'misc', label: 'Miscellaneous', color: '#71717A' },
];
const COLOR: Record<CategoryId, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.color]),
) as Record<CategoryId, string>;

type Totals = Record<CategoryId, number>;

/* ---------- Helpers ---------- */
function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function shiftDay(dayMs: number, by: number) {
  const d = new Date(dayMs);
  d.setDate(d.getDate() + by);
  return startOfDay(d.getTime());
}
const emptyTotals = (): Totals => ({ social: 0, shopping: 0, gaming: 0, productivity: 0, misc: 0 });
const sum = (t: Totals) => Object.values(t).reduce((a, b) => a + b, 0);

function hourly(events: UsageEvent[], day: number): Totals[] {
  const hours = Array.from({ length: 24 }, emptyTotals);
  for (const e of events) {
    let t = e.start;
    const end = e.start + e.duration * 1000;
    while (t < end) {
      const hourStart = new Date(t).setMinutes(0, 0, 0);
      const next = Math.min(end, hourStart + 3600e3);
      if (startOfDay(hourStart) === day) {
        hours[new Date(hourStart).getHours()][e.category] += (next - t) / 1000;
      }
      t = next;
    }
  }
  return hours;
}
function daily(events: UsageEvent[], day: number): Totals {
  const out = emptyTotals();
  for (const h of hourly(events, day)) for (const c of CATEGORIES) out[c.id] += h[c.id];
  return out;
}
function sites(events: UsageEvent[], day: number) {
  const map = new Map<string, { domain: string; category: CategoryId; seconds: number }>();
  for (const e of events) {
    if (startOfDay(e.start) !== day) continue;
    const s = map.get(e.domain) ?? { domain: e.domain, category: e.category, seconds: 0 };
    s.seconds += e.duration;
    map.set(e.domain, s);
  }
  return [...map.values()].sort((a, b) => b.seconds - a.seconds);
}
function fmt(seconds: number) {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}
function dayLabel(day: number) {
  const today = startOfDay(Date.now());
  if (day === today) return 'Today';
  if (day === shiftDay(today, -1)) return 'Yesterday';
  return new Date(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/* ---------- UI pieces ---------- */
function StackedBar({ totals, max, height, dimmed }: { totals: Totals; max: number; height: number; dimmed?: boolean }) {
  const total = sum(totals);
  return (
    <div className="flex w-full flex-col justify-end" style={{ height }}>
      <div
        className="flex w-full flex-col-reverse overflow-hidden rounded-[3px]"
        style={{ height: Math.min(1, total / max) * height, opacity: dimmed ? 0.55 : 1 }}
      >
        {CATEGORIES.map((c) =>
          totals[c.id] > 0 ? (
            <div key={c.id} style={{ height: `${(totals[c.id] / total) * 100}%`, background: c.color }} />
          ) : null,
        )}
      </div>
    </div>
  );
}

function Grid({ labels, height }: { labels: string[]; height: number }) {
  return (
    <div className="pointer-events-none absolute inset-0" style={{ height }}>
      {labels.map((label, i) => (
        <div key={i} className="absolute left-0 right-0 border-t border-white/10" style={{ top: (i / (labels.length - 1)) * height }}>
          <span className="absolute -top-2 right-0 translate-x-full pl-1.5 text-[10px] text-zinc-500">{label}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Main popup ---------- */
export default function Popup() {
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    fetch(`${API}/sessions`)
      .then((r) => r.json())
      .then((rows: { domain: string; category: CategoryId; start_ms: number; end_ms: number }[]) => {
        setEvents(
          rows.map((r) => ({
            domain: r.domain,
            category: r.category,
            start: r.start_ms,
            duration: (r.end_ms - r.start_ms) / 1000,
          })),
        );
        setStatus('ok');
      })
      .catch(() => setStatus('error'));
  }, []);

  const today = startOfDay(Date.now());
  const [day, setDay] = useState(today);

  const view = useMemo(() => {
    const week = Array.from({ length: 7 }, (_, i) => shiftDay(day, i - new Date(day).getDay()));
    const weekTotals = week.map((d) => daily(events, d));
    const weekSums = weekTotals.map(sum);
    const used = weekSums.filter((s) => s > 0);
    const avg = used.length ? used.reduce((a, b) => a + b, 0) / used.length : 0;
    const maxHours = Math.max(2, Math.ceil(Math.max(...weekSums) / 7200) * 2);
    const totals = daily(events, day);
    return {
      week, weekTotals, avg, maxHours,
      totals,
      total: sum(totals),
      hours: hourly(events, day),
      topCats: CATEGORIES.filter((c) => totals[c.id] > 0).sort((a, b) => totals[b.id] - totals[a.id]).slice(0, 3),
      siteList: sites(events, day),
    };
  }, [events, day]);

  const WEEK_H = 96;
  const HOUR_H = 64;
  const weekMax = view.maxHours * 3600;
  const topSite = view.siteList[0]?.seconds ?? 1;

  return (
    <div className="w-[380px] bg-zinc-900 p-3 text-left font-sans text-white">
      {status === 'error' && (
        <p className="mb-3 rounded-lg bg-red-900/60 px-3 py-2 text-xs text-red-200">
          Can’t reach the server. Is uvicorn running on port 8000?
        </p>
      )}

      {/* ---------- TOP CARD ---------- */}
      <section className="rounded-xl bg-zinc-800 p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-zinc-400">Usage · {dayLabel(day)}</p>
            <p className="mt-0.5 text-3xl font-semibold tracking-tight">{fmt(view.total)}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setDay(shiftDay(day, -1))} className="rounded-md bg-zinc-700 px-2 py-1 text-sm hover:bg-zinc-600">‹</button>
            <button onClick={() => setDay(today)} disabled={day === today} className="rounded-md bg-zinc-700 px-2.5 py-1 text-xs hover:bg-zinc-600 disabled:opacity-40">Today</button>
            <button onClick={() => setDay(shiftDay(day, 1))} disabled={day >= today} className="rounded-md bg-zinc-700 px-2 py-1 text-sm hover:bg-zinc-600 disabled:opacity-40">›</button>
          </div>
        </div>

        {/* Weekly chart */}
        <div className="relative mr-7 mt-2">
          <Grid labels={[`${view.maxHours}h`, '', '0']} height={WEEK_H} />
          {view.avg > 0 && (
            <div className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-green-500/80" style={{ top: WEEK_H - (view.avg / weekMax) * WEEK_H }}>
              <span className="absolute -top-2 right-0 translate-x-full pl-1.5 text-[10px] text-green-500">avg</span>
            </div>
          )}
          <div className="relative flex gap-2">
            {view.week.map((d, i) => (
              <button key={d} onClick={() => d <= today && setDay(d)} className="flex flex-1 flex-col items-center">
                <StackedBar totals={view.weekTotals[i]} max={weekMax} height={WEEK_H} dimmed={d !== day} />
                <span className={`mt-1 text-[10px] ${d === day ? 'font-semibold text-white' : 'text-zinc-500'}`}>
                  {'SMTWTFS'[i]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Hourly chart */}
        <div className="relative mr-7 mt-4">
          <Grid labels={['60m', '30m', '0']} height={HOUR_H} />
          <div className="relative flex gap-[2px]">
            {view.hours.map((h, i) => (
              <div key={i} className="flex-1" title={`${i}:00 — ${fmt(sum(h))}`}>
                <StackedBar totals={h} max={3600} height={HOUR_H} />
              </div>
            ))}
          </div>
          <div className="relative mt-1 h-3 text-[10px] text-zinc-500">
            {['12 AM', '6 AM', '12 PM', '6 PM'].map((l, i) => (
              <span key={l} className="absolute" style={{ left: `${i * 25}%` }}>{l}</span>
            ))}
          </div>
        </div>

        {/* Category legend (top 3) */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {view.topCats.map((c) => (
            <div key={c.id}>
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: c.color }} />
                <span className="truncate">{c.label}</span>
              </div>
              <p className="mt-0.5 pl-3.5 text-sm font-medium">{fmt(view.totals[c.id])}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- SITE LIST ---------- */}
      <section className="mt-3 rounded-xl bg-zinc-800 py-1">
        {view.siteList.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">
            {status === 'loading' ? 'Loading…' : 'No browsing recorded yet.'}
          </p>
        )}
        {view.siteList.map((s) => (
          <div key={s.domain} className="flex items-center gap-3 px-4 py-2">
            <img
              src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=64`}
              className="h-7 w-7 rounded-md bg-white p-1"
              alt=""
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{s.domain}</span>
                <span className="shrink-0 text-zinc-400">{fmt(s.seconds)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1 flex-1 rounded-full bg-zinc-700">
                  <div className="h-1 rounded-full" style={{ width: `${(s.seconds / topSite) * 100}%`, background: COLOR[s.category] }} />
                </div>
                <span className="shrink-0 text-[10px] text-zinc-400">
                  {CATEGORIES.find((c) => c.id === s.category)?.label}
                </span>
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}