"use client";

import { useMemo, useState } from "react";
// Type-only import: the runtime module is server-only, but types are erased
// at compile time so this never pulls server code into the client bundle.
import type { Dimension, WealthTimeseries } from "@/lib/timeseries";
import type { Currency } from "@/lib/types";
import { colorForSeries as colorFor } from "@/lib/chart-palette";

type LiabMode = "net" | "gross";

const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: "category", label: "Asset class" },
  { key: "country", label: "Country" },
  { key: "currency", label: "Currency" },
];

export function WealthChart({
  data,
  privacy,
}: {
  data: WealthTimeseries;
  privacy: boolean;
}) {
  const [dimension, setDimension] = useState<Dimension>("category");
  const [liabMode, setLiabMode] = useState<LiabMode>("net");

  const series =
    dimension === "category"
      ? data.byCategory
      : dimension === "country"
        ? data.byCountry
        : data.byCurrency;

  const months = data.months;
  const n = months.length;

  const W = 860;
  const H = 380;
  const pad = { top: 28, right: 150, bottom: 34, left: 10 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const xAt = (i: number) =>
    n <= 1 ? pad.left + plotW / 2 : pad.left + (i * plotW) / (n - 1);

  const stack = useMemo(() => {
    const bands = new Map<string, { lo: number; hi: number }[]>();
    for (const k of series.keys) bands.set(k.key, []);
    const totalLine: number[] = [];
    let minVal = 0;
    let maxVal = 0;
    for (const p of series.points) {
      let pos = 0;
      let neg = 0;
      let gross = 0;
      for (const { key } of series.keys) {
        const v = p.groups[key] ?? 0;
        let lo = 0;
        let hi = 0;
        if (liabMode === "gross") {
          if (v > 0) {
            lo = pos;
            hi = pos + v;
            pos = hi;
            gross += v;
          }
        } else if (v >= 0) {
          lo = pos;
          hi = pos + v;
          pos = hi;
        } else {
          hi = neg;
          lo = neg + v;
          neg = lo;
        }
        bands.get(key)!.push({ lo, hi });
      }
      maxVal = Math.max(maxVal, pos);
      minVal = Math.min(minVal, neg);
      totalLine.push(liabMode === "gross" ? gross : pos + neg);
    }
    return { bands, totalLine, minVal, maxVal };
  }, [series, liabMode]);

  if (n < 2) {
    return (
      <p className="text-sm text-neutral-500">
        Not enough history yet — add balances across at least two months to see
        the trend.
      </p>
    );
  }

  const span = stack.maxVal - stack.minVal || 1;
  const yAt = (v: number) => pad.top + plotH - ((v - stack.minVal) / span) * plotH;

  // Inline labels at the right edge, de-collided vertically.
  const labels = series.keys
    .map(({ key, label }, idx) => {
      const band = stack.bands.get(key)![n - 1];
      const v = series.points[n - 1].groups[key] ?? 0;
      return {
        key,
        label,
        v,
        color: colorFor(dimension, key, idx),
        yMid: yAt((band.lo + band.hi) / 2),
      };
    })
    .filter((l) => Math.abs(l.v) > 0)
    .sort((a, b) => a.yMid - b.yMid);
  const GAP = 15;
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].yMid - labels[i - 1].yMid < GAP) {
      labels[i].yMid = labels[i - 1].yMid + GAP;
    }
  }

  const latestTotal = stack.totalLine[n - 1];
  const firstTotal = stack.totalLine[0];

  const xLabelIdx =
    n <= 3 ? months.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Composition over time
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            options={DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))}
            value={dimension}
            onChange={(v) => setDimension(v as Dimension)}
          />
          <Segmented
            options={[
              { value: "net", label: "Net" },
              { value: "gross", label: "Gross assets" },
            ]}
            value={liabMode}
            onChange={(v) => setLiabMode(v as LiabMode)}
          />
        </div>
      </div>

      <div className="mt-3 overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full text-neutral-900 dark:text-neutral-100"
          role="img"
          aria-label={`Wealth composition by ${dimension} over time`}
        >
          {/* zero baseline (only meaningful when liabilities pull below zero) */}
          {stack.minVal < 0 ? (
            <line
              x1={pad.left}
              x2={pad.left + plotW}
              y1={yAt(0)}
              y2={yAt(0)}
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeDasharray="3 3"
            />
          ) : null}

          {/* stacked areas */}
          {series.keys.map(({ key }, idx) => {
            const band = stack.bands.get(key)!;
            if (band.every((b) => b.hi - b.lo < 0.0001)) return null;
            const top = band.map((b, i) => `${xAt(i).toFixed(1)},${yAt(b.hi).toFixed(1)}`);
            const bot = band
              .map((b, i) => ({ b, i }))
              .reverse()
              .map(({ b, i }) => `${xAt(i).toFixed(1)},${yAt(b.lo).toFixed(1)}`);
            const d = `M ${top.join(" L ")} L ${bot.join(" L ")} Z`;
            return (
              <path
                key={key}
                d={d}
                fill={colorFor(dimension, key, idx)}
                fillOpacity="0.9"
                stroke="white"
                strokeOpacity="0.35"
                strokeWidth="0.5"
              />
            );
          })}

          {/* total line on top of the stack */}
          <path
            d={stack.totalLine
              .map((t, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(t).toFixed(1)}`)
              .join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeOpacity="0.7"
          />

          {/* total lollipops: first + last */}
          {[0, n - 1].map((i) => {
            const t = stack.totalLine[i];
            return (
              <g key={`tot-${i}`}>
                <line
                  x1={xAt(i)}
                  x2={xAt(i)}
                  y1={yAt(Math.max(0, stack.minVal))}
                  y2={yAt(t)}
                  stroke="currentColor"
                  strokeOpacity="0.35"
                />
                <circle cx={xAt(i)} cy={yAt(t)} r="3" fill="currentColor" />
                <text
                  x={xAt(i)}
                  y={yAt(t) - 8}
                  textAnchor={i === 0 ? "start" : "end"}
                  fontSize="12"
                  fontWeight="600"
                  fontFamily="ui-monospace, monospace"
                  fill="currentColor"
                >
                  {compact(t, data.currency, privacy)}
                </text>
              </g>
            );
          })}

          {/* inline series labels */}
          {labels.map((l) => (
            <g key={l.key}>
              <line
                x1={pad.left + plotW}
                x2={pad.left + plotW + 6}
                y1={l.yMid}
                y2={l.yMid}
                stroke={l.color}
                strokeWidth="1"
              />
              <text
                x={pad.left + plotW + 9}
                y={l.yMid + 3}
                fontSize="11"
                fontFamily="ui-monospace, monospace"
                fill={l.color}
              >
                {l.label} {compact(l.v, data.currency, privacy)}
              </text>
            </g>
          ))}

          {/* x-axis month labels */}
          {xLabelIdx.map((i) => (
            <text
              key={`x-${i}`}
              x={xAt(i)}
              y={H - 10}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              fontSize="10"
              fontFamily="ui-monospace, monospace"
              fill="currentColor"
              fillOpacity="0.55"
            >
              {formatMonth(months[i])}
            </text>
          ))}
        </svg>
      </div>

      {/* CAGR */}
      <CagrPanel data={data} privacy={privacy} latest={latestTotal} first={firstTotal} />
    </div>
  );
}

function CagrPanel({
  data,
  privacy,
  latest,
  first,
}: {
  data: WealthTimeseries;
  privacy: boolean;
  latest: number;
  first: number;
}) {
  const rows = [...data.perAsset].sort((a, b) => {
    if (a.cagrPct == null) return 1;
    if (b.cagrPct == null) return -1;
    return b.cagrPct - a.cagrPct;
  });

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Growth (CAGR)
        </h3>
        <p className="text-xs text-neutral-500">
          Total{" "}
          <span className="tabular text-neutral-900 dark:text-neutral-100">
            {fmtCagr(data.totalCagrPct)}
          </span>{" "}
          · {compact(first, data.currency, privacy)} →{" "}
          {compact(latest, data.currency, privacy)} over{" "}
          {data.totalSpanYears.toFixed(1)} yrs
        </p>
      </div>
      {rows.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">Asset</th>
                <th className="px-3 py-2 text-right">Start</th>
                <th className="px-3 py-2 text-right">Latest</th>
                <th className="px-3 py-2 text-right">CAGR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {rows.map((r) => (
                <tr key={r.assetId} className="text-neutral-700 dark:text-neutral-300">
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right tabular">
                    {compact(r.startValue, data.currency, privacy)}
                  </td>
                  <td className="px-3 py-2 text-right tabular">
                    {compact(r.endValue, data.currency, privacy)}
                  </td>
                  <td className="px-3 py-2 text-right tabular">{fmtCagr(r.cagrPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-neutral-300 text-xs dark:border-neutral-700">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={
              "px-2.5 py-1 transition-colors " +
              (active
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function fmtCagr(pct: number | null): string {
  if (pct == null) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%/yr`;
}

function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
  });
}

function compact(n: number, currency: Currency, privacy: boolean): string {
  if (privacy) return "•••";
  const sym = currency === "GBP" ? "£" : currency === "USD" ? "$" : "CA$";
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}${sym}${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}${sym}${Math.round(a / 1_000)}k`;
  return `${sign}${sym}${Math.round(a)}`;
}
