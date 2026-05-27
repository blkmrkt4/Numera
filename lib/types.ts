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
