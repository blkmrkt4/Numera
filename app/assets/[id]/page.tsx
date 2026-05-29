import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  COUNTRY_LABELS,
  COUNTRY_ORDER,
  type Currency,
  type SaleCostOverrides,
} from "@/lib/types";
import { formatDate, formatMoney, isStale, relativeAge, todayIso } from "@/lib/format";
import { ACCEPT_ATTRIBUTE } from "@/lib/document-constants";
import { getSignedDocumentUrl } from "@/lib/documents";
import { readPrivacyMode } from "@/lib/privacy";
import {
  addBalance,
  archiveAsset,
  deleteBalance,
  unarchiveAsset,
  updateAssetDetails,
  updateBalance,
} from "./actions";
import {
  addValuation,
  deleteValuation,
  updateProperty,
  updateValuation,
} from "./property-actions";
import { SaleScenarioPanel } from "./sale-scenario";
import { ConfirmSubmit } from "./confirm-submit";

export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string; edit?: string }>;
}) {
  const { id } = await params;
  const { error: errorParam, ok: okParam, edit: editId } = await searchParams;

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

  const currency = asset.native_currency as Currency;
  const isProperty = asset.category === "real_estate";
  const privacy = await readPrivacyMode();

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
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

      <main className="mx-auto max-w-5xl px-6 py-12">
        <AssetMeta
          asset={asset}
          institutionName={institution?.name ?? null}
        />

        {okParam ? (
          <p className="mt-4 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
            {okParam}
          </p>
        ) : null}
        {errorParam ? (
          <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {errorParam}
          </p>
        ) : null}

        {isProperty ? (
          <PropertyView
            assetId={asset.id}
            currency={currency}
            archived={asset.archived}
            privacy={privacy}
            editId={editId ?? null}
          />
        ) : (
          <StandardAssetView
            assetId={asset.id}
            currency={currency}
            archived={asset.archived}
            privacy={privacy}
            editId={editId ?? null}
          />
        )}

        {!asset.archived ? (
          <section className="mt-16 border-t border-neutral-200 pt-6 dark:border-neutral-800">
            <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Edit asset
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              Rename or fix the category. Switching to or from real estate
              adds or removes its property record; balance history is kept.
            </p>
            <form
              action={updateAssetDetails}
              className="mt-3 flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="asset_id" value={asset.id} />
              <label className="block text-sm text-neutral-600 dark:text-neutral-400">
                Name
                <input
                  type="text"
                  name="name"
                  required
                  defaultValue={asset.name}
                  className="mt-1 block w-64 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:focus:border-neutral-100"
                />
              </label>
              <label className="block text-sm text-neutral-600 dark:text-neutral-400">
                Category
                <select
                  name="category"
                  defaultValue={asset.category}
                  className="mt-1 block w-48 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:focus:border-neutral-100"
                >
                  {CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-neutral-600 dark:text-neutral-400">
                Institution <span className="text-neutral-400">(optional)</span>
                <input
                  type="text"
                  name="institution"
                  defaultValue={institution?.name ?? ""}
                  placeholder="e.g. Charles Schwab"
                  className="mt-1 block w-64 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:focus:border-neutral-100"
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
              >
                Save
              </button>
            </form>
          </section>
        ) : null}

        <section className="mt-12 border-t border-neutral-200 pt-6 dark:border-neutral-800">
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

function AssetMeta({
  asset,
  institutionName,
}: {
  asset: { category: string; native_currency: string; account_last4: string | null; archived: boolean };
  institutionName: string | null;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-neutral-500">
      <span>{CATEGORY_LABELS[asset.category as keyof typeof CATEGORY_LABELS]}</span>
      <span>·</span>
      <span>{asset.native_currency}</span>
      {institutionName ? (
        <>
          <span>·</span>
          <span>{institutionName}</span>
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
  );
}

// ─────────────────────────────────────────────────────────────────────
// Standard (non-property) asset view
// ─────────────────────────────────────────────────────────────────────

async function StandardAssetView({
  assetId,
  currency,
  archived,
  privacy,
  editId,
}: {
  assetId: string;
  currency: Currency;
  archived: boolean;
  privacy: boolean;
  editId: string | null;
}) {
  const supabase = await createClient();

  const { data: balances } = await supabase
    .from("balance_entries")
    .select("id, amount, as_of_date, source, source_document_id, manually_edited, created_at")
    .eq("asset_id", assetId)
    .order("as_of_date", { ascending: false })
    .order("created_at", { ascending: false });

  const docIds = (balances ?? [])
    .map((b) => b.source_document_id)
    .filter((v): v is string => Boolean(v));
  const docMap = new Map<string, { file_name: string; storage_path: string; url: string | null }>();
  if (docIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, file_name, storage_path")
      .in("id", docIds);
    await Promise.all(
      (docs ?? []).map(async (d) => {
        const url = await getSignedDocumentUrl(supabase, d.storage_path);
        docMap.set(d.id, { file_name: d.file_name, storage_path: d.storage_path, url });
      })
    );
  }

  const latest = balances?.[0];

  return (
    <>
      <section className="mt-6">
        <p className="text-sm text-neutral-500">Current balance</p>
        <p className="mt-2 text-5xl font-medium tracking-tight tabular">
          {latest ? formatMoney(latest.amount, currency, privacy) : "—"}
        </p>
        {latest ? (
          <p
            className={
              "mt-2 text-xs " +
              (isStale(latest.as_of_date)
                ? "text-amber-700 dark:text-amber-500"
                : "text-neutral-500")
            }
          >
            as of {formatDate(latest.as_of_date)} ({relativeAge(latest.as_of_date)})
            {isStale(latest.as_of_date) ? " — stale" : ""}
          </p>
        ) : (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
            No balance yet.
          </p>
        )}
      </section>

      {!archived ? (
        <section className="mt-12">
          <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Add balance
          </h2>
          <form action={addBalance} className="mt-3 space-y-3">
            <input type="hidden" name="asset_id" value={assetId} />
            <div className="flex flex-wrap items-end gap-3">
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
            </div>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              Attach document <span className="text-neutral-400">(optional)</span>
              <input
                type="file"
                name="file"
                accept={ACCEPT_ATTRIBUTE}
                className="mt-1 block w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 file:mr-3 file:rounded file:border-0 file:bg-neutral-200 file:px-3 file:py-1.5 file:text-sm file:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:file:bg-neutral-800 dark:file:text-neutral-100"
              />
            </label>
            <p className="text-xs text-neutral-500">
              PDF, JPEG, PNG, HEIC, XLS, XLSX, or CSV. Up to 25 MB.
            </p>
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
            >
              Save balance
            </button>
          </form>
        </section>
      ) : null}

      <section className="mt-12">
        <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Balance history
        </h2>
        {balances && balances.length > 0 ? (
          <ul className="mt-3 divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {balances.map((b) => {
              const doc = b.source_document_id ? docMap.get(b.source_document_id) : null;

              if (editId === b.id && !archived) {
                return (
                  <li key={b.id} className="px-4 py-3">
                    <form
                      action={updateBalance}
                      className="flex flex-wrap items-end gap-3"
                    >
                      <input type="hidden" name="asset_id" value={assetId} />
                      <input type="hidden" name="balance_id" value={b.id} />
                      <label className="block text-xs text-neutral-500">
                        Amount ({currency})
                        <input
                          type="text"
                          name="amount"
                          required
                          inputMode="decimal"
                          defaultValue={Number(b.amount).toString()}
                          className="mt-1 block w-40 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm tabular outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
                        />
                      </label>
                      <label className="block text-xs text-neutral-500">
                        As of
                        <input
                          type="date"
                          name="as_of_date"
                          required
                          defaultValue={b.as_of_date}
                          max={todayIso()}
                          className="mt-1 block w-40 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
                        />
                      </label>
                      <button
                        type="submit"
                        className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
                      >
                        Save
                      </button>
                      <Link
                        href={`/assets/${assetId}`}
                        className="px-2 py-2 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                      >
                        Cancel
                      </Link>
                    </form>
                  </li>
                );
              }

              return (
                <li
                  key={b.id}
                  className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm"
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
                      {b.manually_edited ? (
                        <span className="ml-2 text-neutral-400">· edited</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex items-baseline gap-4">
                    {doc ? (
                      doc.url ? (
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-neutral-600 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                        >
                          {doc.file_name}
                        </a>
                      ) : (
                        <span className="text-xs text-neutral-400">{doc.file_name}</span>
                      )
                    ) : null}
                    {!archived ? (
                      <>
                        <Link
                          href={`/assets/${assetId}?edit=${b.id}`}
                          className="text-xs text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
                        >
                          Edit
                        </Link>
                        <form action={deleteBalance}>
                          <input type="hidden" name="asset_id" value={assetId} />
                          <input type="hidden" name="balance_id" value={b.id} />
                          <ConfirmSubmit
                            message="Delete this balance entry? This can't be undone."
                            ariaLabel={`Delete balance from ${formatDate(b.as_of_date)}`}
                            className="text-xs text-neutral-400 transition-colors hover:text-red-600 dark:hover:text-red-400"
                          >
                            Delete
                          </ConfirmSubmit>
                        </form>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-neutral-500">No balances yet.</p>
        )}
      </section>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Property view (PRD §5.5)
// ─────────────────────────────────────────────────────────────────────

async function PropertyView({
  assetId,
  currency,
  archived,
  privacy,
  editId,
}: {
  assetId: string;
  currency: Currency;
  archived: boolean;
  privacy: boolean;
  editId: string | null;
}) {
  const supabase = await createClient();

  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, address, country, purchase_date, purchase_price, purchase_currency, mortgage_asset_id, sale_cost_overrides"
    )
    .eq("asset_id", assetId)
    .maybeSingle();

  if (!property) {
    return (
      <p className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        This real-estate asset is missing its property record. This shouldn't
        happen — let an admin know.
      </p>
    );
  }

  const [valuationsResult, mortgageResult, liabilitiesResult] = await Promise.all([
    supabase
      .from("property_valuations")
      .select("id, estimated_value, as_of_date, note, created_at")
      .eq("property_id", property.id)
      .order("as_of_date", { ascending: false })
      .order("created_at", { ascending: false }),
    property.mortgage_asset_id
      ? supabase
          .from("assets")
          .select("id, name, native_currency, asset_latest_balances(amount, as_of_date)")
          .eq("id", property.mortgage_asset_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("assets")
      .select("id, name, native_currency")
      .eq("category", "liability")
      .eq("archived", false)
      .order("name"),
  ]);

  const valuations = valuationsResult.data ?? [];
  const latestValuation = valuations[0] ?? null;
  const marketValue = latestValuation ? Number(latestValuation.estimated_value) : null;

  // Get the linked mortgage's latest balance via a second query (view embed
  // through PostgREST doesn't work cleanly for views; we fetch directly).
  let mortgageBalance = 0;
  let mortgageName: string | null = null;
  if (property.mortgage_asset_id && mortgageResult.data) {
    mortgageName = mortgageResult.data.name;
    const { data: mortgageLatest } = await supabase
      .from("asset_latest_balances")
      .select("amount")
      .eq("asset_id", property.mortgage_asset_id)
      .maybeSingle();
    mortgageBalance = mortgageLatest ? Math.abs(Number(mortgageLatest.amount)) : 0;
  }

  const netEquity = marketValue != null ? marketValue - mortgageBalance : null;
  const liabilities = liabilitiesResult.data ?? [];

  return (
    <>
      <section className="mt-6">
        <p className="text-sm text-neutral-500">Net equity</p>
        <p className="mt-2 text-5xl font-medium tracking-tight tabular">
          {netEquity != null ? formatMoney(netEquity, currency, privacy) : "—"}
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 text-xs text-neutral-500">
          <span>
            Market value:{" "}
            <span className="tabular">
              {marketValue != null ? formatMoney(marketValue, currency, privacy) : "—"}
            </span>
            {latestValuation ? (
              <span
                className={
                  "ml-1 " +
                  (isStale(latestValuation.as_of_date)
                    ? "text-amber-700 dark:text-amber-500"
                    : "text-neutral-400")
                }
              >
                (as of {formatDate(latestValuation.as_of_date)}
                {isStale(latestValuation.as_of_date) ? " — stale" : ""})
              </span>
            ) : null}
          </span>
          {mortgageBalance > 0 && mortgageName ? (
            <span>
              ·{" "}
              {mortgageName}:{" "}
              <span className="tabular">
                − {formatMoney(mortgageBalance, currency, privacy)}
              </span>
            </span>
          ) : null}
        </div>
      </section>

      {!archived ? (
        <section className="mt-12">
          <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Add valuation
          </h2>
          <form action={addValuation} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="asset_id" value={assetId} />
            <input type="hidden" name="property_id" value={property.id} />
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              Estimated value ({currency})
              <input
                type="text"
                name="estimated_value"
                required
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1 block w-48 rounded-md border border-neutral-300 bg-white px-3 py-2 text-base tabular outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
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
                className="mt-1 block w-44 rounded-md border border-neutral-300 bg-white px-3 py-2 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
              />
            </label>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              Note <span className="text-neutral-400">(optional)</span>
              <input
                type="text"
                name="note"
                placeholder="e.g. agent estimate, post-renovation"
                className="mt-1 block w-72 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
            >
              Save valuation
            </button>
          </form>
        </section>
      ) : null}

      <section className="mt-12">
        <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Property details
        </h2>
        <form
          action={updateProperty}
          className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-neutral-200 p-4 sm:grid-cols-2 dark:border-neutral-800"
        >
          <input type="hidden" name="asset_id" value={assetId} />
          <input type="hidden" name="property_id" value={property.id} />
          <label className="block text-sm text-neutral-600 sm:col-span-2 dark:text-neutral-400">
            Address
            <input
              type="text"
              name="address"
              required
              defaultValue={property.address}
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
            />
          </label>
          <label className="block text-sm text-neutral-600 dark:text-neutral-400">
            Country
            <select
              name="country"
              defaultValue={property.country ?? "GB"}
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
            >
              {COUNTRY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {COUNTRY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-neutral-600 dark:text-neutral-400">
            Mortgage <span className="text-neutral-400">(optional)</span>
            <select
              name="mortgage_asset_id"
              defaultValue={property.mortgage_asset_id ?? ""}
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
            >
              <option value="">— none —</option>
              {liabilities.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.native_currency})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-neutral-600 dark:text-neutral-400">
            Purchase date
            <input
              type="date"
              name="purchase_date"
              defaultValue={property.purchase_date ?? ""}
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
            />
          </label>
          <label className="block text-sm text-neutral-600 dark:text-neutral-400">
            Purchase price
            <input
              type="text"
              name="purchase_price"
              defaultValue={property.purchase_price ?? ""}
              inputMode="decimal"
              placeholder="450000"
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm tabular outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
            />
          </label>
          <input
            type="hidden"
            name="purchase_currency"
            value={property.purchase_currency ?? currency}
          />
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
            >
              Save property details
            </button>
          </div>
        </form>
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Valuations
        </h2>
        {valuations.length > 0 ? (
          <ul className="mt-3 divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {valuations.map((v) => {
              if (editId === v.id && !archived) {
                return (
                  <li key={v.id} className="px-4 py-3">
                    <form
                      action={updateValuation}
                      className="flex flex-wrap items-end gap-3"
                    >
                      <input type="hidden" name="asset_id" value={assetId} />
                      <input type="hidden" name="valuation_id" value={v.id} />
                      <label className="block text-xs text-neutral-500">
                        Value ({currency})
                        <input
                          type="text"
                          name="estimated_value"
                          required
                          inputMode="decimal"
                          defaultValue={Number(v.estimated_value).toString()}
                          className="mt-1 block w-40 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm tabular outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
                        />
                      </label>
                      <label className="block text-xs text-neutral-500">
                        As of
                        <input
                          type="date"
                          name="as_of_date"
                          required
                          defaultValue={v.as_of_date}
                          max={todayIso()}
                          className="mt-1 block w-40 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
                        />
                      </label>
                      <label className="block text-xs text-neutral-500">
                        Note
                        <input
                          type="text"
                          name="note"
                          defaultValue={v.note ?? ""}
                          className="mt-1 block w-56 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
                        />
                      </label>
                      <button
                        type="submit"
                        className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
                      >
                        Save
                      </button>
                      <Link
                        href={`/assets/${assetId}`}
                        className="px-2 py-2 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                      >
                        Cancel
                      </Link>
                    </form>
                  </li>
                );
              }

              return (
                <li
                  key={v.id}
                  className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm"
                >
                  <div>
                    <p className="tabular text-base font-medium text-neutral-900 dark:text-neutral-100">
                      {formatMoney(v.estimated_value, currency, privacy)}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {formatDate(v.as_of_date)}
                      {v.note ? <span className="ml-2 italic">· {v.note}</span> : null}
                    </p>
                  </div>
                  {!archived ? (
                    <div className="flex items-baseline gap-4">
                      <Link
                        href={`/assets/${assetId}?edit=${v.id}`}
                        className="text-xs text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
                      >
                        Edit
                      </Link>
                      <form action={deleteValuation}>
                        <input type="hidden" name="asset_id" value={assetId} />
                        <input type="hidden" name="valuation_id" value={v.id} />
                        <ConfirmSubmit
                          message="Delete this valuation? This can't be undone."
                          ariaLabel={`Delete valuation from ${formatDate(v.as_of_date)}`}
                          className="text-xs text-neutral-400 transition-colors hover:text-red-600 dark:hover:text-red-400"
                        >
                          Delete
                        </ConfirmSubmit>
                      </form>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-neutral-500">No valuations yet.</p>
        )}
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Sale scenario
        </h2>
        <div className="mt-3">
          <SaleScenarioPanel
            assetId={assetId}
            propertyId={property.id}
            country={property.country}
            overrides={(property.sale_cost_overrides ?? {}) as SaleCostOverrides}
            marketValue={marketValue}
            mortgageBalance={mortgageBalance}
            purchasePrice={
              property.purchase_price != null ? Number(property.purchase_price) : null
            }
            currency={currency}
          />
        </div>
      </section>
    </>
  );
}
