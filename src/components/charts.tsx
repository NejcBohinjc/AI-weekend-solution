"use client";

// Small plain-SVG charts for the admin analytics page. Colours come from the --viz-* tokens in
// globals.css (validated for colour-blind safety in both themes); text always uses text tokens.
// Every chart has a title, a one-line summary and a table (rendered by ChartCard), so a tooltip is
// never the only way to read a value.
import { useEffect, useRef, useState, type ReactNode } from "react";

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export type Tip = { x: number; y: number; title: string; rows: { label: string; value: string; color?: string }[] } | null;

export function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-32 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
      style={{ left: Math.max(4, tip.x), top: Math.max(0, tip.y), transform: "translate(-50%, calc(-100% - 8px))" }}
    >
      <p className="mb-1 font-medium text-muted">{tip.title}</p>
      {tip.rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2">
          {r.color && <span className="inline-block h-0.5 w-3 rounded" style={{ background: r.color }} aria-hidden />}
          <strong className="text-fg">{r.value}</strong>
          <span className="text-muted">{r.label}</span>
        </p>
      ))}
    </div>
  );
}

export function Legend({ items, kind = "line" }: { items: { label: string; color: string }[]; kind?: "line" | "rect" }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className={kind === "line" ? "inline-block h-0.5 w-4 rounded" : "inline-block size-2.5 rounded-sm"} style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Card with title, one-sentence summary, the chart, and a table view. */
export function ChartCard({ title, summary, children, table, id }: { title: string; summary: string; children: ReactNode; table?: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
      <div>
        <h2 id={id} className="font-display text-lg font-semibold tracking-display">
          {title}
        </h2>
        <p className="text-sm text-muted">{summary}</p>
      </div>
      {children}
      {table && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-fg">Show as table</summary>
          <div className="mt-2 overflow-x-auto">{table}</div>
        </details>
      )}
    </section>
  );
}

/** A plain table with numeric columns aligned. */
export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-line text-xs text-muted">
          {head.map((h, i) => (
            <th key={h} scope="col" className={`py-1.5 pr-3 font-medium ${i ? "text-right" : ""}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-line last:border-0">
            {r.map((c, j) => (
              <td key={j} className={`py-1.5 pr-3 ${j ? "text-right tabular-nums" : ""}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Horizontal bars ----------

export type BarRow = {
  key: string | number;
  label: string;
  value: number;
  /** Shown at the bar's tip (and in the tooltip). */
  valueLabel: string;
  color: string;
  /** Optional target tick on the same scale. */
  target?: number;
  /** Extra tooltip line, e.g. "On track". */
  note?: string;
  href?: string;
};

const BAR = 16;
const ROW = 32;

/** Bars from one baseline, value at the tip, optional target tick. Rows are the hover targets. */
export function HBarChart({ rows, max, ariaLabel, unit = "" }: { rows: BarRow[]; max?: number; ariaLabel: string; unit?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const labelW = Math.min(132, Math.round(width * 0.34));
  const valueW = 92;
  const plotW = Math.max(40, width - labelW - valueW);
  const top = Math.max(1, max ?? Math.max(...rows.map((r) => Math.max(r.value, r.target ?? 0)), 0));
  const x = (v: number) => (Math.max(0, v) / top) * plotW;

  if (!rows.length) return <p className="rounded-lg bg-surface-2 px-3 py-6 text-center text-sm text-subtle">Nothing to show yet.</p>;
  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={rows.length * ROW} role="img" aria-label={ariaLabel} className="block overflow-visible">
          <line x1={labelW} x2={labelW} y1={0} y2={rows.length * ROW} stroke="var(--viz-axis)" strokeWidth={1} />
          {rows.map((r, i) => {
            const y = i * ROW + (ROW - BAR) / 2;
            const w = x(r.value);
            const show = () => setTip({ x: labelW + Math.min(w, plotW) / 2, y: i * ROW, title: r.label, rows: [{ label: unit, value: r.valueLabel, color: r.color }, ...(r.note ? [{ label: "", value: r.note }] : [])] });
            return (
              <g key={r.key} tabIndex={0} aria-label={`${r.label}: ${r.valueLabel}${r.note ? `, ${r.note}` : ""}`} onPointerMove={show} onFocus={show} onBlur={() => setTip(null)} className="outline-none focus-visible:[&>rect:first-child]:fill-surface-3">
                <rect x={0} y={i * ROW} width={width} height={ROW} fill="transparent" />
                <text x={labelW - 8} y={i * ROW + ROW / 2} dominantBaseline="middle" textAnchor="end" className="fill-fg-2 text-xs">
                  {r.label.length > 18 && labelW < 120 ? `${r.label.slice(0, 16)}…` : r.label}
                </text>
                {w > 0 && (
                  // 4px rounded data end, square at the baseline
                  <path d={`M${labelW},${y} h${Math.max(0, w - 4)} a4,4 0 0 1 4,4 v${BAR - 8} a4,4 0 0 1 -4,4 h${-Math.max(0, w - 4)} z`} fill={r.color} />
                )}
                {r.target !== undefined && (
                  <line x1={labelW + x(r.target)} x2={labelW + x(r.target)} y1={y - 4} y2={y + BAR + 4} stroke="var(--fg)" strokeWidth={2} strokeLinecap="round" />
                )}
                <text x={labelW + Math.max(w, r.target !== undefined ? x(r.target) : 0) + 8} y={i * ROW + ROW / 2} dominantBaseline="middle" className="fill-fg text-xs tabular-nums">
                  {r.valueLabel}
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

// ---------- Stacked horizontal bars ----------

export type StackPart = { key: string; label: string; color: string };

/** One bar per row split into parts (2px surface gap between parts), total at the tip. Rows are the hover targets. */
export function StackedBarChart({
  parts,
  rows,
  ariaLabel,
  unit = "",
}: {
  parts: StackPart[];
  rows: { key: string; label: string; values: Record<string, number> }[];
  ariaLabel: string;
  unit?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const labelW = Math.min(132, Math.round(width * 0.3));
  const valueW = 64;
  const plotW = Math.max(40, width - labelW - valueW);
  const sum = (r: (typeof rows)[number]) => parts.reduce((s, p) => s + (r.values[p.key] ?? 0), 0);
  const top = Math.max(1, ...rows.map(sum));
  const x = (v: number) => (Math.max(0, v) / top) * plotW;
  const fmt = (n: number) => `${compact(n)}${unit ? ` ${unit}` : ""}`;

  if (!rows.some((r) => sum(r) > 0)) return <p className="rounded-lg bg-surface-2 px-3 py-6 text-center text-sm text-subtle">Nothing to show yet.</p>;
  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => setTip(null)}>
      <Legend kind="rect" items={parts.map((p) => ({ label: p.label, color: p.color }))} />
      {width > 0 && (
        <svg width={width} height={rows.length * ROW} role="img" aria-label={ariaLabel} className="mt-2 block overflow-visible">
          <line x1={labelW} x2={labelW} y1={0} y2={rows.length * ROW} stroke="var(--viz-axis)" strokeWidth={1} />
          {rows.map((r, i) => {
            const y = i * ROW + (ROW - BAR) / 2;
            const total = sum(r);
            const show = () =>
              setTip({ x: labelW + x(total) / 2, y: i * ROW, title: `${r.label}: ${fmt(total)}`, rows: parts.map((p) => ({ label: p.label, value: fmt(r.values[p.key] ?? 0), color: p.color })) });
            let at = labelW;
            return (
              <g
                key={r.key}
                tabIndex={0}
                aria-label={`${r.label}: ${parts.map((p) => `${p.label} ${fmt(r.values[p.key] ?? 0)}`).join(", ")}`}
                onPointerMove={show}
                onFocus={show}
                onBlur={() => setTip(null)}
                className="outline-none focus-visible:[&>rect:first-child]:fill-surface-3"
              >
                <rect x={0} y={i * ROW} width={width} height={ROW} fill="transparent" />
                <text x={labelW - 8} y={i * ROW + ROW / 2} dominantBaseline="middle" textAnchor="end" className="fill-fg-2 text-xs">
                  {r.label}
                </text>
                {parts.map((p) => {
                  const w = x(r.values[p.key] ?? 0);
                  if (w <= 0) return null;
                  const start = at;
                  at += w;
                  const gap = start > labelW ? 2 : 0; // surface gap between neighbouring parts
                  return <rect key={p.key} x={start + gap} y={y} width={Math.max(1, w - gap)} height={BAR} rx={start + w >= labelW + x(total) - 0.5 ? 4 : 0} fill={p.color} />;
                })}
                <text x={labelW + x(total) + 8} y={i * ROW + ROW / 2} dominantBaseline="middle" className="fill-fg text-xs tabular-nums">
                  {fmt(total)}
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

// ---------- Lines ----------

export type LineSeries = { key: string; label: string; color: string; values: number[] };

const LINE_H = 200;
const PAD = { top: 12, right: 64, bottom: 28, left: 40 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((n) => n >= v) ?? 10 * p;
}
const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(Math.round(n * 10) / 10));

/** Lines over weeks, one y axis, crosshair tooltip listing every series, end labels when they fit. */
export function LineChart({ xLabels, series, ariaLabel, unit = "" }: { xLabels: string[]; series: LineSeries[]; ariaLabel: string; unit?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(60, width - PAD.left - PAD.right);
  const plotH = LINE_H - PAD.top - PAD.bottom;
  const top = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const n = xLabels.length;
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const ticks = [0, top / 2, top];
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 56))));
  // End labels only when they don't collide.
  const ends = series.map((s) => ({ s, y: y(s.values[n - 1] ?? 0) })).sort((a, b) => a.y - b.y);
  const endsFit = ends.every((e, i) => i === 0 || e.y - ends[i - 1].y >= 14);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.left;
    setHover(Math.max(0, Math.min(n - 1, Math.round((px / plotW) * (n - 1)))));
  }

  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => setHover(null)}>
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
      {width > 0 && (
        <svg
          width={width}
          height={LINE_H}
          role="img"
          aria-label={ariaLabel}
          className="mt-2 block touch-pan-y"
          onPointerMove={onMove}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
          }}
          onBlur={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t)} dominantBaseline="middle" textAnchor="end" className="fill-subtle text-[11px] tabular-nums">
                {compact(t)}
              </text>
            </g>
          ))}
          {xLabels.map((l, i) =>
            i % every === 0 || i === n - 1 ? (
              <text key={i} x={x(i)} y={LINE_H - 8} textAnchor="middle" className="fill-subtle text-[11px]">
                {l}
              </text>
            ) : null,
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--viz-axis)" strokeWidth={1} />}
          {series.map((s) => (
            <g key={s.key}>
              <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={x(n - 1)} cy={y(s.values[n - 1] ?? 0)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              {hover !== null && <circle cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />}
            </g>
          ))}
          {endsFit &&
            ends.map(({ s, y: ey }) => (
              <text key={s.key} x={x(n - 1) + 8} y={ey} dominantBaseline="middle" className="fill-fg-2 text-[11px]">
                {s.values[n - 1] !== undefined ? compact(s.values[n - 1]) : ""} {series.length > 1 ? s.label : ""}
              </text>
            ))}
        </svg>
      )}
      <Tooltip
        tip={
          hover === null
            ? null
            : { x: x(hover), y: PAD.top + (series.length > 1 ? 28 : 8), title: xLabels[hover], rows: series.map((s) => ({ label: `${s.label}${unit ? ` (${unit})` : ""}`, value: compact(s.values[hover] ?? 0), color: s.color })) }
        }
      />
    </div>
  );
}
