import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  COUNTRY_LABELS,
  type AssetCategory,
  type Currency,
} from "@/lib/types";

// Live-computed wealth time series. Rather than relying on stored snapshots
// (which only carry by-category / by-display-currency totals), we rebuild the
// monthly series straight from raw balance entries so the chart can break the
// composition down by asset class, country, OR native currency across the
// whole history — and so newly-added history shows up without waiting for a
// snapshot job. PRD §5.4 (historical FX per point), §5.6, §5.9.

export type Dimension = "category" | "country" | "currency";

export type SeriesPoint = {
  month: string; // YYYY-MM
  groups: Record<string, number>; // signed display-currency value (liabilities negative)
};

export type DimensionSeries = {
  // Group keys in legend order, each with a stable display label.
  keys: { key: string; label: string }[];
  points: SeriesPoint[];
};

export type AssetCagr = {
  assetId: string;
  name: string;
  category: AssetCategory;
  startValue: number;
  endValue: number;
  years: number;
  cagrPct: number | null; // null when undefined (too short, zero, or sign flip)
};

export type WealthTimeseries = {
  currency: Currency;
  months: string[];
  totals: number[]; // net worth per month, display currency
  byCategory: DimensionSeries;
  byCountry: DimensionSeries;
  byCurrency: DimensionSeries;
  totalCagrPct: number | null;
  totalSpanYears: number;
  perAsset: AssetCagr[];
};

type AssetMeta = {
  id: string;
  name: string;
  category: AssetCategory;
  native: Currency;
  country: string; // resolved group key, "ZZ" = unknown
};

type Balance = { amount: number; as_of_date: string };

const UNKNOWN_COUNTRY = "ZZ";
const MAX_MONTHS = 24;

export async function buildWealthTimeseries(
  householdId: string,
  currency: Currency
): Promise<WealthTimeseries | null> {
  const admin = createAdminClient();

  const [assetsRes, institutionsRes, propertiesRes] = await Promise.all([
    admin
      .from("assets")
      .select("id, name, category, native_currency, institution_id")
      .eq("household_id", householdId)
      .eq("archived", false),
    admin.from("institutions").select("id, country").eq("household_id", householdId),
    admin.from("properties").select("asset_id, country"),
  ]);

  const assets = assetsRes.data ?? [];
  if (assets.length === 0) return null;

  const instCountry = new Map<string, string | null>();
  for (const i of institutionsRes.data ?? []) instCountry.set(i.id, i.country);
  const propCountry = new Map<string, string | null>();
  for (const p of propertiesRes.data ?? []) propCountry.set(p.asset_id, p.country);

  const meta: AssetMeta[] = assets.map((a) => {
    const country =
      a.category === "real_estate"
        ? propCountry.get(a.id) ?? null
        : a.institution_id
          ? instCountry.get(a.institution_id) ?? null
          : null;
    return {
      id: a.id,
      name: a.name,
      category: a.category as AssetCategory,
      native: a.native_currency as Currency,
      country: country || UNKNOWN_COUNTRY,
    };
  });

  const assetIds = meta.map((m) => m.id);
  const { data: balanceRows } = await admin
    .from("balance_entries")
    .select("asset_id, amount, as_of_date")
    .in("asset_id", assetIds)
    .order("as_of_date", { ascending: true });

  const balancesByAsset = new Map<string, Balance[]>();
  let earliest: string | null = null;
  for (const b of balanceRows ?? []) {
    const arr = balancesByAsset.get(b.asset_id) ?? [];
    arr.push({ amount: Number(b.amount), as_of_date: b.as_of_date });
    balancesByAsset.set(b.asset_id, arr);
    if (!earliest || b.as_of_date < earliest) earliest = b.as_of_date;
  }
  if (!earliest) return null;

  const fx = await loadFxHistory(admin, earliest);

  // Month buckets from first activity to the current month, capped at the
  // most recent MAX_MONTHS.
  let months = monthRange(earliest.slice(0, 7), todayMonth());
  if (months.length > MAX_MONTHS) months = months.slice(months.length - MAX_MONTHS);

  const catSeries = emptySeries();
  const countrySeries = emptySeries();
  const ccySeries = emptySeries();
  const totals: number[] = [];

  for (const month of months) {
    const asOf = monthEndIso(month);
    const cat: Record<string, number> = {};
    const country: Record<string, number> = {};
    const ccy: Record<string, number> = {};
    let total = 0;

    for (const m of meta) {
      const bal = latestOnOrBefore(balancesByAsset.get(m.id), asOf);
      if (bal == null) continue;
      const rate = fx.rateAsOf(m.native, currency, asOf);
      if (rate == null) continue;
      const value = bal * rate;
      const signed = m.category === "liability" ? -Math.abs(value) : value;
      cat[m.category] = (cat[m.category] ?? 0) + signed;
      country[m.country] = (country[m.country] ?? 0) + signed;
      ccy[m.native] = (ccy[m.native] ?? 0) + signed;
      total += signed;
    }

    catSeries.push({ month, groups: cat });
    countrySeries.push({ month, groups: country });
    ccySeries.push({ month, groups: ccy });
    totals.push(total);
  }

  // Per-asset CAGR from each asset's own first→last actual entry (converted at
  // the respective dates), so a recently-added asset isn't judged over the
  // whole household span.
  const perAsset: AssetCagr[] = [];
  for (const m of meta) {
    const arr = balancesByAsset.get(m.id);
    if (!arr || arr.length === 0) continue;
    const firstB = arr[0];
    const lastB = arr[arr.length - 1];
    const r0 = fx.rateAsOf(m.native, currency, firstB.as_of_date);
    const r1 = fx.rateAsOf(m.native, currency, lastB.as_of_date);
    if (r0 == null || r1 == null) continue;
    const startValue = firstB.amount * r0;
    const endValue = lastB.amount * r1;
    const years = daysBetween(firstB.as_of_date, lastB.as_of_date) / 365.25;
    perAsset.push({
      assetId: m.id,
      name: m.name,
      category: m.category,
      startValue,
      endValue,
      years,
      cagrPct: cagr(startValue, endValue, years),
    });
  }

  const totalSpanYears = (months.length - 1) / 12;

  return {
    currency,
    months,
    totals,
    byCategory: finalizeSeries("category", catSeries, currency),
    byCountry: finalizeSeries("country", countrySeries, currency),
    byCurrency: finalizeSeries("currency", ccySeries, currency),
    totalCagrPct: cagr(totals[0], totals[totals.length - 1], totalSpanYears),
    totalSpanYears,
    perAsset,
  };
}

// ── group ordering + labels ─────────────────────────────────────────────

function finalizeSeries(
  dim: Dimension,
  points: SeriesPoint[],
  _currency: Currency
): DimensionSeries {
  const last = points[points.length - 1]?.groups ?? {};
  const present = new Set<string>();
  for (const p of points) for (const k of Object.keys(p.groups)) present.add(k);

  let ordered: string[];
  if (dim === "category") {
    ordered = CATEGORY_ORDER.filter((c) => present.has(c));
  } else {
    // Largest current absolute contribution first; unknown sinks to the end.
    ordered = [...present].sort((a, b) => {
      if (a === UNKNOWN_COUNTRY) return 1;
      if (b === UNKNOWN_COUNTRY) return -1;
      return Math.abs(last[b] ?? 0) - Math.abs(last[a] ?? 0);
    });
  }

  const keys = ordered.map((key) => ({ key, label: labelFor(dim, key) }));
  return { keys, points };
}

function labelFor(dim: Dimension, key: string): string {
  if (dim === "category") return CATEGORY_LABELS[key as AssetCategory] ?? key;
  if (dim === "currency") return key;
  if (key === UNKNOWN_COUNTRY) return "Unknown";
  return COUNTRY_LABELS[key] ?? key;
}

function emptySeries(): SeriesPoint[] {
  return [];
}

// ── FX history ──────────────────────────────────────────────────────────

type FxHistory = {
  rateAsOf: (base: Currency, target: Currency, dateIso: string) => number | null;
};

async function loadFxHistory(
  admin: ReturnType<typeof createAdminClient>,
  earliest: string
): Promise<FxHistory> {
  const since = new Date(earliest);
  since.setDate(since.getDate() - 35);
  const sinceIso = since.toISOString().slice(0, 10);

  const { data } = await admin
    .from("fx_rates")
    .select("date, base_currency, target_currency, rate")
    .gte("date", sinceIso)
    .order("date", { ascending: false });

  // pair key → rows sorted date-desc
  const byPair = new Map<string, { date: string; rate: number }[]>();
  for (const r of data ?? []) {
    const key = `${r.base_currency}->${r.target_currency}`;
    const arr = byPair.get(key) ?? [];
    arr.push({ date: r.date, rate: Number(r.rate) });
    byPair.set(key, arr);
  }

  return {
    rateAsOf(base, target, dateIso) {
      if (base === target) return 1;
      const arr = byPair.get(`${base}->${target}`);
      if (!arr || arr.length === 0) return null;
      // Most recent rate on-or-before the date; fall back to the oldest known.
      const hit = arr.find((r) => r.date <= dateIso);
      return (hit ?? arr[arr.length - 1]).rate;
    },
  };
}

// ── small date / math helpers ─────────────────────────────────────────────

function todayMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function monthRange(startMonth: string, endMonth: string): string[] {
  const out: string[] = [];
  let [y, m] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function monthEndIso(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate(); // day 0 of next month = last of this
  const today = new Date().toISOString().slice(0, 10);
  const iso = `${month}-${String(last).padStart(2, "0")}`;
  return iso > today ? today : iso; // don't read the future for the current month
}

function latestOnOrBefore(balances: Balance[] | undefined, asOf: string): number | null {
  if (!balances || balances.length === 0) return null;
  let value: number | null = null;
  for (const b of balances) {
    if (b.as_of_date <= asOf) value = b.amount;
    else break; // balances are sorted ascending
  }
  return value;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function cagr(start: number, end: number, years: number): number | null {
  if (years < 0.5) return null; // too short to annualise meaningfully
  if (start === 0 || end === 0) return null;
  if (Math.sign(start) !== Math.sign(end)) return null; // crossed zero
  const ratio = Math.abs(end) / Math.abs(start);
  return (Math.pow(ratio, 1 / years) - 1) * 100;
}
