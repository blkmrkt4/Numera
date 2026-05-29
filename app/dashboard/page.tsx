import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CURRENCIES,
  type AssetCategory,
  type Currency,
} from "@/lib/types";
import { formatDate, formatMoney, isStale, relativeAge } from "@/lib/format";
import { readDisplayCurrencyCookie } from "@/lib/display-currency";
import { readPrivacyMode } from "@/lib/privacy";
import { convert, ensureFreshRates, loadLatestRates, type RateLookup } from "@/lib/fx";
import { loadSnapshots } from "@/lib/snapshots";
import { buildWealthTimeseries } from "@/lib/timeseries";
import { setDisplayCurrency, snapshotNow, togglePrivacyMode } from "./actions";
import { WealthChart } from "./wealth-chart";

type AssetRow = {
  id: string;
  name: string;
  category: AssetCategory;
  native_currency: Currency;
  archived: boolean;
  latest: { amount: string; as_of_date: string } | null;
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("email, household_id, is_system_admin")
    .eq("id", user.id)
    .maybeSingle();

  const { data: household } = profile?.household_id
    ? await supabase
        .from("households")
        .select("default_currency")
        .eq("id", profile.household_id)
        .maybeSingle()
    : { data: null };

  // Display currency: cookie wins, household default is the fallback,
  // GBP if neither is set (shouldn't happen — household default is NOT NULL).
  const cookieCurrency = await readDisplayCurrencyCookie();
  const displayCurrency: Currency =
    cookieCurrency ?? (household?.default_currency as Currency) ?? "GBP";

  // Privacy mode: hides every money figure server-side so the rendered
  // HTML never carries digits when the toggle is on (PRD §9).
  const privacy = await readPrivacyMode();

  // Make sure we have today's rates before computing totals.
  // Best-effort: failures fall back to most recent stored rate.
  await ensureFreshRates(supabase);
  const { rates, asOf: ratesAsOf } = await loadLatestRates(supabase);

  // Pull all non-archived assets + a lookup of latest balance per asset.
  const [assetsResult, latestResult] = await Promise.all([
    supabase
      .from("assets")
      .select("id, name, category, native_currency, archived")
      .eq("archived", false)
      .order("created_at", { ascending: false }),
    supabase.from("asset_latest_balances").select("asset_id, amount, as_of_date"),
  ]);

  const latestByAsset = new Map<string, { amount: string; as_of_date: string }>();
  for (const row of latestResult.data ?? []) {
    latestByAsset.set(row.asset_id, { amount: row.amount, as_of_date: row.as_of_date });
  }

  const assets: AssetRow[] = (assetsResult.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category as AssetCategory,
    native_currency: a.native_currency as Currency,
    archived: a.archived,
    latest: latestByAsset.get(a.id) ?? null,
  }));

  // Historical chart points — pre-computed snapshots, last 24 months.
  // We pull on every load because there's no real cost (a handful of
  // rows) and the user might have just clicked Snapshot now.
  const snapshots = profile?.household_id
    ? await loadSnapshots(profile.household_id, 24)
    : [];

  // Wealth-over-time chart data, computed live from raw balance entries so it
  // can break down by asset class / country / currency across all history.
  const timeseries = profile?.household_id
    ? await buildWealthTimeseries(profile.household_id, displayCurrency)
    : null;

  // Group by category for the breakdown.
  const byCategory: Record<AssetCategory, AssetRow[]> = {
    real_estate: [],
    investment: [],
    cash: [],
    liability: [],
  };
  for (const a of assets) byCategory[a.category].push(a);

  // Convert every latest balance to display currency.
  // Liabilities subtract; missing rates skip silently (no entry from that asset).
  let netWorth = 0;
  let anyMissingRate = false;
  for (const a of assets) {
    if (!a.latest) continue;
    const native = Number(a.latest.amount);
    if (!Number.isFinite(native) || native === 0) continue;
    const converted = convert(native, a.native_currency, displayCurrency, rates);
    if (converted === null) {
      anyMissingRate = true;
      continue;
    }
    netWorth += a.category === "liability" ? -Math.abs(converted) : converted;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-base font-medium tracking-tight">Numara</h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-500">{profile?.email ?? user.email}</span>
            <Tooltip label={privacy ? "Show all balances" : "Hide all balances"}>
              <form action={togglePrivacyMode}>
                <button
                  type="submit"
                  aria-label={privacy ? "Show all balances" : "Hide all balances"}
                  className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
                >
                  {privacy ? "👁" : "•"}
                </button>
              </form>
            </Tooltip>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <p className="text-sm text-neutral-500">Net worth</p>
              <Tooltip label="Switch display currency">
                <CurrencyToggle current={displayCurrency} />
              </Tooltip>
            </div>
            {assets.length === 0 ? (
              <p className="mt-2 text-5xl font-medium tracking-tight tabular text-neutral-400">
                —
              </p>
            ) : (
              <p className="mt-2 text-5xl font-medium tracking-tight tabular">
                {formatMoney(netWorth, displayCurrency, privacy)}
              </p>
            )}
            <p className="mt-2 text-xs text-neutral-500">
              {ratesAsOf ? (
                <>FX rates as of {formatDate(ratesAsOf)}</>
              ) : (
                <>FX rates not yet loaded</>
              )}
              {anyMissingRate ? (
                <span className="ml-2 text-amber-700 dark:text-amber-500">
                  · some balances skipped (missing FX)
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/capture"
              className="rounded-md border border-neutral-300 px-4 py-2.5 text-sm text-neutral-800 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-900"
            >
              Capture document
            </Link>
            <Link
              href="/assets/new"
              className="rounded-md bg-neutral-900 px-4 py-2.5 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
            >
              + Add asset
            </Link>
          </div>
        </section>

        {assets.length === 0 ? (
          <section className="mt-16 rounded-md border border-dashed border-neutral-300 px-6 py-12 text-center dark:border-neutral-700">
            <p className="text-sm text-neutral-500">
              No assets yet. Add your first to start tracking.
            </p>
          </section>
        ) : (
          <>
            <AlertsStrip assets={assets} />

            {timeseries && timeseries.months.length >= 2 ? (
              <section className="mt-10">
                <WealthChart data={timeseries} privacy={privacy} />
              </section>
            ) : null}

            <section className="mt-12 space-y-10">
              {CATEGORY_ORDER.map((cat) => {
                const rows = byCategory[cat];
                if (rows.length === 0) return null;
                return (
                  <CategorySection
                    key={cat}
                    category={cat}
                    rows={rows}
                    displayCurrency={displayCurrency}
                    rates={rates}
                    privacy={privacy}
                  />
                );
              })}
            </section>

            <section className="mt-12 border-t border-neutral-200 pt-6 dark:border-neutral-800">
              <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Snapshots
              </h2>
              <p className="mt-1 text-xs text-neutral-500">
                {snapshots.length === 0
                  ? "No snapshots yet. Take one to start a history."
                  : `${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"} on file. Auto-monthly snapshots arrive when this is deployed; until then take them manually.`}
              </p>
              <form action={snapshotNow} className="mt-3">
                <button
                  type="submit"
                  className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
                >
                  Snapshot now
                </button>
              </form>
            </section>
          </>
        )}

        {profile?.is_system_admin ? (
          <p className="mt-16 text-xs text-neutral-400">
            <Link href="/admin/settings" className="underline hover:text-neutral-600">
              Admin
            </Link>
          </p>
        ) : null}
      </main>
    </div>
  );
}

// CSS-only hover/focus tooltip. No JS state, so it works inside server
// components and appears instantly (unlike the ~1s native `title` delay).
// Positioned below its trigger so the header's top edge never clips it.
function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-xs text-white opacity-0 shadow-sm transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {label}
      </span>
    </span>
  );
}

function CurrencyToggle({ current }: { current: Currency }) {
  return (
    <form action={setDisplayCurrency} className="flex overflow-hidden rounded-md border border-neutral-300 text-xs dark:border-neutral-700">
      {CURRENCIES.map((c) => {
        const active = c === current;
        return (
          <button
            key={c}
            type="submit"
            name="currency"
            value={c}
            aria-pressed={active}
            className={
              "px-2.5 py-1 tabular transition-colors " +
              (active
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900")
            }
          >
            {c}
          </button>
        );
      })}
    </form>
  );
}

function AlertsStrip({ assets }: { assets: AssetRow[] }) {
  // Stale = no balance ever, or latest balance > 90 days old (PRD §5.6).
  const stale = assets
    .filter((a) => isStale(a.latest?.as_of_date))
    .sort((a, b) => {
      const ad = a.latest?.as_of_date ?? "0";
      const bd = b.latest?.as_of_date ?? "0";
      return ad.localeCompare(bd);
    });

  if (stale.length === 0) return null;

  return (
    <section className="mt-8 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <p className="font-medium">
        {stale.length === 1
          ? "1 asset needs a fresh balance"
          : `${stale.length} assets need a fresh balance`}
      </p>
      <ul className="mt-2 space-y-1 text-xs">
        {stale.slice(0, 5).map((a) => (
          <li key={a.id} className="flex items-baseline justify-between gap-3">
            <Link href={`/assets/${a.id}`} className="underline">
              {a.name}
            </Link>
            <span className="text-amber-700 dark:text-amber-400">
              {a.latest
                ? `updated ${relativeAge(a.latest.as_of_date)}`
                : "never updated"}
            </span>
          </li>
        ))}
        {stale.length > 5 ? (
          <li className="text-amber-700 dark:text-amber-400">
            + {stale.length - 5} more
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function CategorySection({
  category,
  rows,
  displayCurrency,
  rates,
  privacy,
}: {
  category: AssetCategory;
  rows: AssetRow[];
  displayCurrency: Currency;
  rates: RateLookup;
  privacy: boolean;
}) {
  // Subtotal in display currency (liabilities still positive at the category
  // level — they only subtract from the headline net worth).
  let subtotal = 0;
  let anyMissing = false;
  for (const a of rows) {
    if (!a.latest) continue;
    const native = Number(a.latest.amount);
    if (!Number.isFinite(native) || native === 0) continue;
    const converted = convert(native, a.native_currency, displayCurrency, rates);
    if (converted === null) {
      anyMissing = true;
      continue;
    }
    subtotal += converted;
  }

  // Sort within category: largest converted amount first; unvalued last.
  const sorted = [...rows].sort((a, b) => {
    const av = a.latest ? convert(Number(a.latest.amount), a.native_currency, displayCurrency, rates) ?? -Infinity : -Infinity;
    const bv = b.latest ? convert(Number(b.latest.amount), b.native_currency, displayCurrency, rates) ?? -Infinity : -Infinity;
    return bv - av;
  });

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {CATEGORY_LABELS[category]}
        </h2>
        <span className="text-sm text-neutral-500 tabular">
          {formatMoney(subtotal, displayCurrency, privacy)}
          {anyMissing ? <span className="ml-2 text-amber-700 dark:text-amber-500">·</span> : null}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {sorted.map((a) => {
          const latest = a.latest;
          const native = latest ? Number(latest.amount) : null;
          const converted =
            latest && native !== null && Number.isFinite(native)
              ? convert(native, a.native_currency, displayCurrency, rates)
              : null;
          const showConversion =
            latest && a.native_currency !== displayCurrency && converted !== null;

          const rowIsStale = isStale(latest?.as_of_date);
          return (
            <li key={a.id}>
              <Link
                href={`/assets/${a.id}`}
                className="flex items-baseline justify-between px-4 py-3 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <div>
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {a.name}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {a.native_currency}
                    {latest ? (
                      <span
                        className={
                          "ml-2 " +
                          (rowIsStale
                            ? "text-amber-700 dark:text-amber-500"
                            : "")
                        }
                      >
                        · updated {relativeAge(latest.as_of_date)}
                      </span>
                    ) : (
                      <span className="ml-2 text-amber-700 dark:text-amber-500">
                        · no balance yet
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-base tabular text-neutral-900 dark:text-neutral-100">
                    {latest ? formatMoney(latest.amount, a.native_currency, privacy) : "—"}
                  </p>
                  {showConversion ? (
                    <p className="text-xs tabular text-neutral-500">
                      ≈ {formatMoney(converted!, displayCurrency, privacy)}
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
