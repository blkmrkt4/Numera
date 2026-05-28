"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Currency, SaleCostOverrides } from "@/lib/types";
import { CURRENCIES } from "@/lib/types";

const VALID_COUNTRIES = new Set(["GB", "CA", "US"]);

function fail(assetId: string, message: string): never {
  redirect(`/assets/${assetId}?error=${encodeURIComponent(message)}`);
}

/**
 * Insert a new property valuation AND a matching balance_entries row so
 * dashboard totals and asset_latest_balances continue to surface the
 * latest market value as the asset's "balance".
 *
 * The two rows are linked: property_valuations.balance_entry_id points
 * at the synthetic balance_entry, which lets us delete/edit both halves
 * together in a later iteration.
 */
export async function addValuation(formData: FormData) {
  const assetId = String(formData.get("asset_id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  const amountRaw = String(formData.get("estimated_value") ?? "").trim();
  const asOfDate = String(formData.get("as_of_date") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!assetId || !propertyId) redirect("/dashboard");
  if (!amountRaw) fail(assetId, "Estimated value is required.");
  if (!asOfDate) fail(assetId, "Date is required.");

  const amount = Number(amountRaw.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    fail(assetId, "Estimated value must be a positive number.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) fail(assetId, "Invalid date.");
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (new Date(asOfDate) > today) fail(assetId, "Date cannot be in the future.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 1) Write the balance_entry first so we can capture its id.
  const { data: balance, error: balErr } = await supabase
    .from("balance_entries")
    .insert({
      asset_id: assetId,
      amount: amount.toFixed(4),
      as_of_date: asOfDate,
      source: "manual",
    })
    .select("id")
    .single();
  if (balErr) fail(assetId, `Could not save balance: ${balErr.message}`);

  // 2) Then the property_valuation pointing at it.
  const { error: valErr } = await supabase.from("property_valuations").insert({
    property_id: propertyId,
    estimated_value: amount.toFixed(4),
    as_of_date: asOfDate,
    note,
    balance_entry_id: balance!.id,
  });
  if (valErr) {
    // Best-effort rollback of the balance_entry if the valuation insert
    // failed (e.g. RLS — would mean propertyId doesn't belong to caller).
    await supabase.from("balance_entries").delete().eq("id", balance!.id);
    fail(assetId, `Could not save valuation: ${valErr.message}`);
  }

  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/dashboard");
  redirect(`/assets/${assetId}`);
}

/**
 * Save edits to the Property row: address, country, purchase fields,
 * mortgage linkage. Sale-cost overrides live in their own action.
 */
export async function updateProperty(formData: FormData) {
  const assetId = String(formData.get("asset_id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!assetId || !propertyId) redirect("/dashboard");

  const address = String(formData.get("address") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim().toUpperCase();
  const purchaseDate = String(formData.get("purchase_date") ?? "").trim();
  const purchasePriceRaw = String(formData.get("purchase_price") ?? "").trim();
  const purchaseCurrency = String(formData.get("purchase_currency") ?? "").trim() as Currency;
  const mortgageAssetIdRaw = String(formData.get("mortgage_asset_id") ?? "").trim();

  if (!address) fail(assetId, "Address is required.");
  if (country && !VALID_COUNTRIES.has(country)) fail(assetId, "Pick a supported country.");
  if (purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
    fail(assetId, "Purchase date is invalid.");
  }
  const purchasePrice = purchasePriceRaw ? Number(purchasePriceRaw.replace(/,/g, "")) : null;
  if (purchasePrice !== null && !Number.isFinite(purchasePrice)) {
    fail(assetId, "Purchase price must be a number.");
  }
  if (purchaseCurrency && !CURRENCIES.includes(purchaseCurrency)) {
    fail(assetId, "Pick a supported purchase currency.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("properties")
    .update({
      address,
      country: country || null,
      purchase_date: purchaseDate || null,
      purchase_price: purchasePrice != null ? purchasePrice.toFixed(4) : null,
      purchase_currency: purchaseCurrency || null,
      mortgage_asset_id: mortgageAssetIdRaw || null,
    })
    .eq("id", propertyId);

  if (error) fail(assetId, `Could not update property: ${error.message}`);

  revalidatePath(`/assets/${assetId}`);
  redirect(`/assets/${assetId}`);
}

/**
 * Persist sale-cost overrides for this property. Sent from the
 * client-side sale-scenario form when the user clicks "Save defaults".
 */
export async function saveSaleCostOverrides(formData: FormData) {
  const assetId = String(formData.get("asset_id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!assetId || !propertyId) redirect("/dashboard");

  const overrides: SaleCostOverrides = {};
  const numField = (key: keyof SaleCostOverrides): number | undefined => {
    const v = formData.get(key as string);
    if (v == null || v === "") return undefined;
    const n = Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : undefined;
  };

  const afp = numField("agent_fee_pct");
  if (afp !== undefined) overrides.agent_fee_pct = afp;
  const lf = numField("legal_fees_flat");
  if (lf !== undefined) overrides.legal_fees_flat = lf;
  const md = numField("mortgage_discharge_flat");
  if (md !== undefined) overrides.mortgage_discharge_flat = md;
  const sb = numField("staging_budget_flat");
  if (sb !== undefined) overrides.staging_budget_flat = sb;

  const cgEnabled = String(formData.get("capital_gains_enabled") ?? "") === "on";
  overrides.capital_gains_enabled = cgEnabled;
  if (cgEnabled) {
    const cgPct = numField("capital_gains_pct");
    if (cgPct !== undefined) overrides.capital_gains_pct = cgPct;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("properties")
    .update({ sale_cost_overrides: overrides })
    .eq("id", propertyId);
  if (error) fail(assetId, `Could not save overrides: ${error.message}`);

  revalidatePath(`/assets/${assetId}`);
  redirect(`/assets/${assetId}?ok=${encodeURIComponent("Sale defaults saved.")}`);
}
