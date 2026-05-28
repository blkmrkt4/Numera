import "server-only";
import { llmCall } from "@/lib/llm";
import type { AssetCategory, Currency } from "@/lib/types";
import type { ExtractedStatement } from "@/lib/extraction";

const CLASSIFY_PROMPT_SLUG = "classify_new_vs_update";

export type AssetCandidate = {
  id: string;
  name: string;
  category: AssetCategory;
  native_currency: Currency;
  account_last4: string | null;
  institution_name: string | null;
};

export type Proposal =
  | {
      action: "update";
      asset_id: string;
      asset_name: string;
      reason: string;
      confidence: "high" | "medium" | "low";
      used_llm: boolean;
    }
  | {
      action: "new";
      suggested_category: AssetCategory;
      suggested_name: string | null;
      hint: string | null;
      reason: string;
    };

/**
 * Decide whether an extracted document should update an existing asset
 * or create a new one. Deterministic match first; LLM tiebreaker only
 * when more than one candidate plausibly matches.
 */
export async function classifyDocument(
  extracted: ExtractedStatement,
  candidates: AssetCandidate[]
): Promise<Proposal> {
  const normalisedExtractedInst = normaliseInstitution(extracted.institution_name);
  const extractedLast4 = extracted.account_last4;
  const extractedCurrency = extracted.currency;

  // Restrict to same-currency candidates — different currency is almost
  // always a different account, even if the institution matches.
  const sameCurrency = candidates.filter((c) => c.native_currency === extractedCurrency);

  // Find institution-matching candidates within the currency set.
  const institutionMatches = sameCurrency.filter(
    (c) =>
      normalisedExtractedInst &&
      normaliseInstitution(c.institution_name) === normalisedExtractedInst
  );

  // 1) Perfect match: same institution AND same last4. The strongest signal.
  if (extractedLast4) {
    const perfect = institutionMatches.filter((c) => c.account_last4 === extractedLast4);
    if (perfect.length === 1) {
      return {
        action: "update",
        asset_id: perfect[0].id,
        asset_name: perfect[0].name,
        reason: `Matched via ${perfect[0].institution_name ?? "institution"} + ···· ${extractedLast4}.`,
        confidence: "high",
        used_llm: false,
      };
    }
    if (perfect.length > 1) {
      // Pathological — same institution + last4 + currency on more than one
      // asset. Defer to the LLM if available; otherwise pick the first.
      return (
        (await llmTiebreaker(extracted, perfect)) ?? {
          action: "update",
          asset_id: perfect[0].id,
          asset_name: perfect[0].name,
          reason: `Multiple exact matches; first selected. Confirm before saving.`,
          confidence: "low",
          used_llm: false,
        }
      );
    }
  }

  // 2) Institution match, document has no last4. If exactly one
  // same-institution candidate exists, propose that. Otherwise tiebreak.
  if (!extractedLast4 && institutionMatches.length === 1) {
    return {
      action: "update",
      asset_id: institutionMatches[0].id,
      asset_name: institutionMatches[0].name,
      reason: `Matched via ${institutionMatches[0].institution_name ?? "institution"} (no account number on document).`,
      confidence: "medium",
      used_llm: false,
    };
  }
  if (!extractedLast4 && institutionMatches.length > 1) {
    return (
      (await llmTiebreaker(extracted, institutionMatches)) ?? {
        action: "update",
        asset_id: institutionMatches[0].id,
        asset_name: institutionMatches[0].name,
        reason: `Multiple ${institutionMatches[0].institution_name ?? "institution"} accounts; first selected. Confirm before saving.`,
        confidence: "low",
        used_llm: false,
      }
    );
  }

  // 3) Institution match but last4 doesn't match any of them. The user
  // probably has another account at this institution.
  if (extractedLast4 && institutionMatches.length > 0) {
    return {
      action: "new",
      suggested_category: categoryFromDocType(extracted.document_type),
      suggested_name:
        extracted.institution_name && extractedLast4
          ? `${extracted.institution_name} ···· ${extractedLast4}`
          : null,
      hint: `You already have ${institutionMatches.length} ${
        institutionMatches[0].institution_name ?? "matching"
      } asset${institutionMatches.length === 1 ? "" : "s"}, but the account number doesn't match.`,
      reason: "Institution recognised; account number is new.",
    };
  }

  // 4) Nothing matches — propose NEW with a category hint from doc type.
  return {
    action: "new",
    suggested_category: categoryFromDocType(extracted.document_type),
    suggested_name: extracted.institution_name ?? null,
    hint: null,
    reason: "No matching institution found for this household.",
  };
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

function normaliseInstitution(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  // Strip common suffixes that don't change identity: "Bank", "UK", "Ltd",
  // "Limited", "PLC", "NA", "Group", trailing punctuation.
  return trimmed
    .replace(/[.,]+$/g, "")
    .replace(/\s+(bank|uk|ca|us|usa|na|plc|ltd|limited|group|inc|corp)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryFromDocType(docType: string): AssetCategory {
  switch (docType) {
    case "brokerage_statement":
      return "investment";
    case "mortgage_statement":
    case "credit_card_statement":
      return "liability";
    case "bank_statement":
      return "cash";
    case "property_valuation":
      return "real_estate";
    case "utility_bill":
    case "payslip":
    case "other":
    default:
      return "cash";
  }
}

/**
 * Ask classify_new_vs_update to pick among ambiguous candidates.
 * Returns null when the prompt is disabled or fails — callers fall back
 * to a deterministic best-guess so the user is never blocked.
 */
async function llmTiebreaker(
  extracted: ExtractedStatement,
  candidates: AssetCandidate[]
): Promise<Proposal | null> {
  const candidateBlock = candidates
    .map(
      (c, i) =>
        `${i + 1}. id=${c.id} | ${c.name} | ${c.institution_name ?? "(no institution)"} | ···· ${c.account_last4 ?? "—"} | ${c.native_currency}`
    )
    .join("\n");

  const result = await llmCall(CLASSIFY_PROMPT_SLUG, {
    extracted: JSON.stringify(extracted, null, 2),
    candidate_assets: candidateBlock,
  });

  if (!result.ok) return null;

  try {
    const parsed = JSON.parse(stripFences(result.text)) as {
      asset_id?: string;
      action?: "update" | "new";
      reason?: string;
    };
    if (parsed.action === "update" && parsed.asset_id) {
      const picked = candidates.find((c) => c.id === parsed.asset_id);
      if (picked) {
        return {
          action: "update",
          asset_id: picked.id,
          asset_name: picked.name,
          reason: parsed.reason ?? "Tiebreaker resolved by classify_new_vs_update.",
          confidence: "medium",
          used_llm: true,
        };
      }
    }
  } catch {
    // fall through to null
  }
  return null;
}

function stripFences(s: string): string {
  const t = s.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return t;
  return t.slice(start, end + 1);
}
