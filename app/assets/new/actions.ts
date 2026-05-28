"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { AssetCategory, Currency } from "@/lib/types";
import { CURRENCIES } from "@/lib/types";

const VALID_CATEGORIES: AssetCategory[] = ["real_estate", "investment", "cash", "liability"];
const VALID_COUNTRIES = new Set(["GB", "CA", "US"]);

type FormError = string;

function fail(message: FormError): never {
  redirect(`/assets/new?error=${encodeURIComponent(message)}`);
}

export async function createAsset(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "") as AssetCategory;
  const currency = String(formData.get("currency") ?? "") as Currency;
  const institutionName = String(formData.get("institution") ?? "").trim();
  const accountLast4Raw = String(formData.get("account_last4") ?? "").trim();
  const accountLast4 = accountLast4Raw || null;

  if (!name) fail("Asset name is required.");
  if (name.length > 100) fail("Asset name is too long.");
  if (!VALID_CATEGORIES.includes(category)) fail("Pick a category.");
  if (!CURRENCIES.includes(currency)) fail("Pick a currency.");
  if (accountLast4 && !/^\d{4}$/.test(accountLast4)) {
    fail("Account identifier must be exactly 4 digits.");
  }

  // Property-specific fields (only validated when category = real_estate)
  const isProperty = category === "real_estate";
  const address = String(formData.get("address") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim().toUpperCase();
  const purchaseDate = String(formData.get("purchase_date") ?? "").trim();
  const purchasePriceRaw = String(formData.get("purchase_price") ?? "").trim();

  if (isProperty) {
    if (!address) fail("Property address is required.");
    if (address.length > 250) fail("Property address is too long.");
    if (country && !VALID_COUNTRIES.has(country)) fail("Pick a supported country.");
    if (purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
      fail("Purchase date is invalid.");
    }
  }
  const purchasePrice =
    isProperty && purchasePriceRaw
      ? Number(purchasePriceRaw.replace(/,/g, ""))
      : null;
  if (isProperty && purchasePrice !== null && !Number.isFinite(purchasePrice)) {
    fail("Purchase price must be a number.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Resolve or create the institution by name (case-insensitive, per-household).
  // household_id is filled in by the column default (current_household_id()).
  let institutionId: string | null = null;
  if (institutionName && !isProperty) {
    if (institutionName.length > 100) fail("Institution name is too long.");

    const { data: existing } = await supabase
      .from("institutions")
      .select("id")
      .ilike("name", institutionName)
      .maybeSingle();

    if (existing) {
      institutionId = existing.id;
    } else {
      const { data: created, error: insErr } = await supabase
        .from("institutions")
        .insert({ name: institutionName })
        .select("id")
        .single();
      if (insErr) fail(`Could not save institution: ${insErr.message}`);
      institutionId = created!.id;
    }
  }

  const { data: asset, error: assetErr } = await supabase
    .from("assets")
    .insert({
      name,
      category,
      native_currency: currency,
      institution_id: institutionId,
      account_last4: accountLast4,
    })
    .select("id")
    .single();

  if (assetErr) fail(`Could not save asset: ${assetErr.message}`);

  if (isProperty) {
    const { error: propErr } = await supabase.from("properties").insert({
      asset_id: asset!.id,
      address,
      country: country || null,
      purchase_date: purchaseDate || null,
      purchase_price: purchasePrice != null ? purchasePrice.toFixed(4) : null,
      purchase_currency: purchasePrice != null ? currency : null,
    });
    if (propErr) {
      // Best-effort rollback of the asset we just created so we don't
      // leave a real-estate asset without its property row.
      await supabase.from("assets").delete().eq("id", asset!.id);
      fail(`Could not save property details: ${propErr.message}`);
    }
  }

  revalidatePath("/dashboard");
  redirect(`/assets/${asset!.id}`);
}
