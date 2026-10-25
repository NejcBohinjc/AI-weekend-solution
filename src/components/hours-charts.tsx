"use client";

// Charts for the hours pages, in plain SVG with the --viz-* tokens (colour-blind safe in both themes) and
// text tokens for every label. Each has hover/focus tooltips, an aria-label and is shown inside a ChartCard
// that adds a text summary and a table view, so a tooltip is never the only way to read a value.
import { useState } from "react";
import type { DayHours } from "@/lib/hours/daily";
import type { Pace } from "@/lib/hours/time";
import { Legend, Tooltip, useWidth, type Tip } from "./charts";

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-GB");

/** Colour by how a member stands: met and on track are good, behind (or below target, for a finished week) is not. */
export const PACE_COLOR: Record<Pace, string> = { met: "var(--viz-3)", on_track: "var(--viz-1)", behind: "var(--viz-2)", below: "var(--viz-2)" };
export const LOCATION_COLOR = { office: "var(--viz-1)", home: "var(--viz-2)", unspecified: "var(--viz-neutral)" } as const;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [2, 4, 6, 8, 10].map((m) => m * p).find((n) => n >= v) ?? 10 * p;
}

/** A bar with a rounded top and a square base. */
function barPath(x: number, y: number, w: number, h: number, r = 6): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} a${rr},${rr} 0 0 1 ${rr},${-rr} h${w - 2 * rr} a${rr},${rr} 0 0 1 ${rr},${rr} V${y + h} z`;
}

// ---------- Progress ring ----------

/** Hours against the weekly target as a ring. Server-safe (no hooks); turns green at 100%. */
export function ProgressRing({ hours, target, size = 168 }: { hours: number; target: number; size?: number }) {
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = target > 0 ? hours / target : 0;
  const met = pct >= 1;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${fmt(hours)} of ${target} hours, ${Math.round(pct * 100)}%`} data-testid="progress-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-4)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={met ? "var(--viz-3)" : "var(--primary)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * Math.min(1, pct)} ${c}`}
          className="transition-[stroke-dasharray] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-display text-4xl font-semibold leading-none tabular-nums tracking-display">{fmt(hours)}</span>
        <span className="mt-1 text-sm text-muted">of {target} h</span>
        <span className={`mt-1 text-sm font-semibold tabular-nums ${met ? "text-success" : "text-fg-2"}`}>{Math.round(pct * 100)}%</span>
      </div>
    </div>
  );
}

// ---------- Office / home split ----------

export function SplitBar({ office, home, unspecified }: { office: number; home: number; unspecified: number }) {
  const total = office + home + unspecified;
  const parts = [
    { key: "office", label: "Office", value: office, color: LOCATION_COLOR.office },
    { key: "home", label: "Home", value: home, color: LOCATION_COLOR.home },
    { key: "unspecified", label: "Unspecified", value: unspecified, color: LOCATION_COLOR.unspecified },
  ].filter((p) => p.value > 0);
  return (
    <div className="flex flex-col gap-2" data-testid="split-bar">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-pill bg-surface-3" role="img" aria-label={parts.map((p) => `${p.label} ${fmt(p.value)} hours`).join(", ") || "No hours yet"}>
        {parts.map((p) => (
          <span key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} className="first:rounded-l-pill last:rounded-r-pill" />
        ))}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {parts.length === 0 && "Nothing logged yet."}
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: p.color }} />
            {p.label} <strong className="font-semibold text-fg tabular-nums">{fmt(p.value)} h</strong>
          </span>
        ))}
      </p>
    </div>
  );
}

// ---------- Day by day ----------

const H_DAY = 208;
const PAD = { top: 26, right: 12, bottom: 30, left: 34 };

/** One bar per day of the week, a dashed line for the even pace towards the target, a tooltip per day. */
export function DayBarsChart({ days, targetPerDay, ariaLabel }: { days: DayHours[]; targetPerDay: number | null; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const plotW = Math.max(60, width - PAD.left - PAD.right);
  const plotH = H_DAY - PAD.top - PAD.bottom;
  const top = niceMax(Math.max(0.5, ...days.map((d) => d.hours), targetPerDay ?? 0) * 1.1);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const slot = plotW / days.length;
  const bw = Math.min(44, slot * 0.64);
  const ticks = [0, top / 2, top];

  const show = (d: DayHours, i: number) =>
    setTip({
      x: PAD.left + slot * i + slot / 2,
      y: y(d.hours),
      title: d.label,
      rows: [
        { label: "in total", value: `${fmt(d.hours)} h` },
        ...(d.office > 0 ? [{ label: "office", value: `${fmt(d.office)} h`, color: LOCATION_COLOR.office }] : []),
        ...(d.home > 0 ? [{ label: "home", value: `${fmt(d.home)} h`, color: LOCATION_COLOR.home }] : []),
        ...(d.unspecified > 0 ? [{ label: "unspecified", value: `${fmt(d.unspecified)} h`, color: LOCATION_COLOR.unspecified }] : []),
      ],
    });

  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={H_DAY} role="img" aria-label={ariaLabel} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dominantBaseline="middle" textAnchor="end" className="fill-subtle text-xs tabular-nums">
                {fmt(t)}
              </text>
            </g>
          ))}
          {targetPerDay !== null && (
            <g>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(targetPerDay)} y2={y(targetPerDay)} stroke="var(--fg-2)" strokeWidth={1.5} strokeDasharray="5 4" />
              <text x={PAD.left + plotW} y={y(targetPerDay) - 6} textAnchor="end" className="fill-fg-2 text-xs font-medium">
                Even pace {fmt(targetPerDay)} h
              </text>
            </g>
          )}
          {days.map((d, i) => {
            const x = PAD.left + slot * i + (slot - bw) / 2;
            const h = Math.max(0, plotH - (y(d.hours) - PAD.top));
            return (
              <g
                key={d.date}
                tabIndex={0}
                aria-label={`${d.label}: ${fmt(d.hours)} hours`}
                onPointerMove={() => show(d, i)}
                onFocus={() => show(d, i)}
                onBlur={() => setTip(null)}
                className="outline-none focus-visible:[&>rect:first-child]:fill-surface-3"
              >
                <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH + PAD.bottom - 4} fill="transparent" />
                {d.future ? (
                  <line x1={x + bw / 2 - 6} x2={x + bw / 2 + 6} y1={y(0) - 2} y2={y(0) - 2} stroke="var(--viz-axis)" strokeWidth={2} strokeLinecap="round" />
                ) : h > 0.5 ? (
                  <path d={barPath(x, y(d.hours), bw, h)} fill="var(--viz-1)" opacity={d.today ? 1 : 0.88} />
                ) : (
                  <line x1={x + bw / 2 - 6} x2={x + bw / 2 + 6} y1={y(0) - 1} y2={y(0) - 1} stroke="var(--viz-neutral)" strokeWidth={2} strokeLinecap="round" />
                )}
                {!d.future && d.hours > 0 && (
                  <text x={x + bw / 2} y={y(d.hours) - 6} textAnchor="middle" className="fill-fg text-xs font-semibold tabular-nums">
                    {fmt(d.hours)}
                  </text>
                )}
                <text x={x + bw / 2} y={H_DAY - 8} textAnchor="middle" className={`text-xs ${d.today ? "fill-brand font-semibold" : "fill-muted"}`}>
                  {d.weekday}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------- Eight-week trend ----------

export type TrendWeek = { week: string; label: string; hours: number; href: string; selected: boolean };

/** The last weeks as bars (green when the target was met) with the target as a dashed line. Bars link to that week. */
export function TrendBars({ weeks, target, ariaLabel }: { weeks: TrendWeek[]; target: number; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const H = 190;
  const pad = { top: 24, right: 8, bottom: 28, left: 34 };
  const plotW = Math.max(60, width - pad.left - pad.right);
  const plotH = H - pad.top - pad.bottom;
  const top = niceMax(Math.max(1, target, ...weeks.map((w) => w.hours)) * 1.1);
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const slot = plotW / Math.max(1, weeks.length);
  const bw = Math.min(40, slot * 0.62);
  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={ariaLabel} className="block overflow-visible">
          {[0, top / 2, top].map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={pad.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
              <text x={pad.left - 8} y={y(t)} dominantBaseline="middle" textAnchor="end" className="fill-subtle text-xs tabular-nums">
                {fmt(t)}
              </text>
            </g>
          ))}
          <line x1={pad.left} x2={pad.left + plotW} y1={y(target)} y2={y(target)} stroke="var(--fg-2)" strokeWidth={1.5} strokeDasharray="5 4" />
          <text x={pad.left + plotW} y={y(target) - 6} textAnchor="end" className="fill-fg-2 text-xs font-medium">
            Target {target} h
          </text>
          {weeks.map((w, i) => {
            const x = pad.left + slot * i + (slot - bw) / 2;
            const h = Math.max(0, plotH - (y(w.hours) - pad.top));
            const met = w.hours >= target;
            return (
              <a
                key={w.week}
                href={w.href}
                aria-label={`Week of ${w.label}: ${fmt(w.hours)} hours${met ? ", target met" : ""}`}
                aria-current={w.selected ? "page" : undefined}
                onPointerMove={() => setTip({ x: pad.left + slot * i + slot / 2, y: y(w.hours), title: `Week of ${w.label}`, rows: [{ label: met ? "target met" : `of ${target} h`, value: `${fmt(w.hours)} h`, color: met ? "var(--viz-3)" : "var(--viz-1)" }] })}
                onFocus={() => setTip({ x: pad.left + slot * i + slot / 2, y: y(w.hours), title: `Week of ${w.label}`, rows: [{ label: met ? "target met" : `of ${target} h`, value: `${fmt(w.hours)} h`, color: met ? "var(--viz-3)" : "var(--viz-1)" }] })}
                onBlur={() => setTip(null)}
                className="outline-none focus-visible:[&>rect:first-child]:fill-surface-3"
              >
                <rect x={pad.left + slot * i} y={pad.top} width={slot} height={plotH + pad.bottom - 4} fill="transparent" />
                {h > 0.5 ? <path d={barPath(x, y(w.hours), bw, h, 5)} fill={met ? "var(--viz-3)" : "var(--viz-1)"} stroke={w.selected ? "var(--fg)" : "none"} strokeWidth={2} /> : <line x1={x + bw / 2 - 5} x2={x + bw / 2 + 5} y1={y(0) - 1} y2={y(0) - 1} stroke="var(--viz-neutral)" strokeWidth={2} strokeLinecap="round" />}
                {w.hours > 0 && (
                  <text x={x + bw / 2} y={y(w.hours) - 6} textAnchor="middle" className="fill-fg text-xs font-semibold tabular-nums">
                    {fmt(w.hours)}
                  </text>
                )}
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" className={`text-xs ${w.selected ? "fill-fg font-semibold" : "fill-muted"}`}>
                  {w.label}
                </text>
              </a>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------- Admin: members of a tier this week ----------

export type MemberBar = { id: number; name: string; hours: number; target: number; pace: Pace; paceLabel: string; working: boolean; href: string };

/** One horizontal bar per member (sorted by the caller), coloured by pace, a tick at the weekly target, a dot while working now. */
export function MemberHoursChart({ rows, ariaLabel }: { rows: MemberBar[]; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const ROW = 40;
  const BAR = 18;
  const labelW = Math.min(150, Math.round(width * 0.36));
  const valueW = 84;
  const plotW = Math.max(60, width - labelW - valueW);
  const top = Math.max(1, ...rows.map((r) => Math.max(r.hours, r.target))) * 1.04;
  const x = (v: number) => (Math.max(0, v) / top) * plotW;
  const maxChars = Math.max(8, Math.floor(labelW / 7.2));
  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={rows.length * ROW} role="img" aria-label={ariaLabel} className="block overflow-visible">
          <line x1={labelW} x2={labelW} y1={0} y2={rows.length * ROW} stroke="var(--viz-axis)" strokeWidth={1} />
          {rows.map((r, i) => {
            const cy = i * ROW + ROW / 2;
            const w = x(r.hours);
            const color = PACE_COLOR[r.pace];
            const show = () => setTip({ x: labelW + Math.min(w, plotW) / 2, y: i * ROW, title: r.name, rows: [{ label: `of ${r.target} h`, value: `${fmt(r.hours)} h`, color }, { label: r.working ? `${r.paceLabel}, working now` : r.paceLabel, value: "" }] });
            return (
              <a key={r.id} href={r.href} aria-label={`${r.name}: ${fmt(r.hours)} of ${r.target} hours, ${r.paceLabel}${r.working ? ", working now" : ""}`} onPointerMove={show} onFocus={show} onBlur={() => setTip(null)} className="outline-none focus-visible:[&>rect:first-child]:fill-surface-3">
                <rect x={0} y={i * ROW} width={width} height={ROW} fill="transparent" />
                {r.working && <circle cx={7} cy={cy} r={4.5} fill="var(--viz-3)" />}
                <text x={labelW - 10} y={cy} dominantBaseline="middle" textAnchor="end" className="fill-fg-2 text-sm">
                  {r.name.length > maxChars ? `${r.name.slice(0, maxChars - 1)}…` : r.name}
                </text>
                {w > 0.5 && <path d={`M${labelW},${cy - BAR / 2} h${Math.max(0, w - 6)} a6,6 0 0 1 6,6 v${BAR - 12} a6,6 0 0 1 -6,6 h${-Math.max(0, w - 6)} z`} fill={color} />}
                <line x1={labelW + x(r.target)} x2={labelW + x(r.target)} y1={cy - BAR / 2 - 4} y2={cy + BAR / 2 + 4} stroke="var(--fg)" strokeWidth={2} strokeLinecap="round" />
                <text x={labelW + Math.max(w, x(r.target)) + 10} y={cy} dominantBaseline="middle" className="fill-fg text-sm font-medium tabular-nums">
                  {fmt(r.hours)} / {r.target} h
                </text>
              </a>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

export function PaceLegend() {
  return (
    <Legend
      kind="rect"
      items={[
        { label: "Target met", color: PACE_COLOR.met },
        { label: "On track", color: PACE_COLOR.on_track },
        { label: "Behind", color: PACE_COLOR.behind },
      ]}
    />
  );
}

// ---------- Admin: eight weeks, stacked by tier ----------

export type StackSeries = { key: string; label: string; color: string; values: number[] };

/** Weekly hours of everyone, one column per week, stacked by tier (2 px gaps between the parts). */
export function StackedColumnChart({ xLabels, series, ariaLabel }: { xLabels: string[]; series: StackSeries[]; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const H = 230;
  const pad = { top: 26, right: 8, bottom: 28, left: 42 };
  const plotW = Math.max(60, width - pad.left - pad.right);
  const plotH = H - pad.top - pad.bottom;
  const totals = xLabels.map((_, i) => series.reduce((s, p) => s + (p.values[i] ?? 0), 0));
  const top = niceMax(Math.max(1, ...totals) * 1.08);
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const slot = plotW / Math.max(1, xLabels.length);
  const bw = Math.min(46, slot * 0.64);
  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={ariaLabel} className="block overflow-visible">
          {[0, top / 2, top].map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={pad.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
              <text x={pad.left - 8} y={y(t)} dominantBaseline="middle" textAnchor="end" className="fill-subtle text-xs tabular-nums">
                {Math.round(t)}
              </text>
            </g>
          ))}
          {xLabels.map((label, i) => {
            const x = pad.left + slot * i + (slot - bw) / 2;
            let acc = 0;
            const parts = series.filter((p) => (p.values[i] ?? 0) > 0);
            const show = () => setTip({ x: pad.left + slot * i + slot / 2, y: y(totals[i]), title: `Week of ${label}`, rows: [{ label: "in total", value: `${fmt(totals[i])} h` }, ...series.map((p) => ({ label: p.label, value: `${fmt(p.values[i] ?? 0)} h`, color: p.color }))] });
            return (
              <g key={label} tabIndex={0} aria-label={`Week of ${label}: ${fmt(totals[i])} hours`} onPointerMove={show} onFocus={show} onBlur={() => setTip(null)} className="outline-none focus-visible:[&>rect:first-child]:fill-surface-3">
                <rect x={pad.left + slot * i} y={pad.top} width={slot} height={plotH + pad.bottom - 4} fill="transparent" />
                {parts.map((p, k) => {
                  const v = p.values[i] ?? 0;
                  const y1 = y(acc + v);
                  const h = y(acc) - y1;
                  acc += v;
                  const isTop = k === parts.length - 1;
                  const gap = k > 0 ? 2 : 0;
                  return isTop ? <path key={p.key} d={barPath(x, y1, bw, Math.max(1, h - gap), 6)} fill={p.color} /> : <rect key={p.key} x={x} y={y1} width={bw} height={Math.max(1, h - gap)} fill={p.color} />;
                })}
                {totals[i] > 0 && (
                  <text x={x + bw / 2} y={y(totals[i]) - 7} textAnchor="middle" className="fill-fg text-xs font-semibold tabular-nums">
                    {Math.round(totals[i])}
                  </text>
                )}
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="fill-muted text-xs">
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}
