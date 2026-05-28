import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Currency, AssetCategory } from "@/lib/types";
import { CURRENCIES } from "@/lib/types";

type CategoryTotals = Record<AssetCategory, Record<Currency, number>>;
type CurrencyTotals = Record<Currency, number>;

export type SnapshotRow = {
  snapshot_date: string;
  totals_by_currency: CurrencyTotals;
  totals_by_category: CategoryTotals;
  any_carried: boolean;
  trigger: "auto_monthly" | "manual";
};

const EMPTY_CATEGORY_TOTALS = (): CategoryTotals => ({
  real_estate: { GBP: 0, USD: 0, CAD: 0 },
  investment: { GBP: 0, USD: 0, CAD: 0 },
  cash: { GBP: 0, USD: 0, CAD: 0 },
  liability: { GBP: 0, USD: 0, CAD: 0 },
});

const EMPTY_CURRENCY_TOTALS = (): CurrencyTotals => ({ GBP: 0, USD: 0, CAD: 0 });

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Compute and store a snapshot for the household as of `snapshotDate`
 * (defaults to today). Walks every non-archived asset, takes its latest
 * balance on-or-before snapshotDate, applies FX rates of (or most recent
 * prior to) snapshotDate, sums by category, and pre-computes the net
 * worth in each display currency.
 *
 * Returns null if there's nothing to snapshot (no assets), otherwise
 * the persisted snapshot row.
 */
export async function computeAndStoreSnapshot(
  householdId: string,
  snapshotDate: string = todayIso(),
  trigger: "auto_monthly" | "manual" = "manual"
): Promise<SnapshotRow | null> {
  const admin = createAdminClient();

  const { data: assets } = await admin
    .from("assets")
    .select("id, category, native_currency")
    .eq("household_id", householdId)
    .eq("archived", false);

  if (!assets || assets.length === 0) return null;

  // For each asset, pull the latest balance on-or-before snapshotDate.
  // (PRD §5.9 carry-forward: if no balance for the period, take the
  // most recent prior. With on-or-before LIMIT 1 DESC we get exactly
  // that behaviour. The "carried" flag fires when an asset's balance
  // pre-dates the snapshot by more than one month.)
  const oneMonthBefore = new Date(snapshotDate);
  oneMonthBefore.setMonth(oneMonthBefore.getMonth() - 1);
  const oneMonthBeforeIso = oneMonthBefore.toISOString().slice(0, 10);

  type LatestBalance = { asset_id: string; amount: number; as_of_date: string };
  const latestPerAsset = new Map<string, LatestBalance>();

  // Batch the queries — supabase doesn't have a native LATERAL helper
  // exposed in PostgREST, so we fetch one-by-one. With dozens of assets
  // this is fine; if it ever grows large we'd switch to a single RPC.
  for (const a of assets) {
    const { data } = await admin
      .from("balance_entries")
      .select("amount, as_of_date")
      .eq("asset_id", a.id)
      .lte("as_of_date", snapshotDate)
      .order("as_of_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);
    const row = data?.[0];
    if (!row) continue;
    latestPerAsset.set(a.id, {
      asset_id: a.id,
      amount: Number(row.amount),
      as_of_date: row.as_of_date,
    });
  }

  // FX rates: prefer the snapshot date; if missing, most recent prior.
  const fxRates = await loadFxRatesAsOf(admin, snapshotDate);

  const byCategory = EMPTY_CATEGORY_TOTALS();
  let anyCarried = false;
  for (const a of assets) {
    const balance = latestPerAsset.get(a.id);
    if (!balance) continue;
    if (balance.as_of_date < oneMonthBeforeIso) anyCarried = true;

    const cat = a.category as AssetCategory;
    const native = a.native_currency as Currency;
    for (const target of CURRENCIES) {
      const rate = native === target ? 1 : fxRates[`${native}->${target}`];
      if (typeof rate !== "number" || !Number.isFinite(rate)) continue;
      const converted = balance.amount * rate;
      const signed = cat === "liability" ? -Math.abs(converted) : converted;
      // Category subtotals retain the natural sign (liabilities go
      // negative for net-worth-style totals).
      byCategory[cat][target] += signed;
    }
  }

  const totalsByCurrency = EMPTY_CURRENCY_TOTALS();
  for (const cat of Object.keys(byCategory) as AssetCategory[]) {
    for (const ccy of CURRENCIES) {
      totalsByCurrency[ccy] += byCategory[cat][ccy];
    }
  }

  // Upsert — re-running for the same date replaces (handy for manual
  // re-snapshots after a correction). The unique constraint makes the
  // upsert deterministic.
  const { data: persisted, error } = await admin
    .from("net_worth_snapshots")
    .upsert(
      {
        household_id: householdId,
        snapshot_date: snapshotDate,
        totals_by_category: byCategory,
        totals_by_currency: totalsByCurrency,
        fx_rates_used: fxRates,
        trigger,
        any_carried: anyCarried,
      },
      { onConflict: "household_id,snapshot_date" }
    )
    .select("snapshot_date, totals_by_currency, totals_by_category, any_carried, trigger")
    .single();

  if (error) throw new Error(`Could not store snapshot: ${error.message}`);

  return persisted as unknown as SnapshotRow;
}

async function loadFxRatesAsOf(
  admin: ReturnType<typeof createAdminClient>,
  date: string
): Promise<Record<string, number>> {
  const since = new Date(date);
  since.setDate(since.getDate() - 30);
  const sinceIso = since.toISOString().slice(0, 10);

  const { data } = await admin
    .from("fx_rates")
    .select("date, base_currency, target_currency, rate")
    .gte("date", sinceIso)
    .lte("date", date)
    .order("date", { ascending: false });

  const map: Record<string, number> = {};
  for (const c of CURRENCIES) map[`${c}->${c}`] = 1;
  for (const row of data ?? []) {
    const key = `${row.base_currency}->${row.target_currency}`;
    if (!(key in map) || map[key] === 1) {
      map[key] = Number(row.rate);
    } else if (typeof map[key] !== "number") {
      map[key] = Number(row.rate);
    }
  }
  // First occurrence wins (rows came back date-desc, so it's the most recent).
  // The early-return inside the loop above keeps later occurrences from
  // overwriting.
  return map;
}

export async function loadSnapshots(
  householdId: string,
  limit = 24
): Promise<SnapshotRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("net_worth_snapshots")
    .select("snapshot_date, totals_by_currency, totals_by_category, any_carried, trigger")
    .eq("household_id", householdId)
    .order("snapshot_date", { ascending: true })
    .limit(limit);
  return (data ?? []) as unknown as SnapshotRow[];
}
