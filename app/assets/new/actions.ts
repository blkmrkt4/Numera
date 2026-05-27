"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { AssetCategory, Currency } from "@/lib/types";
import { CURRENCIES } from "@/lib/types";

const VALID_CATEGORIES: AssetCategory[] = ["real_estate", "investment", "cash", "liability"];

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Resolve or create the institution by name (case-insensitive, per-household).
  // household_id is filled in by the column default (current_household_id()).
  let institutionId: string | null = null;
  if (institutionName) {
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

  revalidatePath("/dashboard");
  redirect(`/assets/${asset!.id}`);
}
