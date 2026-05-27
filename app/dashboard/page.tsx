import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type AssetCategory,
  type Currency,
} from "@/lib/types";
import { formatMoney, relativeAge } from "@/lib/format";

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

  // Two queries (views don't expose FKs for PostgREST embed):
  // 1) all non-archived assets in this household,
  // 2) the latest-balance view, then join in JS.
  const [assetsResult, latestResult] = await Promise.all([
    supabase
      .from("assets")
      .select("id, name, category, native_currency, archived")
      .eq("archived", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("asset_latest_balances")
      .select("asset_id, amount, as_of_date"),
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

  // Group by category for the breakdown sections.
  const byCategory: Record<AssetCategory, AssetRow[]> = {
    real_estate: [],
    investment: [],
    cash: [],
    liability: [],
  };
  for (const a of assets) byCategory[a.category].push(a);

  // Sum per currency, treating liabilities as subtracting from net worth.
  const totals: Partial<Record<Currency, number>> = {};
  for (const a of assets) {
    const amt = a.latest ? Number(a.latest.amount) : 0;
    if (!Number.isFinite(amt) || amt === 0) continue;
    const signed = a.category === "liability" ? -Math.abs(amt) : amt;
    totals[a.native_currency] = (totals[a.native_currency] ?? 0) + signed;
  }
  const totalEntries = (Object.entries(totals) as [Currency, number][])
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-base font-medium tracking-tight">Numara</h1>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-neutral-500">{profile?.email ?? user.email}</span>
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
            <p className="text-sm text-neutral-500">Net worth</p>
            {totalEntries.length === 0 ? (
              <p className="mt-2 text-5xl font-medium tracking-tight tabular text-neutral-400">
                —
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                {totalEntries.map(([ccy, total]) => (
                  <p key={ccy} className="text-4xl font-medium tracking-tight tabular">
                    {formatMoney(total, ccy)}
                  </p>
                ))}
              </div>
            )}
            {totalEntries.length > 1 ? (
              <p className="mt-2 text-xs text-neutral-500">
                Per-currency totals — currency conversion lands in the next step.
              </p>
            ) : null}
          </div>
          <Link
            href="/assets/new"
            className="rounded-md bg-neutral-900 px-4 py-2.5 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
          >
            + Add asset
          </Link>
        </section>

        {assets.length === 0 ? (
          <section className="mt-16 rounded-md border border-dashed border-neutral-300 px-6 py-12 text-center dark:border-neutral-700">
            <p className="text-sm text-neutral-500">
              No assets yet. Add your first to start tracking.
            </p>
          </section>
        ) : (
          <section className="mt-12 space-y-10">
            {CATEGORY_ORDER.map((cat) => {
              const rows = byCategory[cat];
              if (rows.length === 0) return null;
              return <CategorySection key={cat} category={cat} rows={rows} />;
            })}
          </section>
        )}

        {profile?.is_system_admin ? (
          <p className="mt-16 text-xs text-neutral-400">
            Admin tools are not yet available.
          </p>
        ) : null}
      </main>
    </div>
  );
}

function CategorySection({
  category,
  rows,
}: {
  category: AssetCategory;
  rows: AssetRow[];
}) {
  // Per-currency subtotal for the category header.
  const subtotals: Partial<Record<Currency, number>> = {};
  for (const a of rows) {
    const amt = a.latest ? Number(a.latest.amount) : 0;
    if (!Number.isFinite(amt) || amt === 0) continue;
    subtotals[a.native_currency] = (subtotals[a.native_currency] ?? 0) + amt;
  }
  const subEntries = (Object.entries(subtotals) as [Currency, number][])
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => a.localeCompare(b));

  // Order rows within a category by latest amount (largest first), unvalued last.
  const sorted = [...rows].sort((a, b) => {
    const av = a.latest ? Number(a.latest.amount) : -Infinity;
    const bv = b.latest ? Number(b.latest.amount) : -Infinity;
    return bv - av;
  });

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {CATEGORY_LABELS[category]}
        </h2>
        <div className="flex flex-wrap gap-x-4 text-sm text-neutral-500 tabular">
          {subEntries.length === 0
            ? null
            : subEntries.map(([ccy, total]) => (
                <span key={ccy}>{formatMoney(total, ccy)}</span>
              ))}
        </div>
      </div>
      <ul className="mt-3 divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {sorted.map((a) => {
          const latest = a.latest;
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
                      <span className="ml-2">· updated {relativeAge(latest.as_of_date)}</span>
                    ) : (
                      <span className="ml-2 text-amber-700 dark:text-amber-500">
                        · no balance yet
                      </span>
                    )}
                  </p>
                </div>
                <p className="text-base tabular text-neutral-900 dark:text-neutral-100">
                  {latest ? formatMoney(latest.amount, a.native_currency) : "—"}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
