"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { uploadDocument } from "@/lib/documents";
import { CATEGORY_ORDER } from "@/lib/types";

function failBalance(assetId: string, message: string): never {
  redirect(`/assets/${assetId}?error=${encodeURIComponent(message)}`);
}

export async function addBalance(formData: FormData) {
  const assetId = String(formData.get("asset_id") ?? "");
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const asOfDate = String(formData.get("as_of_date") ?? "").trim();
  const file = formData.get("file");

  if (!assetId) redirect("/dashboard");
  if (!amountRaw) failBalance(assetId, "Amount is required.");
  if (!asOfDate) failBalance(assetId, "Date is required.");

  // Allow negatives (overdrafts, credit cards modelled as cash etc); reject NaN.
  const amount = Number(amountRaw.replace(/,/g, ""));
  if (!Number.isFinite(amount)) failBalance(assetId, "Amount must be a number.");

  // Date validation: must be a valid YYYY-MM-DD, not in the future.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) failBalance(assetId, "Invalid date.");
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (new Date(asOfDate) > today) failBalance(assetId, "Date cannot be in the future.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Optional document attachment. We upload first so the document row exists
  // before the balance row references it; if balance insert fails we keep the
  // doc (the user can still re-link it from /capture/<id>).
  let sourceDocumentId: string | null = null;
  if (file instanceof File && file.size > 0) {
    const { data: profile } = await supabase
      .from("users")
      .select("household_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.household_id) failBalance(assetId, "Account is not yet provisioned.");

    const uploaded = await uploadDocument(supabase, profile.household_id, user.id, file);
    if (!uploaded.ok) failBalance(assetId, uploaded.error);
    sourceDocumentId = uploaded.documentId;
  }

  const { error } = await supabase.from("balance_entries").insert({
    asset_id: assetId,
    amount: amount.toFixed(4),
    as_of_date: asOfDate,
    source: "manual",
    source_document_id: sourceDocumentId,
  });

  if (error) failBalance(assetId, `Could not save: ${error.message}`);

  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/dashboard");
  redirect(`/assets/${assetId}`);
}

export async function updateAssetDetails(formData: FormData) {
  const assetId = String(formData.get("asset_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const institutionName = String(formData.get("institution") ?? "").trim();

  if (!assetId) redirect("/dashboard");
  if (!name) failBalance(assetId, "Name is required.");
  if (!(CATEGORY_ORDER as string[]).includes(category)) {
    failBalance(assetId, "Pick a valid category.");
  }
  if (institutionName.length > 100) failBalance(assetId, "Institution name is too long.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: current } = await supabase
    .from("assets")
    .select("category")
    .eq("id", assetId)
    .maybeSingle();
  if (!current) failBalance(assetId, "Asset not found.");
  const oldCategory = current!.category as string;

  // Resolve or create the institution by name (case-insensitive, per-household),
  // mirroring the new-asset flow. Blank clears the link. household_id is filled
  // by the column default (current_household_id()).
  let institutionId: string | null = null;
  if (institutionName) {
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
      if (insErr) failBalance(assetId, `Could not save institution: ${insErr.message}`);
      institutionId = created!.id;
    }
  }

  const { error } = await supabase
    .from("assets")
    .update({ name, category, institution_id: institutionId })
    .eq("id", assetId);
  if (error) failBalance(assetId, `Could not update: ${error.message}`);

  // Real estate is the one category backed by a 1:1 properties row. Keep that
  // record consistent with the category, while always preserving balance
  // history (it lives on the asset, not the property).
  if (category === "real_estate" && oldCategory !== "real_estate") {
    const { data: existingProp } = await supabase
      .from("properties")
      .select("id")
      .eq("asset_id", assetId)
      .maybeSingle();
    if (!existingProp) {
      // address is NOT NULL; seed it with the name so the user can refine it
      // on the property page.
      await supabase.from("properties").insert({ asset_id: assetId, address: name });
    }
  } else if (oldCategory === "real_estate" && category !== "real_estate") {
    // Drop the now-irrelevant property record; valuations cascade, balances stay.
    await supabase.from("properties").delete().eq("asset_id", assetId);
  }

  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/dashboard");
  redirect(`/assets/${assetId}?ok=${encodeURIComponent("Asset updated.")}`);
}

export async function updateBalance(formData: FormData) {
  const assetId = String(formData.get("asset_id") ?? "");
  const balanceId = String(formData.get("balance_id") ?? "");
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const asOfDate = String(formData.get("as_of_date") ?? "").trim();

  if (!assetId) redirect("/dashboard");
  if (!balanceId) failBalance(assetId, "Missing entry to edit.");
  if (!amountRaw) failBalance(assetId, "Amount is required.");
  if (!asOfDate) failBalance(assetId, "Date is required.");

  const amount = Number(amountRaw.replace(/,/g, ""));
  if (!Number.isFinite(amount)) failBalance(assetId, "Amount must be a number.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) failBalance(assetId, "Invalid date.");
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (new Date(asOfDate) > today) failBalance(assetId, "Date cannot be in the future.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("balance_entries")
    .update({
      amount: amount.toFixed(4),
      as_of_date: asOfDate,
      manually_edited: true,
    })
    .eq("id", balanceId)
    .eq("asset_id", assetId);

  if (error) failBalance(assetId, `Could not update: ${error.message}`);

  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/dashboard");
  redirect(`/assets/${assetId}?ok=${encodeURIComponent("Balance entry updated.")}`);
}

export async function deleteBalance(formData: FormData) {
  const assetId = String(formData.get("asset_id") ?? "");
  const balanceId = String(formData.get("balance_id") ?? "");
  if (!assetId) redirect("/dashboard");
  if (!balanceId) failBalance(assetId, "Missing entry to delete.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Scope to the asset as well as the id: the RLS policy already restricts
  // this to the household's own assets, but matching asset_id keeps a stray
  // id from another asset from ever being targeted. The linked document (if
  // any) is intentionally left in place — it stays available from /capture
  // and is cheap to keep; only the balance row is removed.
  const { error } = await supabase
    .from("balance_entries")
    .delete()
    .eq("id", balanceId)
    .eq("asset_id", assetId);

  if (error) failBalance(assetId, `Could not delete: ${error.message}`);

  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/dashboard");
  redirect(`/assets/${assetId}?ok=${encodeURIComponent("Balance entry deleted.")}`);
}

export async function archiveAsset(formData: FormData) {
  const assetId = String(formData.get("asset_id") ?? "");
  if (!assetId) redirect("/dashboard");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("assets")
    .update({ archived: true })
    .eq("id", assetId);

  if (error) failBalance(assetId, `Could not archive: ${error.message}`);

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function unarchiveAsset(formData: FormData) {
  const assetId = String(formData.get("asset_id") ?? "");
  if (!assetId) redirect("/dashboard");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("assets")
    .update({ archived: false })
    .eq("id", assetId);

  if (error) failBalance(assetId, `Could not restore: ${error.message}`);

  revalidatePath("/dashboard");
  revalidatePath(`/assets/${assetId}`);
  redirect(`/assets/${assetId}`);
}
