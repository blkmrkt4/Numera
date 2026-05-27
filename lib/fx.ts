import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Currency } from "@/lib/types";
import { CURRENCIES } from "@/lib/types";

// frankfurter.app — free, no API key, ECB-backed daily rates.
// We fetch with GBP as base because we need cross-rates among GBP/USD/CAD,
// and one call from any one of them gives us everything we need.
const FX_PROVIDER_URL = "https://api.frankfurter.app/latest";

export type RateLookup = Map<string, number>; // key: `${from}->${to}`

function key(from: Currency, to: Currency): string {
  return `${from}->${to}`;
}

/**
 * Load all the latest stored FX rates and return them as a lookup map.
 * Falls back to the most recent rate per (base, target) pair, which keeps
 * the dashboard rendering even if today's refresh hasn't happened yet.
 */
export async function loadLatestRates(
  supabase: SupabaseClient
): Promise<{ rates: RateLookup; asOf: string | null }> {
  // distinct on (base, target) ordered by date desc — one row per pair, freshest.
  // PostgREST doesn't have a `distinct on` operator, so we just pull recent
  // rows and dedupe client-side. With 6 pairs and one row per day, even
  // pulling 30 days is trivial (~180 rows).
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceIso = since.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("fx_rates")
    .select("date, base_currency, target_currency, rate")
    .gte("date", sinceIso)
    .order("date", { ascending: false });

  const rates: RateLookup = new Map();
  let asOf: string | null = null;

  // Identity rates are never stored — seed them as 1.
  for (const c of CURRENCIES) rates.set(key(c, c), 1);

  // Rows came back ordered date desc; first seen per pair wins.
  for (const row of data ?? []) {
    const k = key(row.base_currency as Currency, row.target_currency as Currency);
    if (rates.has(k)) continue;
    rates.set(k, Number(row.rate));
    if (!asOf || row.date > asOf) asOf = row.date;
  }

  return { rates, asOf };
}

/**
 * Convert an amount from one currency to another using a preloaded rate map.
 * Returns null if the conversion is not possible (rate unknown).
 */
export function convert(
  amount: number,
  from: Currency,
  to: Currency,
  rates: RateLookup
): number | null {
  if (from === to) return amount;
  const r = rates.get(key(from, to));
  if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) return null;
  return amount * r;
}

/**
 * Fetch latest cross-rates from frankfurter and upsert into fx_rates.
 * Stores all 6 directional cross-rates among GBP/USD/CAD for today's date.
 * Returns the rates and the as-of date frankfurter used (often today,
 * sometimes the previous business day if markets were closed).
 */
export async function refreshFxRates(): Promise<{
  asOf: string;
  inserted: number;
} | null> {
  const params = new URLSearchParams({ from: "GBP", to: "USD,CAD" });
  let payload: { date: string; rates: Record<string, number> };

  try {
    const res = await fetch(`${FX_PROVIDER_URL}?${params.toString()}`, {
      // Don't cache: we want fresh rates each call. Storage is our cache.
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[fx] frankfurter responded ${res.status}`);
      return null;
    }
    payload = await res.json();
  } catch (err) {
    console.error("[fx] frankfurter fetch failed:", err);
    return null;
  }

  const date = payload.date; // YYYY-MM-DD per frankfurter
  const gbpToUsd = payload.rates.USD;
  const gbpToCad = payload.rates.CAD;
  if (!gbpToUsd || !gbpToCad) {
    console.error("[fx] frankfurter payload missing rates", payload);
    return null;
  }

  // Derive all 6 cross-rates from the two we have.
  // GBP→GBP, USD→USD, CAD→CAD are identities — not stored.
  const cross: Array<[Currency, Currency, number]> = [
    ["GBP", "USD", gbpToUsd],
    ["GBP", "CAD", gbpToCad],
    ["USD", "GBP", 1 / gbpToUsd],
    ["CAD", "GBP", 1 / gbpToCad],
    ["USD", "CAD", gbpToCad / gbpToUsd],
    ["CAD", "USD", gbpToUsd / gbpToCad],
  ];

  const admin = createAdminClient();
  const { error } = await admin.from("fx_rates").upsert(
    cross.map(([base, target, rate]) => ({
      date,
      base_currency: base,
      target_currency: target,
      rate: rate.toFixed(10),
    })),
    { onConflict: "date,base_currency,target_currency" }
  );

  if (error) {
    console.error("[fx] upsert failed:", error);
    return null;
  }

  return { asOf: date, inserted: cross.length };
}

/**
 * Ensure today has FX rates. Best-effort, swallows failures: callers
 * should still render the dashboard with stale rates if refresh fails.
 */
export async function ensureFreshRates(supabase: SupabaseClient): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("fx_rates")
    .select("date")
    .gte("date", today)
    .limit(1);
  if (data && data.length > 0) return;

  await refreshFxRates();
}
