# CLAUDE.md — Numara

Operating guide for Claude Code on this project. Read this on every session, then read `PRD.md`.

---

## What this project is

Numara is a personal net worth tracker built around document capture. The full specification lives in `PRD.md` at the root of this repo. The PRD is the source of truth for what to build; this file is the source of truth for **how** to build it and **what not to do**.

If `PRD.md` and `CLAUDE.md` ever disagree, stop and ask.

---

## Read the PRD first

At the start of every session, read `PRD.md` end to end before answering questions about features, data model, or behaviour. Do not rely on memory of previous sessions — the PRD is versioned and may have moved.

When implementing a feature, cite the PRD section in your plan (e.g. "Building the extraction review card per §5.2.1"). This makes drift easy to spot.

---

## Stack — non-negotiable without discussion

- **Framework:** Next.js (App Router) + React + TypeScript.
- **Styling:** Tailwind. No CSS-in-JS libraries. No component libraries beyond shadcn/ui if needed.
- **Database:** Supabase (Postgres) with row-level security. All user-data tables enforce RLS bound to `auth.uid()` and scoped through `household_id`.
- **Auth:** Supabase Auth, passkey / WebAuthn primary, email magic link fallback.
- **File storage:** Supabase Storage, private buckets, short-lived signed URLs only.
- **LLM gateway:** OpenRouter, exclusively. See "LLM rules" below.
- **PWA:** Installable to iOS home screen. Mobile-first for capture, desktop for review.

Do not introduce alternatives to any of the above without flagging it first and getting confirmation.

---

## The hard rules

These are things to never do without explicit user approval in the chat. If you find yourself about to, stop and ask.

1. **Never call an LLM provider SDK directly.** No `@anthropic-ai/sdk`, no `openai`, no `@google/generative-ai`. Every LLM call goes through the internal `llm.call(promptSlug, vars)` service, which routes through OpenRouter. No exceptions, including for "quick scripts" or tests.
2. **Never hardcode a model name** in app code outside the admin backend. Model selection happens in `PromptBinding` rows, not in TypeScript constants.
3. **Never inline a prompt string** in app code. Prompts live in the `Prompt` / `PromptVersion` tables, fetched by slug. If you need a new prompt, add a seed for it and reference it by slug.
4. **Never store an API key, secret, or token in `.env` for runtime use.** `.env.local` is fine for local bootstrap (the very first OpenRouter key needed to seed `SystemSecret`), but the running app reads keys from the `SystemSecret` table. Anything that ends up in the deployed runtime environment for secrets is a bug.
5. **Never write user-scoped data.** Every user-owned table is scoped through `household_id`, even when the v1 UI is single-user. See §8 of the PRD.
6. **Never run destructive migrations** (`DROP`, `ALTER ... DROP`, `TRUNCATE`, data backfills that delete) without showing the migration first and getting an explicit "yes, run it."
7. **Never log financial values** to console, server logs, or third-party services. Amounts, balances, account identifiers, and document contents must be scrubbed.
8. **Never store full account numbers.** Extract `account_last4` from the LLM output, then drop the rest before persistence.
9. **Never add a new npm dependency** without saying which one, why, what it weighs, and what the alternative would be.
10. **Never bypass the extraction review step (§5.2.1).** Document-derived balances never auto-commit, regardless of confidence score.

---

## LLM rules (this is the most security-sensitive part)

The admin backend (PRD §14) is where all the LLM machinery lives. Treat it as the most sensitive part of the codebase.

### The `llm.call` service

This service is the only path from app code to a language model. Signature:

```ts
llm.call(promptSlug: string, vars: Record<string, unknown>, opts?: CallOptions): Promise<LLMResult>
```

It must:

- Look up the `Prompt` row by slug, load `current_version_id.body`, substitute `{{vars}}`.
- Load the `PromptBinding` (primary, fallback_1, fallback_2, temperature, max_tokens, response_format, json_schema).
- Call OpenRouter with the primary. On failure (5xx, timeout, empty response, JSON schema validation failure, content filter, model offline), try fallback_1. On failure, try fallback_2. If all three fail, throw with the chain of errors.
- Log every attempt to `LLMCallLog` with `was_fallback` set to 0, 1, or 2.
- Never log the prompt body or the response body in plaintext to anything except the database row, which is RLS-protected.

If you are tempted to add a "quick path" that skips this service, don't. Add the prompt instead.

### The admin backend (`/admin`)

- Mounted at `/admin`, gated by middleware that checks `users.is_system_admin = true`. Non-admins get a 404, not a 403.
- Regular users never see any link to `/admin`, any reference to model names, prompts, OpenRouter, or costs anywhere in the UI.
- Server-side: every admin route re-checks the flag. Never trust client-side state for admin access.
- The `SystemSecret` table uses a separate encryption key from user data. If you find yourself reusing the user-data encryption key for system secrets, stop.

### Adding a new prompt

Always go through this flow, never inline:

1. Add a seed row for the prompt (slug, name, purpose, body, available_slugs) in the migration / seed file.
2. Add a `PromptBinding` row pointing at sensible default models.
3. Call it from app code via `llm.call('your_slug', { ... })`.
4. Mention in your response that the admin should tune the binding in `/admin/prompts` after deploy.

---

## Code conventions

- **Language:** TypeScript everywhere. No `.js` files in the app (config files excepted). `any` is a code smell; flag it when you have to use it.
- **Spelling:** British English in code comments, UI copy, and prompt bodies (e.g. "categorise", "normalise", "summarise", "colour" in user-visible text). This matches the PRD.
- **File structure:** Next.js App Router conventions. Route handlers in `app/api/`, server components by default, `'use client'` only when needed.
- **Naming:** kebab-case for files, PascalCase for components, camelCase for functions and variables, snake_case for database columns. Match the data model exactly — `household_id` not `householdId` in DB references.
- **Imports:** absolute imports from `@/` root, never deep relative imports (`../../../`).
- **Errors:** typed errors, never `throw new Error("string")` for anything that can be caught and handled. Use a small error class hierarchy.
- **Comments:** explain *why*, not *what*. The code shows what. If a comment paraphrases the line beneath it, delete it.

---

## Database conventions

- Every user-owned table has a `household_id` column with a foreign key to `households(id)` and an RLS policy of the form `household_id IN (SELECT household_id FROM users WHERE auth.uid() = users.id)`.
- Admin tables (`SystemSecret`, `Prompt`, `PromptVersion`, `PromptBinding`, `OpenRouterModel`, `LLMCallLog`, `AdminAuditLog`) are global, not household-scoped. RLS policy: `EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_system_admin = true)`.
- Money is stored as `numeric(20, 4)` in the asset's native currency. Never use floats for money.
- Dates that are calendar dates (statement date, snapshot date) use `date`. Timestamps use `timestamptz`.
- Every table has `created_at timestamptz not null default now()`. Mutable tables also have `updated_at` maintained by a trigger.
- Migrations are forward-only. Never edit a migration after it has been applied to any environment.

---

## UI conventions

- Mobile-first. The capture flow must work on iOS Safari with the screen keyboard up.
- Calm and dense. No animations, no loading celebrations, no decorative gradients on financial data.
- Numbers right-aligned in lists, tabular figures (`font-variant-numeric: tabular-nums`).
- Currency symbol shown but visually de-emphasised.
- Staleness is visible: amber dot for assets >90 days old, last-updated date always shown.
- Privacy mode: one tap blurs all balances site-wide. Implement as a global state, not per-component.
- Use **Numara's accent colour sparingly** — single accent on a monochrome ground. If you find yourself reaching for a second colour, ask first. **Exception: data visualisations (charts) are deliberately colourful — draw from the Numara chart palette in `lib/chart-palette.ts`, per PRD §9.1.**

---

## Testing

- Unit tests for the `llm.call` service, in particular the fallback chain. Mock OpenRouter, force failures on the primary, assert the call lands on fallback_1; force two failures, assert fallback_2; force three failures, assert it throws.
- Unit tests for the snapshot computation (§5.9), including the "carry forward" edge case when an asset has no balance for the month.
- Unit tests for the new-vs-update classification logic.
- Integration test that posts a sample document, asserts an extraction review card is returned (not auto-committed), and asserts that confirming creates a `BalanceEntry`.
- No tests against live OpenRouter. Ever.

---

## When to stop and ask

Stop and ask before:

- Changing anything in `PRD.md`.
- Adding a new dependency.
- Changing the data model in a way that touches existing tables.
- Adding a route under `/admin`.
- Touching encryption, RLS policies, or auth flows.
- Writing anything that talks to OpenRouter outside the `llm.call` service.
- Implementing a feature that isn't in the PRD or the build sequence.
- Skipping a step in the build sequence (§13 of the PRD) because it seems out of order.

When in doubt, draft a plan, paste the relevant PRD section, and wait for "go."

---

## Build sequence — work in order

Follow §13 of the PRD step by step. Do not jump ahead. The order matters: auth and dashboard scaffolding come before manual entry; manual entry comes before FX; the admin backend foundation comes before the first real LLM call. Each step should land in a green state (deploys, no broken tests) before starting the next.

When a step is done, summarise what changed, link to the PRD section, and ask whether to proceed to the next step.

---

*This file should stay short and opinionated. If it starts to bloat with edge cases, those probably belong in the PRD instead.*
