"use client";

import { useState } from "react";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  COUNTRY_LABELS,
  COUNTRY_ORDER,
  CURRENCIES,
  type AssetCategory,
} from "@/lib/types";
import { createAsset } from "./actions";

export function NewAssetForm({ initialError }: { initialError?: string }) {
  const [category, setCategory] = useState<AssetCategory>("investment");
  const isProperty = category === "real_estate";

  return (
    <form action={createAsset} className="space-y-5">
      <div>
        <label className="block text-sm text-neutral-600 dark:text-neutral-400">
          Name
          <input
            type="text"
            name="name"
            required
            maxLength={100}
            placeholder={
              isProperty ? "e.g. 12 Drysdale Avenue" : "e.g. HSBC current account"
            }
            className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:focus:border-neutral-100"
          />
        </label>
      </div>

      <fieldset>
        <legend className="block text-sm text-neutral-600 dark:text-neutral-400">
          Category
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CATEGORY_ORDER.map((c) => (
            <label
              key={c}
              className="flex cursor-pointer items-center justify-center rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 has-[:checked]:border-neutral-900 has-[:checked]:bg-neutral-900 has-[:checked]:text-white dark:border-neutral-700 dark:text-neutral-300 dark:has-[:checked]:border-white dark:has-[:checked]:bg-white dark:has-[:checked]:text-neutral-900"
            >
              <input
                type="radio"
                name="category"
                value={c}
                required
                checked={category === c}
                onChange={() => setCategory(c)}
                className="sr-only"
              />
              {CATEGORY_LABELS[c]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="block text-sm text-neutral-600 dark:text-neutral-400">
          {isProperty ? "Held in" : "Currency"}
        </legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {CURRENCIES.map((c, i) => (
            <label
              key={c}
              className="flex cursor-pointer items-center justify-center rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 has-[:checked]:border-neutral-900 has-[:checked]:bg-neutral-900 has-[:checked]:text-white dark:border-neutral-700 dark:text-neutral-300 dark:has-[:checked]:border-white dark:has-[:checked]:bg-white dark:has-[:checked]:text-neutral-900"
            >
              <input
                type="radio"
                name="currency"
                value={c}
                required
                defaultChecked={i === 0}
                className="sr-only"
              />
              {c}
            </label>
          ))}
        </div>
      </fieldset>

      {isProperty ? (
        <div className="space-y-4 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-xs text-neutral-500">
            Property details. The market value gets added separately as a
            valuation once the asset exists.
          </p>
          <label className="block text-sm text-neutral-600 dark:text-neutral-400">
            Address
            <input
              type="text"
              name="address"
              required={isProperty}
              maxLength={250}
              placeholder="12 Drysdale Avenue, London W4 1EJ"
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              Country
              <select
                name="country"
                defaultValue="GB"
                className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
              >
                {COUNTRY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {COUNTRY_LABELS[c]}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-neutral-500">
                Sets the default sale-cost assumptions.
              </span>
            </label>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              Purchase date <span className="text-neutral-400">(optional)</span>
              <input
                type="date"
                name="purchase_date"
                className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
              />
            </label>
          </div>
          <label className="block text-sm text-neutral-600 dark:text-neutral-400">
            Purchase price <span className="text-neutral-400">(optional)</span>
            <input
              type="text"
              name="purchase_price"
              inputMode="decimal"
              placeholder="450000"
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm tabular outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
            />
            <span className="mt-1 block text-xs text-neutral-500">
              In the same currency as above. Only used for the optional capital-gains
              calculation in the sale scenario.
            </span>
          </label>
        </div>
      ) : (
        <>
          <div>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              Institution <span className="text-neutral-400">(optional)</span>
              <input
                type="text"
                name="institution"
                maxLength={100}
                placeholder="e.g. HSBC UK"
                className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:focus:border-neutral-100"
              />
            </label>
          </div>
          <div>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              Last 4 digits of account <span className="text-neutral-400">(optional)</span>
              <input
                type="text"
                name="account_last4"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                placeholder="1234"
                className="mt-1 block w-32 rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 tabular outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:focus:border-neutral-100"
              />
            </label>
            <p className="mt-1 text-xs text-neutral-500">
              Never the full account number — only the last 4.
            </p>
          </div>
        </>
      )}

      {initialError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{initialError}</p>
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
        >
          Create asset
        </button>
        <a
          href="/dashboard"
          className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
