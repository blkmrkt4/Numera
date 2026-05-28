"use client";

import { useMemo, useState } from "react";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CURRENCIES,
  type AssetCategory,
  type Currency,
} from "@/lib/types";
import type { Proposal } from "@/lib/classification";
import { linkDocumentToBalance } from "../actions";

type Confidence = "low" | "medium" | "high";

export type Extracted = {
  document_type: string;
  institution_name: string | null;
  account_last4: string | null;
  currency: Currency;
  balance_amount: number;
  as_of_date: string | null;
  confidences: Partial<Record<string, Confidence>>;
  raw_notes?: string | null;
};

export type AssetOption = {
  id: string;
  name: string;
  category: AssetCategory;
  native_currency: Currency;
  institution_name: string | null;
};

export function ReviewForm({
  documentId,
  extracted,
  assets,
  todayIso,
  proposal,
}: {
  documentId: string;
  extracted: Extracted | null;
  assets: AssetOption[];
  todayIso: string;
  proposal: Proposal | null;
}) {
  const initialAmount = extracted ? String(extracted.balance_amount) : "";
  const initialDate = extracted?.as_of_date ?? todayIso;
  const initialCurrency = extracted?.currency ?? "GBP";
  const initialInstitution = extracted?.institution_name ?? "";
  const initialLast4 = extracted?.account_last4 ?? "";

  const [amount, setAmount] = useState(initialAmount);
  const [asOfDate, setAsOfDate] = useState(initialDate);
  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const [institution, setInstitution] = useState(initialInstitution);
  const [last4, setLast4] = useState(initialLast4);

  const [assetId, setAssetId] = useState<string>(() => {
    // Server-side classifier (lib/classification.ts) has already chosen.
    // If it proposed UPDATE → that asset is preselected.
    // If it proposed NEW → the "+ Create new asset" panel opens.
    if (proposal?.action === "update") return proposal.asset_id;
    if (proposal?.action === "new") return "__new__";
    return "";
  });

  const edited = useMemo(() => {
    if (!extracted) return false;
    return (
      amount !== initialAmount ||
      asOfDate !== initialDate ||
      currency !== initialCurrency ||
      institution !== initialInstitution ||
      last4 !== initialLast4
    );
  }, [
    extracted,
    amount,
    asOfDate,
    currency,
    institution,
    last4,
    initialAmount,
    initialDate,
    initialCurrency,
    initialInstitution,
    initialLast4,
  ]);

  // Minimum-confidence shortcut used to mark a low-confidence field as
  // visually requiring touch (PRD §5.2.1).
  const conf = (field: string): Confidence | undefined =>
    extracted?.confidences?.[field];

  return (
    <form action={linkDocumentToBalance} className="space-y-5">
      <input type="hidden" name="document_id" value={documentId} />
      <input
        type="hidden"
        name="source"
        value={extracted ? "document" : "manual"}
      />
      <input type="hidden" name="edited" value={edited ? "1" : "0"} />

      <Field
        label="Amount"
        confidence={conf("balance_amount")}
        hint={`In ${currency}`}
      >
        <input
          type="text"
          name="amount"
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base tabular outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Currency" confidence={conf("currency")}>
          <select
            name="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field label="As of" confidence={conf("as_of_date")}>
          <input
            type="date"
            name="as_of_date"
            required
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            max={todayIso}
            className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Institution" confidence={conf("institution_name")}>
          <input
            type="text"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            placeholder="HSBC UK"
            className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
          />
          {/*
            Institution is informational at this step — it's used to bias
            the asset picker. Saving the field to institutions table
            happens transparently when a balance is recorded against an
            asset that doesn't already have one.
          */}
        </Field>
        <Field
          label="Account last 4"
          confidence={conf("account_last4")}
          hint="Never the full account number"
        >
          <input
            type="text"
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            pattern="\d{4}"
            placeholder="1234"
            className="block w-32 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm tabular outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
          />
        </Field>
      </div>

      {extracted ? (
        <p className="text-xs text-neutral-500">
          Document type: <span className="tabular">{extracted.document_type}</span>
          {extracted.raw_notes ? (
            <span className="ml-3 italic">· {extracted.raw_notes}</span>
          ) : null}
        </p>
      ) : null}

      <hr className="border-neutral-200 dark:border-neutral-800" />

      <div>
        <label className="block text-sm text-neutral-600 dark:text-neutral-400">
          Apply to asset
          <select
            name="asset_id"
            required
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:focus:border-neutral-100"
          >
            <option value="" disabled>
              Pick an asset…
            </option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.native_currency})
              </option>
            ))}
            <option value="__new__">+ Create new asset</option>
          </select>
        </label>
      </div>

      {assetId === "__new__" ? (
        <div className="space-y-3 rounded-md border border-dashed border-neutral-300 p-3 dark:border-neutral-700">
          <label className="block text-sm text-neutral-600 dark:text-neutral-400">
            New asset name
            <input
              type="text"
              name="new_asset_name"
              maxLength={100}
              defaultValue={institution || ""}
              placeholder="e.g. HSBC current account"
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              Category
              <select
                name="new_asset_category"
                defaultValue={categoryFromDocType(extracted?.document_type)}
                className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
              >
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              Currency
              <select
                name="new_asset_currency"
                defaultValue={currency}
                className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}

      <button
        type="submit"
        className="w-full rounded-md bg-neutral-900 px-5 py-2.5 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
      >
        {extracted ? "Confirm and save balance" : "Save balance"}
      </button>
    </form>
  );
}

function Field({
  label,
  confidence,
  hint,
  children,
}: {
  label: string;
  confidence?: Confidence;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm text-neutral-600 dark:text-neutral-400">
        <span>{label}</span>
        {confidence ? <ConfidencePill confidence={confidence} /> : null}
      </div>
      {children}
      {hint ? <p className="mt-1 text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}

function ConfidencePill({ confidence }: { confidence: Confidence }) {
  const cls =
    confidence === "high"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
      : confidence === "medium"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300"
        : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>
      {confidence}
    </span>
  );
}

function categoryFromDocType(docType: string | undefined): AssetCategory {
  switch (docType) {
    case "brokerage_statement":
      return "investment";
    case "mortgage_statement":
    case "credit_card_statement":
      return "liability";
    case "bank_statement":
      return "cash";
    default:
      return "cash";
  }
}
