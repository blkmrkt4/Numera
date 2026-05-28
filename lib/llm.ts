import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { callOpenRouter } from "@/lib/openrouter";

export type LlmMessageContent = string | Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
>;

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: LlmMessageContent;
};

export type LlmCallOptions = {
  /** Override the system prompt above the rendered body. */
  systemMessage?: string;
  /** Provide extra messages (images, examples) appended after the prompt body. */
  extraMessages?: LlmMessage[];
  /**
   * Attach images to the user turn that carries the rendered prompt body.
   * Each entry is a base64 data URL (e.g. `data:image/jpeg;base64,...`).
   * The text + images get sent as a single multipart user message, which
   * is what most vision-capable models prefer.
   */
  images?: string[];
  /** Override the per-attempt timeout (default 30s). */
  timeoutMs?: number;
  /**
   * Mark this call as an admin test run. Logged with was_test=true so the
   * test rate-limit query can find it; production calls leave this false.
   */
  isTest?: boolean;
  /** Who triggered the call (test calls only); null for production calls. */
  actorId?: string | null;
};

export type LlmCallResult =
  | { ok: true; text: string; modelUsed: string; wasFallback: 0 | 1 | 2 }
  | { ok: false; error: string; attempts: Array<{ model: string; error: string }> };

/**
 * The only path from application code to an LLM (PRD §14 / §7).
 * Resolves a prompt by slug, substitutes {{vars}}, then tries the primary
 * + fallback 1 + fallback 2 in order. Every attempt is logged.
 */
export async function llmCall(
  promptSlug: string,
  vars: Record<string, string>,
  opts: LlmCallOptions = {}
): Promise<LlmCallResult> {
  const admin = createAdminClient();

  // Load prompt, current version, and binding in one round-trip per table.
  const { data: prompt } = await admin
    .from("prompts")
    .select("id, slug, current_version_id, status")
    .eq("slug", promptSlug)
    .maybeSingle();
  if (!prompt) {
    return {
      ok: false,
      error: `Prompt "${promptSlug}" not found.`,
      attempts: [],
    };
  }
  if (prompt.status !== "active") {
    return {
      ok: false,
      error: `Prompt "${promptSlug}" is disabled.`,
      attempts: [],
    };
  }
  if (!prompt.current_version_id) {
    return {
      ok: false,
      error: `Prompt "${promptSlug}" has no version configured.`,
      attempts: [],
    };
  }

  const [{ data: version }, { data: binding }] = await Promise.all([
    admin
      .from("prompt_versions")
      .select("body, available_slugs")
      .eq("id", prompt.current_version_id)
      .maybeSingle(),
    admin
      .from("prompt_bindings")
      .select(
        "primary_model_slug, fallback_1_model_slug, fallback_2_model_slug, temperature, max_tokens, response_format, json_schema"
      )
      .eq("prompt_id", prompt.id)
      .maybeSingle(),
  ]);

  if (!version) {
    return {
      ok: false,
      error: `Prompt "${promptSlug}" current version not found.`,
      attempts: [],
    };
  }
  if (!binding) {
    return {
      ok: false,
      error: `Prompt "${promptSlug}" has no model binding.`,
      attempts: [],
    };
  }

  const renderedBody = renderTemplate(version.body, vars);

  const messages: LlmMessage[] = [];
  if (opts.systemMessage) messages.push({ role: "system", content: opts.systemMessage });

  if (opts.images?.length) {
    // Multimodal user turn: text + image parts in one message.
    const parts: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: renderedBody }];
    for (const url of opts.images) {
      parts.push({ type: "image_url", image_url: { url } });
    }
    messages.push({ role: "user", content: parts });
  } else {
    messages.push({ role: "user", content: renderedBody });
  }

  if (opts.extraMessages?.length) messages.push(...opts.extraMessages);

  const chain: Array<{ model: string | null; tier: 0 | 1 | 2 }> = [
    { model: binding.primary_model_slug, tier: 0 },
    { model: binding.fallback_1_model_slug, tier: 1 },
    { model: binding.fallback_2_model_slug, tier: 2 },
  ];

  const attempts: Array<{ model: string; error: string }> = [];

  for (const link of chain) {
    if (!link.model) continue;

    const startedAt = Date.now();
    const result = await callOpenRouter({
      model: link.model,
      messages,
      temperature: binding.temperature ?? undefined,
      max_tokens: binding.max_tokens ?? undefined,
      response_format:
        binding.response_format === "json"
          ? binding.json_schema
            ? {
                type: "json_schema",
                json_schema: {
                  name: `${promptSlug}_output`,
                  schema: binding.json_schema as Record<string, unknown>,
                  strict: true,
                },
              }
            : { type: "json_object" }
          : { type: "text" },
      timeoutMs: opts.timeoutMs,
    });
    const latencyMs = Date.now() - startedAt;

    if (result.ok) {
      await logCall({
        promptSlug,
        model: link.model,
        wasFallback: link.tier,
        latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        success: true,
        isTest: opts.isTest ?? false,
        actorId: opts.actorId ?? null,
      });
      return { ok: true, text: result.text, modelUsed: link.model, wasFallback: link.tier };
    }

    attempts.push({ model: link.model, error: result.error });
    await logCall({
      promptSlug,
      model: link.model,
      wasFallback: link.tier,
      latencyMs,
      inputTokens: null,
      outputTokens: null,
      success: false,
      errorMessage: result.error,
      isTest: opts.isTest ?? false,
      actorId: opts.actorId ?? null,
    });
  }

  return {
    ok: false,
    error: `All ${attempts.length} attempt(s) failed for prompt "${promptSlug}".`,
    attempts,
  };
}

function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/{{\s*([a-z_][a-z0-9_]*)\s*}}/gi, (_match, name) => {
    if (name in vars) return vars[name];
    return _match;
  });
}

async function logCall(params: {
  promptSlug: string;
  model: string;
  wasFallback: 0 | 1 | 2;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  success: boolean;
  errorMessage?: string;
  isTest: boolean;
  actorId: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from("llm_call_logs").insert({
    prompt_slug: params.promptSlug,
    model_used: params.model,
    was_fallback: params.wasFallback,
    latency_ms: params.latencyMs,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_usd: null, // computed in a follow-up when we wire model price lookup
    success: params.success,
    error_message: params.errorMessage ?? null,
    was_test: params.isTest,
    actor_id: params.actorId,
  });
}

const TEST_CALLS_PER_MINUTE = 10;

/**
 * Sliding-window rate limit for admin test calls (PRD §14.8).
 * Counts test calls by this admin in the last 60s and rejects if too many.
 */
export async function isTestRateLimited(
  actorId: string
): Promise<{ limited: boolean; remaining: number }> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin
    .from("llm_call_logs")
    .select("id", { count: "exact", head: true })
    .eq("was_test", true)
    .eq("actor_id", actorId)
    .gte("created_at", since);
  const used = count ?? 0;
  return {
    limited: used >= TEST_CALLS_PER_MINUTE,
    remaining: Math.max(0, TEST_CALLS_PER_MINUTE - used),
  };
}
