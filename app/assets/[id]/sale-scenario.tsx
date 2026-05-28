"use client";

import { useMemo, useState } from "react";
import {
  computeSaleScenario,
  resolveSaleCosts,
  type ResolvedSaleCosts,
} from "@/lib/sale-scenario";
import type { Currency, SaleCostOverrides } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { saveSaleCostOverrides } from "./property-actions";

export function SaleScenarioPanel({
  assetId,
  propertyId,
  country,
  overrides,
  marketValue,
  mortgageBalance,
  purchasePrice,
  currency,
}: {
  assetId: string;
  propertyId: string;
  country: string | null;
  overrides: SaleCostOverrides;
  marketValue: number | null;
  mortgageBalance: number;
  purchasePrice: number | null;
  currency: Currency;
}) {
  const resolved = useMemo(() => resolveSaleCosts(country, overrides), [country, overrides]);
  const [costs, setCosts] = useState<ResolvedSaleCosts>(resolved);

  const breakdown = useMemo(() => {
    if (marketValue == null) return null;
    return computeSaleScenario({
      market_value: marketValue,
      mortgage_balance: mortgageBalance,
      purchase_price: purchasePrice,
      costs,
    });
  }, [marketValue, mortgageBalance, purchasePrice, costs]);

  if (marketValue == null) {
    return (
      <p className="text-sm text-neutral-500">
        Add a valuation to see the sale scenario.
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={saveSaleCostOverrides} className="space-y-3">
        <input type="hidden" name="asset_id" value={assetId} />
        <input type="hidden" name="property_id" value={propertyId} />

        <p className="text-xs text-neutral-500">
          Defaults reflect typical {country ?? "UK"}-style transaction costs. Adjust
          per property and click Save to remember them.
        </p>

        <PctField
          label="Agent fee"
          name="agent_fee_pct"
          value={costs.agent_fee_pct}
          onChange={(v) => setCosts({ ...costs, agent_fee_pct: v })}
        />
        <MoneyField
          label="Legal fees"
          name="legal_fees_flat"
          currency={currency}
          value={costs.legal_fees_flat}
          onChange={(v) => setCosts({ ...costs, legal_fees_flat: v })}
        />
        <MoneyField
          label="Mortgage discharge fee"
          name="mortgage_discharge_flat"
          currency={currency}
          value={costs.mortgage_discharge_flat}
          onChange={(v) => setCosts({ ...costs, mortgage_discharge_flat: v })}
          hint="Only applied when a mortgage balance exists."
        />
        <MoneyField
          label="Staging / prep budget"
          name="staging_budget_flat"
          currency={currency}
          value={costs.staging_budget_flat}
          onChange={(v) => setCosts({ ...costs, staging_budget_flat: v })}
        />

        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
          <label className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-200">
            <input
              type="checkbox"
              name="capital_gains_enabled"
              checked={costs.capital_gains_enabled}
              onChange={(e) => setCosts({ ...costs, capital_gains_enabled: e.target.checked })}
            />
            Estimate capital gains tax
          </label>
          <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">
            Off by default — this is an illustrative estimate, not tax advice.
            CGT applies to the gain (sale − purchase), not the whole sale.
          </p>
          {costs.capital_gains_enabled ? (
            <div className="mt-2">
              <PctField
                label="Effective CGT rate"
                name="capital_gains_pct"
                value={costs.capital_gains_pct}
                onChange={(v) => setCosts({ ...costs, capital_gains_pct: v })}
                small
              />
              {purchasePrice == null ? (
                <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">
                  Set the purchase price on the property to compute the gain.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
        >
          Save defaults for this property
        </button>
      </form>

      {breakdown ? (
        <div className="rounded-md border border-neutral-200 p-4 text-sm dark:border-neutral-800">
          <p className="text-xs text-neutral-500">Sale scenario</p>
          <Row
            label="Gross sale price"
            value={formatMoney(breakdown.gross_sale, currency)}
            bold
          />
          <Row
            label={`Agent fee (${costs.agent_fee_pct.toFixed(2)}%)`}
            value={`− ${formatMoney(breakdown.agent_fee, currency)}`}
          />
          <Row label="Legal fees" value={`− ${formatMoney(breakdown.legal_fees, currency)}`} />
          {breakdown.mortgage_payoff > 0 ? (
            <Row
              label="Mortgage payoff"
              value={`− ${formatMoney(breakdown.mortgage_payoff, currency)}`}
            />
          ) : null}
          {breakdown.mortgage_discharge_fee > 0 ? (
            <Row
              label="Discharge fee"
              value={`− ${formatMoney(breakdown.mortgage_discharge_fee, currency)}`}
            />
          ) : null}
          {breakdown.staging > 0 ? (
            <Row label="Staging" value={`− ${formatMoney(breakdown.staging, currency)}`} />
          ) : null}
          {breakdown.capital_gains_tax > 0 ? (
            <Row
              label={`CGT (${costs.capital_gains_pct.toFixed(1)}%)`}
              value={`− ${formatMoney(breakdown.capital_gains_tax, currency)}`}
            />
          ) : null}
          <div className="mt-2 border-t border-neutral-200 pt-2 dark:border-neutral-800">
            <Row
              label="Total costs"
              value={`− ${formatMoney(breakdown.total_costs, currency)}`}
            />
            <Row
              label="Net cash"
              value={formatMoney(breakdown.net_cash, currency)}
              bold
              large
            />
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            Illustrative only. Not tax or legal advice.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function PctField({
  label,
  name,
  value,
  onChange,
  small,
}: {
  label: string;
  name: string;
  value: number;
  onChange: (v: number) => void;
  small?: boolean;
}) {
  return (
    <label className="block text-sm text-neutral-600 dark:text-neutral-400">
      {label}
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          name={name}
          min="0"
          max="100"
          step="0.05"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`block rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm tabular outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100 ${
            small ? "w-24" : "w-32"
          }`}
        />
        <span className="text-sm text-neutral-500">%</span>
      </div>
    </label>
  );
}

function MoneyField({
  label,
  name,
  currency,
  value,
  onChange,
  hint,
}: {
  label: string;
  name: string;
  currency: Currency;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="block text-sm text-neutral-600 dark:text-neutral-400">
      {label}
      <div className="mt-1 flex items-center gap-2">
        <span className="text-sm text-neutral-500">{currency}</span>
        <input
          type="number"
          name={name}
          min="0"
          step="1"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="block w-40 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm tabular outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-100"
        />
      </div>
      {hint ? <p className="mt-1 text-xs text-neutral-500">{hint}</p> : null}
    </label>
  );
}

function Row({
  label,
  value,
  bold,
  large,
}: {
  label: string;
  value: string;
  bold?: boolean;
  large?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className={bold ? "font-medium" : "text-neutral-500"}>{label}</span>
      <span
        className={`tabular ${bold ? "font-medium" : ""} ${
          large ? "text-xl" : "text-sm"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
