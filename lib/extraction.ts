import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadDocumentAsDataUrl } from "@/lib/documents";
import { llmCall } from "@/lib/llm";

const EXTRACT_PROMPT_SLUG = "extract_statement";

export type Confidence = "low" | "medium" | "high";

export type ExtractedStatement = {
  document_type:
    | "bank_statement"
    | "brokerage_statement"
    | "mortgage_statement"
    | "utility_bill"
    | "property_valuation"
    | "payslip"
    | "credit_card_statement"
    | "other";
  institution_name: string | null;
  account_last4: string | null;
  currency: "GBP" | "USD" | "CAD";
  balance_amount: number;
  as_of_date: string | null;
  confidences: Partial<Record<keyof ExtractedStatement, Confidence>>;
  raw_notes?: string | null;
};

export type ExtractionResult =
  | { ok: true; extracted: ExtractedStatement; modelUsed: string; wasFallback: 0 | 1 | 2 }
  | { ok: false; error: string };

/**
 * Run extract_statement against the given document and persist the
 * parsed JSON into documents.extracted_json / status. The user must
 * still review and confirm before any balance entry is written
 * (PRD §5.2.1: nothing writes until the user explicitly taps confirm).
 *
 * Returns the parsed structure on success so the caller can immediately
 * render the review form.
 */
export async function extractStatement(
  supabase: SupabaseClient,
  documentId: string,
  householdId: string,
  userDefaultCurrency: string
): Promise<ExtractionResult> {
  const admin = createAdminClient();

  const { data: doc } = await admin
    .from("documents")
    .select("id, storage_path, mime_type")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Document not found." };

  // Pull every institution the household has used so the model can
  // normalise the name. Names are short — the whole list is cheap to
  // include.
  const { data: institutions } = await supabase
    .from("institutions")
    .select("name")
    .eq("household_id", householdId);
  const knownInstitutions = (institutions ?? []).map((i) => i.name).join(", ") || "(none yet)";

  // Mark processing — the UI doesn't poll yet, but the status field is
  // useful for debugging stuck extractions later.
  await admin.from("documents").update({ status: "processing" }).eq("id", documentId);

  // For images and PDFs, ship bytes as a data URL to a vision-capable
  // model. For CSV / XLSX we'd extract text first; that's deferred.
  const isVisionLike = doc.mime_type.startsWith("image/") || doc.mime_type === "application/pdf";
  if (!isVisionLike) {
    await admin
      .from("documents")
      .update({ status: "failed" })
      .eq("id", documentId);
    return {
      ok: false,
      error: "Extraction currently supports images and PDFs only.",
    };
  }

  const downloaded = await downloadDocumentAsDataUrl(supabase, doc.storage_path, doc.mime_type);
  if (!downloaded) {
    await admin.from("documents").update({ status: "failed" }).eq("id", documentId);
    return { ok: false, error: "Could not download the document for extraction." };
  }

  const llmResult = await llmCall(
    EXTRACT_PROMPT_SLUG,
    {
      known_institutions: knownInstitutions,
      user_default_currency: userDefaultCurrency,
      document_image_or_text: "(see attached)",
    },
    { images: [downloaded.dataUrl] }
  );

  if (!llmResult.ok) {
    await admin
      .from("documents")
      .update({ status: "failed" })
      .eq("id", documentId);
    return {
      ok: false,
      error: llmResult.error,
    };
  }

  let parsed: ExtractedStatement;
  try {
    parsed = parseAndValidate(llmResult.text);
  } catch (err) {
    await admin.from("documents").update({ status: "failed" }).eq("id", documentId);
    return {
      ok: false,
      error: `Could not parse the model's response: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  await admin
    .from("documents")
    .update({
      extracted_json: parsed,
      status: "extracted",
    })
    .eq("id", documentId);

  return {
    ok: true,
    extracted: parsed,
    modelUsed: llmResult.modelUsed,
    wasFallback: llmResult.wasFallback,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Parse + validate
// We tolerate the model wrapping JSON in ```json fences and pick the
// first JSON object out of the response text.
// ──────────────────────────────────────────────────────────────────────

const VALID_DOC_TYPES = new Set([
  "bank_statement",
  "brokerage_statement",
  "mortgage_statement",
  "utility_bill",
  "property_valuation",
  "payslip",
  "credit_card_statement",
  "other",
]);
const VALID_CURRENCIES = new Set(["GBP", "USD", "CAD"]);
const VALID_CONFIDENCES = new Set(["low", "medium", "high"]);

function parseAndValidate(text: string): ExtractedStatement {
  const trimmed = text.trim();
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) {
    throw new Error("No JSON object in response.");
  }
  const candidate = trimmed.slice(objectStart, objectEnd + 1);
  const obj = JSON.parse(candidate) as Record<string, unknown>;

  const docType = String(obj.document_type ?? "");
  if (!VALID_DOC_TYPES.has(docType)) {
    throw new Error(`Unknown document_type "${docType}".`);
  }

  const currency = String(obj.currency ?? "").toUpperCase();
  if (!VALID_CURRENCIES.has(currency)) {
    throw new Error(`Unknown currency "${currency}".`);
  }

  const balanceAmount = Number(obj.balance_amount);
  if (!Number.isFinite(balanceAmount)) {
    throw new Error("balance_amount must be a number.");
  }

  const accountLast4 =
    obj.account_last4 == null
      ? null
      : (() => {
          const s = String(obj.account_last4).replace(/\D/g, "");
          return /^\d{4}$/.test(s) ? s : null;
        })();

  const asOfDate =
    obj.as_of_date == null
      ? null
      : /^\d{4}-\d{2}-\d{2}$/.test(String(obj.as_of_date))
        ? String(obj.as_of_date)
        : null;

  const confidencesRaw = (obj.confidences ?? {}) as Record<string, unknown>;
  const confidences: Partial<Record<keyof ExtractedStatement, Confidence>> = {};
  for (const [k, v] of Object.entries(confidencesRaw)) {
    if (VALID_CONFIDENCES.has(String(v))) {
      confidences[k as keyof ExtractedStatement] = String(v) as Confidence;
    }
  }

  return {
    document_type: docType as ExtractedStatement["document_type"],
    institution_name:
      typeof obj.institution_name === "string" && obj.institution_name.trim().length > 0
        ? obj.institution_name.trim()
        : null,
    account_last4: accountLast4,
    currency: currency as "GBP" | "USD" | "CAD",
    balance_amount: balanceAmount,
    as_of_date: asOfDate,
    confidences,
    raw_notes: typeof obj.raw_notes === "string" ? obj.raw_notes : null,
  };
}
