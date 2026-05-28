import type { SaleCostOverrides } from "@/lib/types";

/**
 * Default sale-cost assumptions per jurisdiction (PRD §5.5).
 * These are illustrative starting points the user can override per
 * property. CGT defaults to disabled per the PRD ("No CGT calculation
 * should default-on; user must enable per property").
 */
export const SALE_DEFAULTS: Record<string, Required<Omit<SaleCostOverrides, "capital_gains_enabled" | "capital_gains_pct">> & { capital_gains_enabled: boolean; capital_gains_pct: number }> = {
  GB: {
    agent_fee_pct: 1.25,
    legal_fees_flat: 1500,
    capital_gains_enabled: false,
    capital_gains_pct: 0,
    mortgage_discharge_flat: 500,
    staging_budget_flat: 0,
  },
  CA: {
    agent_fee_pct: 5.0,
    legal_fees_flat: 2500,
    capital_gains_enabled: false,
    capital_gains_pct: 0,
    mortgage_discharge_flat: 1000,
    staging_budget_flat: 2500,
  },
  US: {
    agent_fee_pct: 6.0,
    legal_fees_flat: 2000,
    capital_gains_enabled: false,
    capital_gains_pct: 0,
    mortgage_discharge_flat: 500,
    staging_budget_flat: 2000,
  },
};

export const FALLBACK_DEFAULTS = SALE_DEFAULTS.GB;

export type ResolvedSaleCosts = {
  agent_fee_pct: number;
  legal_fees_flat: number;
  capital_gains_enabled: boolean;
  capital_gains_pct: number;
  mortgage_discharge_flat: number;
  staging_budget_flat: number;
};

export function resolveSaleCosts(
  country: string | null,
  overrides: SaleCostOverrides
): ResolvedSaleCosts {
  const base = (country && SALE_DEFAULTS[country]) || FALLBACK_DEFAULTS;
  return {
    agent_fee_pct: overrides.agent_fee_pct ?? base.agent_fee_pct,
    legal_fees_flat: overrides.legal_fees_flat ?? base.legal_fees_flat,
    capital_gains_enabled: overrides.capital_gains_enabled ?? base.capital_gains_enabled,
    capital_gains_pct: overrides.capital_gains_pct ?? base.capital_gains_pct,
    mortgage_discharge_flat: overrides.mortgage_discharge_flat ?? base.mortgage_discharge_flat,
    staging_budget_flat: overrides.staging_budget_flat ?? base.staging_budget_flat,
  };
}

export type SaleScenarioInput = {
  market_value: number;
  mortgage_balance: number;
  purchase_price: number | null;
  costs: ResolvedSaleCosts;
};

export type SaleScenarioOutput = {
  gross_sale: number;
  agent_fee: number;
  legal_fees: number;
  mortgage_payoff: number;
  mortgage_discharge_fee: number;
  staging: number;
  capital_gains_tax: number;
  total_costs: number;
  net_cash: number;
};

/**
 * Compute the sale breakdown. Capital gains tax is only applied when
 * enabled AND there's a purchase price to compute the gain from.
 */
export function computeSaleScenario(input: SaleScenarioInput): SaleScenarioOutput {
  const gross_sale = input.market_value;
  const agent_fee = (gross_sale * input.costs.agent_fee_pct) / 100;
  const legal_fees = input.costs.legal_fees_flat;
  const mortgage_payoff = input.mortgage_balance;
  const mortgage_discharge_fee =
    input.mortgage_balance > 0 ? input.costs.mortgage_discharge_flat : 0;
  const staging = input.costs.staging_budget_flat;

  let capital_gains_tax = 0;
  if (
    input.costs.capital_gains_enabled &&
    input.purchase_price != null &&
    Number.isFinite(input.purchase_price)
  ) {
    const gain = Math.max(0, gross_sale - input.purchase_price);
    capital_gains_tax = (gain * input.costs.capital_gains_pct) / 100;
  }

  const total_costs =
    agent_fee +
    legal_fees +
    mortgage_payoff +
    mortgage_discharge_fee +
    staging +
    capital_gains_tax;
  const net_cash = gross_sale - total_costs;

  return {
    gross_sale,
    agent_fee,
    legal_fees,
    mortgage_payoff,
    mortgage_discharge_fee,
    staging,
    capital_gains_tax,
    total_costs,
    net_cash,
  };
}
