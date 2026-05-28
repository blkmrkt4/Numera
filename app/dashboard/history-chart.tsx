import { formatMoney } from "@/lib/format";
import type { Currency } from "@/lib/types";

export type ChartPoint = {
  snapshot_date: string;
  value: number;
  carried: boolean;
};

/**
 * Server-rendered SVG line chart of net worth over time. Pure component:
 * no client interactivity beyond hovering, no JS bundle cost. Up to 24
 * monthly points per PRD §5.9; we render a simple line + filled area +
 * point markers and an x-axis label per quarter.
 */
export function HistoryChart({
  points,
  currency,
  privacy,
}: {
  points: ChartPoint[];
  currency: Currency;
  privacy: boolean;
}) {
  if (points.length < 2) return null;

  const width = 800;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 28, left: 56 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const values = points.map((p) => p.value);
  const minV = Math.min(...values, 0);
  const maxV = Math.max(...values, 0);
  const span = maxV - minV || 1;

  const x = (i: number) =>
    padding.left + (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const y = (v: number) => padding.top + plotH - ((v - minV) / span) * plotH;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(" ");

  const areaPath =
    linePath +
    ` L ${x(points.length - 1).toFixed(1)} ${(padding.top + plotH).toFixed(1)}` +
    ` L ${x(0).toFixed(1)} ${(padding.top + plotH).toFixed(1)} Z`;

  // Y-axis: 3 gridlines.
  const yTicks = [0, 0.5, 1].map((f) => minV + f * span);
  // X-axis labels: first, middle, last.
  const xLabels = (() => {
    if (points.length <= 3) return points.map((p, i) => ({ i, p }));
    const last = points.length - 1;
    return [0, Math.floor(last / 2), last].map((i) => ({ i, p: points[i] }));
  })();

  const latest = points[points.length - 1];
  const first = points[0];
  const delta = latest.value - first.value;
  const deltaPct = first.value !== 0 ? (delta / Math.abs(first.value)) * 100 : 0;
  const positive = delta >= 0;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Net worth — last {points.length} snapshot{points.length === 1 ? "" : "s"}
        </h2>
        <span className="text-xs tabular text-neutral-500">
          {positive ? "▲" : "▼"} {formatMoney(Math.abs(delta), currency, privacy)} (
          {deltaPct.toFixed(1)}%) since {formatMonth(first.snapshot_date)}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="block h-auto w-full"
          role="img"
          aria-label="Net worth over time"
        >
          {/* gridlines */}
          {yTicks.map((v, i) => (
            <g key={i}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y(v)}
                y2={y(v)}
                stroke="currentColor"
                strokeOpacity="0.08"
              />
              <text
                x={padding.left - 6}
                y={y(v) + 3}
                textAnchor="end"
                fontSize="10"
                fontFamily="ui-monospace, monospace"
                fill="currentColor"
                fillOpacity="0.55"
              >
                {privacy ? "•••" : compactMoney(v, currency)}
              </text>
            </g>
          ))}

          {/* area + line */}
          <path d={areaPath} fill="currentColor" fillOpacity="0.06" />
          <path
            d={linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* point markers */}
          {points.map((p, i) => (
            <g key={p.snapshot_date}>
              <circle
                cx={x(i)}
                cy={y(p.value)}
                r={p.carried ? 2 : 2.5}
                fill="currentColor"
                fillOpacity={p.carried ? 0.4 : 1}
              />
              <title>
                {p.snapshot_date}: {privacy ? "(hidden)" : formatMoney(p.value, currency)}
                {p.carried ? " (carried forward)" : ""}
              </title>
            </g>
          ))}

          {/* x-axis labels */}
          {xLabels.map(({ i, p }) => (
            <text
              key={p.snapshot_date}
              x={x(i)}
              y={height - 8}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              fontSize="10"
              fontFamily="ui-monospace, monospace"
              fill="currentColor"
              fillOpacity="0.55"
            >
              {formatMonth(p.snapshot_date)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}

function formatMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return iso;
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
  });
}

function compactMoney(n: number, currency: Currency): string {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : "CA$";
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${symbol}${Math.round(abs / 1_000)}k`;
  return `${sign}${symbol}${Math.round(abs)}`;
}
