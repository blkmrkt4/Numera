import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSecret, SECRET_KEYS } from "@/lib/secrets";

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export type OpenRouterModel = {
  slug: string;
  name: string;
  provider: string;
  context_length: number | null;
  input_cost_per_mtoken: number | null;
  output_cost_per_mtoken: number | null;
  supports_vision: boolean;
  supports_tools: boolean;
  supports_json_mode: boolean;
  is_coding_specialist: boolean;
  is_reasoning_specialist: boolean;
  is_available: boolean;
  last_synced_at: string;
};

/**
 * Pull the model catalogue from OpenRouter and refresh openrouter_models.
 * Marks any previously-known model that no longer appears as
 * is_available = false rather than deleting, so prompt bindings that
 * point at it remain inspectable.
 */
export async function syncModelCatalogue(): Promise<{
  ok: true;
  fetched: number;
  available: number;
} | { ok: false; error: string }> {
  const apiKey = await readSecret(SECRET_KEYS.OPENROUTER_API_KEY);
  if (!apiKey) return { ok: false, error: "OpenRouter API key is not set." };

  let payload: { data: RawModel[] };
  try {
    const res = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { ok: false, error: `OpenRouter responded ${res.status}` };
    }
    payload = await res.json();
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const now = new Date().toISOString();
  const rows = (payload.data ?? []).map(normaliseModel).map((m) => ({
    ...m,
    last_synced_at: now,
  }));

  if (rows.length === 0) {
    return { ok: false, error: "OpenRouter returned an empty model list." };
  }

  const admin = createAdminClient();

  const { error: upsertErr } = await admin
    .from("openrouter_models")
    .upsert(rows, { onConflict: "slug" });
  if (upsertErr) return { ok: false, error: `Upsert failed: ${upsertErr.message}` };

  // Anything not in this sync gets marked unavailable. Update + filter by
  // last_synced_at < now keeps the write small and avoids deleting history.
  const { error: stalenessErr } = await admin
    .from("openrouter_models")
    .update({ is_available: false })
    .lt("last_synced_at", now);
  if (stalenessErr) {
    return { ok: false, error: `Stale-mark failed: ${stalenessErr.message}` };
  }

  return { ok: true, fetched: rows.length, available: rows.length };
}

/**
 * Make a single LLM call through OpenRouter, with no fallback chain.
 * Used by llm.call() to attempt primary then each fallback in turn.
 */
type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean;
      };
    };

export async function callOpenRouter(opts: {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string | unknown[] }>;
  temperature?: number;
  max_tokens?: number;
  response_format?: ResponseFormat;
  timeoutMs?: number;
}): Promise<{
  ok: true;
  text: string;
  raw: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
} | { ok: false; error: string; status?: number }> {
  const apiKey = await readSecret(SECRET_KEYS.OPENROUTER_API_KEY);
  if (!apiKey) return { ok: false, error: "OpenRouter API key is not set." };

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
  };
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (typeof opts.max_tokens === "number") body.max_tokens = opts.max_tokens;
  if (opts.response_format) body.response_format = opts.response_format;

  let res: Response;
  try {
    res = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://numara.local",
        "X-Title": "Numara",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Network: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: text || `HTTP ${res.status}` };
  }

  let json: ChatCompletionResponse;
  try {
    json = (await res.json()) as ChatCompletionResponse;
  } catch (err) {
    return {
      ok: false,
      error: `Could not parse OpenRouter response: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const choice = json.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== "string" || text.length === 0) {
    return { ok: false, error: "OpenRouter returned no text content." };
  }

  return {
    ok: true,
    text,
    raw: json,
    inputTokens: json.usage?.prompt_tokens ?? null,
    outputTokens: json.usage?.completion_tokens ?? null,
  };
}

// ---------------------------------------------------------------------------
// model normalisation
// ---------------------------------------------------------------------------

type RawModel = {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string | number; completion?: string | number };
  architecture?: { modality?: string; input_modalities?: string[] };
  supported_parameters?: string[];
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function normaliseModel(m: RawModel): Omit<OpenRouterModel, "last_synced_at"> & {
  raw: RawModel;
} {
  const slug = m.id;
  const provider = slug.split("/")[0] ?? "unknown";
  const pricingPrompt = m.pricing?.prompt != null ? Number(m.pricing.prompt) : null;
  const pricingCompletion = m.pricing?.completion != null ? Number(m.pricing.completion) : null;
  const supported = m.supported_parameters ?? [];
  const modalities = [m.architecture?.modality ?? "", ...(m.architecture?.input_modalities ?? [])]
    .join(",")
    .toLowerCase();

  const name = m.name ?? slug;
  const lowerId = `${slug} ${name}`.toLowerCase();

  return {
    slug,
    name,
    provider,
    context_length: typeof m.context_length === "number" ? m.context_length : null,
    input_cost_per_mtoken:
      pricingPrompt != null && Number.isFinite(pricingPrompt)
        ? pricingPrompt * 1_000_000
        : null,
    output_cost_per_mtoken:
      pricingCompletion != null && Number.isFinite(pricingCompletion)
        ? pricingCompletion * 1_000_000
        : null,
    supports_vision: modalities.includes("image") || modalities.includes("multi"),
    supports_tools: supported.includes("tools") || supported.includes("tool_choice"),
    supports_json_mode: supported.includes("response_format"),
    is_coding_specialist: /\b(code|coder|devstral|qwen.*coder)\b/.test(lowerId),
    is_reasoning_specialist: /\b(o1|o3|o4|reasoning|thinking|deepseek-r1)\b/.test(lowerId),
    is_available: true,
    raw: m,
  };
}
