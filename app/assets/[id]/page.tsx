import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, type Currency } from "@/lib/types";
import { formatDate, formatMoney, relativeAge, todayIso } from "@/lib/format";
import { addBalance, archiveAsset, unarchiveAsset } from "./actions";

export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error: errorParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: asset } = await supabase
    .from("assets")
    .select("id, name, category, native_currency, account_last4, archived, institution_id")
    .eq("id", id)
    .maybeSingle();

  if (!asset) notFound();

  const { data: institution } = asset.institution_id
    ? await supabase
        .from("institutions")
        .select("name")
        .eq("id", asset.institution_id)
        .maybeSingle()
    : { data: null };

  const { data: balances } = await supabase
    .from("balance_entries")
    .select("id, amount, as_of_date, source, created_at")
    .eq("asset_id", id)
    .order("as_of_date", { ascending: false })
    .order("created_at", { ascending: false });

  const currency = asset.native_currency as Currency;
  const latest = balances?.[0];

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link
            href="/dashboard"
            className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            ← Dashboard
          </Link>
          <h1 className="text-base font-medium tracking-tight">{asset.name}</h1>
          <span className="w-20" />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <section>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-neutral-500">
            <span>{CATEGORY_LABELS[asset.category as keyof typeof CATEGORY_LABELS]}</span>
            <span>·</span>
            <span>{asset.native_currency}</span>
            {institution?.name ? (
              <>
                <span>·</span>
                <span>{institution.name}</span>
              </>
            ) : null}
            {asset.account_last4 ? (
              <>
                <span>·</span>
                <span className="tabular">···· {asset.account_last4}</span>
              </>
            ) : null}
            {asset.archived ? (
              <>
                <span>·</span>
                <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                  Archived
                </span>
              </>
            ) : null}
          </div>

          <div className="mt-6">
            <p className="text-sm text-neutral-500">Current balance</p>
            <p className="mt-2 text-5xl font-medium tracking-tight tabular">
              {latest ? formatMoney(latest.amount, currency) : "—"}
            </p>
            {latest ? (
              <p className="mt-2 text-xs text-neutral-500">
                as of {formatDate(latest.as_of_date)} ({relativeAge(latest.as_of_date)})
              </p>
            ) : (
              <p className="mt-2 text-xs text-neutral-500">No balance yet.</p>
            )}
          </div>
        </section>

        {!asset.archived ? (
          <section className="mt-12">
            <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Add balance
            </h2>
            <form action={addBalance} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="asset_id" value={asset.id} />
              <label className="block text-sm text-neutral-600 dark:text-neutral-400">
                Amount ({currency})
                <input
                  type="text"
                  name="amount"
                  required
                  inputMode="decimal"
                  placeholder="0.00"
                  className="mt-1 block w-44 rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 tabular outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:focus:border-neutral-100"
                />
              </label>
              <label className="block text-sm text-neutral-600 dark:text-neutral-400">
                As of
                <input
                  type="date"
                  name="as_of_date"
                  required
                  defaultValue={todayIso()}
                  max={todayIso()}
                  className="mt-1 block w-44 rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:focus:border-neutral-100"
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
              >
                Save balance
              </button>
            </form>
            {errorParam ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{errorParam}</p>
            ) : null}
          </section>
        ) : null}

        <section className="mt-12">
          <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Balance history
          </h2>
          {balances && balances.length > 0 ? (
            <ul className="mt-3 divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {balances.map((b) => (
                <li
                  key={b.id}
                  className="flex items-baseline justify-between px-4 py-3 text-sm"
                >
                  <div>
                    <p className="tabular text-base font-medium text-neutral-900 dark:text-neutral-100">
                      {formatMoney(b.amount, currency)}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {formatDate(b.as_of_date)}
                      {b.source === "manual" ? (
                        <span className="ml-2 text-neutral-400">· manual</span>
                      ) : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-neutral-500">No balances yet.</p>
          )}
        </section>

        <section className="mt-16 border-t border-neutral-200 pt-6 dark:border-neutral-800">
          <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {asset.archived ? "Restore asset" : "Archive asset"}
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            {asset.archived
              ? "Restore to include this asset in totals again."
              : "Archived assets stay in the database but are excluded from totals."}
          </p>
          <form action={asset.archived ? unarchiveAsset : archiveAsset} className="mt-3">
            <input type="hidden" name="asset_id" value={asset.id} />
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
            >
              {asset.archived ? "Restore" : "Archive"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
