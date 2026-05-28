"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { uploadDocument } from "@/lib/documents";
import { extractStatement } from "@/lib/extraction";
import { CURRENCIES, type AssetCategory, type Currency } from "@/lib/types";

const VALID_CATEGORIES: AssetCategory[] = ["real_estate", "investment", "cash", "liability"];

function failCapture(message: string): never {
  redirect(`/capture?error=${encodeURIComponent(message)}`);
}

function failLink(docId: string, message: string): never {
  redirect(`/capture/${docId}?error=${encodeURIComponent(message)}`);
}

/**
 * Upload + extract in one step. On success the user lands on the review
 * page with the LLM-extracted fields pre-filled. On extraction failure
 * the review page falls back to manual entry — the file is preserved
 * so the user can still record a balance against it.
 */
export async function uploadFromCapture(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) failCapture("Pick a file to upload.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("household_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.household_id) failCapture("Account is not yet provisioned.");

  const { data: household } = await supabase
    .from("households")
    .select("default_currency")
    .eq("id", profile.household_id)
    .maybeSingle();
  const defaultCurrency = (household?.default_currency as Currency) ?? "GBP";

  const uploaded = await uploadDocument(supabase, profile.household_id, user.id, file);
  if (!uploaded.ok) failCapture(uploaded.error);

  // Synchronous extraction. Worst case ~10s for vision-capable models.
  // On failure we still redirect to the review page — the user can fall
  // back to manual entry without losing the uploaded file.
  const extraction = await extractStatement(
    supabase,
    uploaded.documentId,
    profile.household_id,
    defaultCurrency
  );

  revalidatePath("/dashboard");
  if (!extraction.ok) {
    redirect(
      `/capture/${uploaded.documentId}?extract_error=${encodeURIComponent(extraction.error)}`
    );
  }
  redirect(`/capture/${uploaded.documentId}`);
}

/**
 * User confirms (and possibly edits) the extracted fields, picks an
 * asset (existing or new), and we record the balance entry tagged with
 * source='document' + source_document_id.
 *
 * Fields the user edited away from the extracted values flip
 * manually_edited=true so we can learn from corrections later (PRD §5.2.1).
 */
export async function linkDocumentToBalance(formData: FormData) {
  const documentId = String(formData.get("document_id") ?? "");
  const assetIdRaw = String(formData.get("asset_id") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const asOfDate = String(formData.get("as_of_date") ?? "").trim();
  const currency = String(formData.get("currency") ?? "").trim() as Currency;
  const sourceParam = String(formData.get("source") ?? "manual");
  const confidenceRaw = String(formData.get("confidence") ?? "").trim();
  const editedFlag = String(formData.get("edited") ?? "") === "1";

  if (!documentId) redirect("/dashboard");
  if (!assetIdRaw) failLink(documentId, "Pick an asset or choose to create one.");
  if (!amountRaw) failLink(documentId, "Amount is required.");
  if (!asOfDate) failLink(documentId, "Date is required.");

  const amount = Number(amountRaw.replace(/,/g, ""));
  if (!Number.isFinite(amount)) failLink(documentId, "Amount must be a number.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) failLink(documentId, "Invalid date.");
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (new Date(asOfDate) > today) failLink(documentId, "Date cannot be in the future.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let assetId = assetIdRaw;

  if (assetId === "__new__") {
    const name = String(formData.get("new_asset_name") ?? "").trim();
    const category = String(formData.get("new_asset_category") ?? "") as AssetCategory;
    const newCurrency = (String(formData.get("new_asset_currency") ?? "") || currency) as Currency;
    if (!name) failLink(documentId, "New asset needs a name.");
    if (!VALID_CATEGORIES.includes(category)) failLink(documentId, "Pick a category for the new asset.");
    if (!CURRENCIES.includes(newCurrency)) failLink(documentId, "Pick a currency for the new asset.");

    const { data: asset, error } = await supabase
      .from("assets")
      .insert({ name, category, native_currency: newCurrency })
      .select("id")
      .single();
    if (error) failLink(documentId, `Could not create asset: ${error.message}`);
    assetId = asset!.id;
  }

  // source: 'document' when extraction produced the values (even if the
  // user edited some); 'manual' when extraction failed and they typed
  // everything by hand. manually_edited flips on any edit.
  const balanceSource = sourceParam === "document" ? "document" : "manual";
  const confidence =
    balanceSource === "document" && /^(0|1)(\.\d+)?$/.test(confidenceRaw)
      ? Number(confidenceRaw)
      : null;

  const { error: balErr } = await supabase.from("balance_entries").insert({
    asset_id: assetId,
    amount: amount.toFixed(4),
    as_of_date: asOfDate,
    source: balanceSource,
    source_document_id: documentId,
    confidence: confidence,
    manually_edited: balanceSource === "document" ? editedFlag : false,
  });
  if (balErr) failLink(documentId, `Could not save balance: ${balErr.message}`);

  revalidatePath("/dashboard");
  revalidatePath(`/assets/${assetId}`);
  redirect(`/assets/${assetId}`);
}
