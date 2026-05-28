// Minimal hand-written types for our schema. We can adopt
// `supabase gen types typescript` once the schema stabilises.

export type Currency = "GBP" | "USD" | "CAD";
export type AssetCategory = "real_estate" | "investment" | "cash" | "liability";

export const CURRENCIES: Currency[] = ["GBP", "USD", "CAD"];

export const CATEGORY_LABELS: Record<AssetCategory, string> = {
  real_estate: "Real estate",
  investment: "Investments",
  cash: "Cash",
  liability: "Liabilities",
};

export const CATEGORY_ORDER: AssetCategory[] = [
  "real_estate",
  "investment",
  "cash",
  "liability",
];

export type Asset = {
  id: string;
  household_id: string;
  name: string;
  category: AssetCategory;
  institution_id: string | null;
  account_last4: string | null;
  native_currency: Currency;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type Institution = {
  id: string;
  household_id: string;
  name: string;
  country: string | null;
  type: "bank" | "brokerage" | "mortgage_lender" | "utility" | "other" | null;
};

export type BalanceEntry = {
  id: string;
  asset_id: string;
  amount: string; // numeric(20,4) — comes back as string, parse with parseFloat or Number
  as_of_date: string; // YYYY-MM-DD
  source: "document" | "manual";
  source_document_id: string | null;
  confidence: string | null;
  manually_edited: boolean;
  created_at: string;
};

export type Property = {
  id: string;
  asset_id: string;
  address: string;
  country: string | null; // ISO 3166-1 alpha-2
  purchase_date: string | null; // YYYY-MM-DD
  purchase_price: string | null; // numeric
  purchase_currency: Currency | null;
  mortgage_asset_id: string | null;
  sale_cost_overrides: SaleCostOverrides;
};

export type SaleCostOverrides = Partial<{
  agent_fee_pct: number;
  legal_fees_flat: number;
  capital_gains_enabled: boolean;
  capital_gains_pct: number;
  mortgage_discharge_flat: number;
  staging_budget_flat: number;
}>;

export type PropertyValuation = {
  id: string;
  property_id: string;
  estimated_value: string;
  as_of_date: string;
  note: string | null;
  created_at: string;
};

export const COUNTRY_LABELS: Record<string, string> = {
  GB: "United Kingdom",
  CA: "Canada",
  US: "United States",
};

export const COUNTRY_ORDER = ["GB", "CA", "US"] as const;
