# Numara — Product Requirements Document

**A personal net worth tracker built around document capture.**

| Field | Value |
|---|---|
| Author | Robin David Hutchinson |
| Version | 0.3 (Draft — admin backend added) |
| Date | 20 May 2026 |
| Status | For review — pre-engineering |
| Target platform | Responsive web app (PWA) — desktop + iOS Safari |

## Changelog

| Version | Changes |
|---|---|
| **v0.3** | All LLM calls now route through OpenRouter (no direct provider SDKs). Added an admin-only backend (§14) for managing API keys, prompts, slugs, model bindings, and fallbacks. Two admin pages: Settings (API keys + defaults) and Prompts (combined prompt editor and model binding, with a searchable model picker showing every OpenRouter model, cost, context window, and capability indicators). Each prompt binding supports a primary model plus two fallbacks. Data model extended with `SystemSecret`, `Prompt`, `PromptVersion`, `PromptBinding`, and `OpenRouterModel` entities. `User.is_system_admin` flag added. Build sequence updated. |
| v0.2 | Open questions resolved: manual entry is supported in v1 alongside document-driven capture. Extracted fields are now shown explicitly for user verification before save. Recurring outgoings live in a separate cash-flow view, not netted into net worth. Historical net worth is computed as monthly snapshots. Data model is household-ready from day one; UI remains single-user in v1. |
| v0.1 | Initial draft. |

---

## 1. Executive summary

Numara is a personal financial picture tool. The core insight is that most net worth tools fail because they demand structured data entry; people give up because the friction of typing balances from twelve different statements is too high. Numara inverts that: the primary input is a photo or upload of a statement, and the system does the work of figuring out what the document represents, what the balance is, and whether it is new or an update to an existing account.

Outputs are simple: a single dashboard of total net worth in USD, CAD, and GBP, broken down by category — real estate, investments, cash, liabilities, recurring outgoings — with the ability to drill into any asset for detail and, in the case of real estate, a quick "what would I net if I sold this today?" view.

The product is built for one user initially (the author) but is structured so it can extend to a household view later.

---

## 2. Goals and non-goals

### 2.1 Goals

- Reduce the time to capture a new balance to under 15 seconds: open app, photo, confirm, done.
- Maintain an accurate live net worth view across three currencies with daily FX refresh.
- Provide one-tap insight into the realisable (post-cost) value of any major asset, particularly real estate.
- Work equally well on iPhone (capture-heavy use) and laptop (review and analysis).
- Keep all financial data private, encrypted, and under the user's sole control.

### 2.2 Non-goals (v1)

- Real-time bank connections via Plaid, TrueLayer, or open-banking APIs. The whole point is document-driven capture; bank linking can be a later add.
- Tax filing, tax optimisation, or jurisdiction-specific reporting.
- Investment advice, portfolio rebalancing, or trading.
- Budgeting against a target or month-over-month expense categorisation.
- Multi-user shared accounts. Single user only in v1.

---

## 3. Target user

Primary user is a high-net-worth individual with assets and liabilities spread across multiple jurisdictions (in this case, UK, Canada, and US), multiple currencies, and a mix of statement formats — brokerage PDFs, mortgage statements, property valuations, bank balances, recurring bill summaries. The user is comfortable with technology but values speed and clarity over configurability. They will use the app on iPhone for capture and on a laptop for periodic review.

---

## 4. Core user journeys

### 4.1 Capture a new statement (document-driven)

1. User taps the camera or upload button on the home screen.
2. User takes a photo of a statement, or selects a PDF/Excel/image from device storage.
3. App uploads the document and shows a "reading…" indicator (target < 5 seconds for typical document).
4. App returns an extraction review card showing every field the LLM extracted: detected institution, account type, currency, balance, statement / as-of date, and a confidence indicator per field. Each field is editable inline.
5. Below the extracted fields, the original document thumbnail is shown alongside so the user can visually cross-check what the model read against the source.
6. App proposes one of: (a) create new asset, (b) update existing asset X. The user confirms or corrects with a single tap.
7. On save, the verified balance is written to the asset history and the original document is linked for future audit. Dashboard totals refresh.

### 4.2 Capture a new balance (manual)

A manual path is supported as a first-class flow for cases where the user does not have a document handy, the document is hard to scan, or the asset is one the user prefers to maintain by hand (e.g. a private equity stake, an estimated valuation, cash in a wallet).

1. User taps "Add manually" from the home screen or from inside an existing asset.
2. For a new asset, user picks a category, names the asset, picks currency, and enters the balance and as-of date.
3. For an existing asset, user just enters the new balance and date.
4. Manually entered balances are flagged as such in the history so the user can distinguish them from document-derived entries when reviewing trends.

### 4.3 Review net worth

1. User opens the dashboard. Headline number is current total net worth in their default currency (configurable).
2. Underneath, a category breakdown: Real estate, Investments, Cash, Liabilities, Recurring outgoings.
3. Currency toggle in the top right cycles USD / CAD / GBP. All numbers reformat using the FX rates fetched that morning.
4. Tapping any category reveals the underlying assets, each with its current balance and last-updated date.

### 4.4 Real estate "sell today" analysis

1. User taps a property in the real estate list.
2. Detail view shows: estimated market value (manually entered, with edit history), outstanding mortgage (from latest statement), and net equity (calculated).
3. Below that, a "Sell scenario" panel: applies configurable transaction costs (agent fee, legal, capital gains where applicable, mortgage discharge fees) and shows estimated cash in pocket on sale, in the user's chosen display currency.
4. Each cost line item is editable per property, with sensible jurisdiction-aware defaults (e.g. 5% agent commission in Canada, 1.25% in the UK).

---

## 5. Functional requirements

### 5.1 Document capture, manual entry, and ingestion

- Document input methods: native camera capture (iOS), file picker for PDF, XLSX/XLS/CSV, and image formats (HEIC, JPEG, PNG).
- Manual input: an "Add manually" path is supported as a first-class flow for cases where there is no document, or the user prefers to maintain the value by hand. Manual entries are flagged as such on the balance history.
- Multi-page PDFs are processed as a single document; image batches (e.g. two pages of a statement) can be grouped before processing.
- Each uploaded document is stored encrypted at rest and linked to the resulting asset record for audit.
- User can re-open the original document from any historical balance entry.

### 5.2 AI extraction and classification

Extraction is performed by a vision-capable LLM call (Claude or equivalent) with a structured output schema. The model must return:

- Document type (bank statement, brokerage statement, mortgage statement, utility bill, property valuation, payslip, other).
- Institution name (best effort, normalised against the user's known institutions).
- Account or reference identifier (last 4 digits where applicable; never store full account numbers).
- Balance or amount, with currency.
- Statement date or as-of date.
- Confidence score per field.

Classification logic (new vs update) runs after extraction:

- If institution + account identifier matches an existing asset within tolerance, propose **UPDATE**.
- If institution matches but account differs, propose **NEW** with a hint that an existing asset from that institution exists.
- If nothing matches, propose **NEW** with a suggested category based on document type.
- User always sees the proposal and can override with one tap.

#### 5.2.1 Extraction review (user verifies LLM output)

The extraction step must always surface what the LLM read back to the user for verification before anything is committed. This is non-optional, even for high-confidence extractions.

- Every extracted field is displayed in an editable form: institution, account type, last-4 identifier, currency, amount, as-of date, document type.
- Each field shows a confidence indicator (high / medium / low). Low-confidence fields are visually highlighted and require explicit user touch to confirm.
- A thumbnail of the source document is shown adjacent to the extracted fields so the user can cross-check at a glance. Tapping the thumbnail opens the full document.
- User edits to extracted fields are captured as a correction signal. Over time, repeated corrections on similar documents from the same institution should feed a per-user mapping table that improves future extractions.
- Nothing writes to the dashboard until the user explicitly taps confirm.

### 5.3 Asset and liability categories

| Category | Includes | Capture pattern |
|---|---|---|
| **Real estate** | Primary residence, secondary properties, land. Each carries estimated market value (manual) and outstanding mortgage (from statement). | Manual value + mortgage statement upload |
| **Investments** | Brokerage, retirement (RRSP, ISA, 401k-equivalent), private equity stakes, crypto holdings. | Statement upload |
| **Cash** | Current and savings accounts across institutions and currencies. | Statement upload |
| **Debt / liabilities** | Mortgages (linked to property), credit lines, loans, credit card balances treated as debt. | Statement upload |
| **Recurring outgoings** | Regular bills: utilities, subscriptions, insurance, school fees, nanny payments. Tracked for monthly cash-flow context, not netted into net worth. | Bill upload or manual |

### 5.4 Multi-currency support

- Supported display currencies: USD, CAD, GBP. Each asset is stored in its native currency.
- FX rates fetched once daily from a reputable provider (e.g. exchangerate.host, Open Exchange Rates, or ECB feed). Cached for offline display.
- User selects a default display currency. A toggle on the dashboard cycles between the three.
- Historical balances are stored in native currency. Conversion to display currency uses the FX rate of the day the balance is being viewed, not the date the balance was captured (this keeps the dashboard a true "today" view).
- An optional "historical view" can show net worth over time in a chosen currency, using historical FX rates per data point.

### 5.5 Real estate detail and sale scenario

Real estate is treated specially because the asset value cannot come from a statement. The user enters and maintains the estimated market value manually. The system:

- Stores a history of value estimates with date stamps so the user can see how their view of the property has changed.
- Pulls the outstanding mortgage balance from the most recent mortgage statement linked to the property.
- Computes net equity = estimated market value − outstanding mortgage.
- Offers a "Sell scenario" view with editable cost assumptions: agent fee %, legal fees (flat or %), capital gains tax estimate, mortgage discharge / penalty fees, staging or prep budget.
- Sensible defaults per jurisdiction. The user can save custom defaults per property.
- Output: gross sale price, total costs, net cash, all in the chosen display currency.

### 5.6 Dashboard and visualisations

- Single headline: current total net worth in default currency.
- Category breakdown bar or donut, showing the split across the four net worth categories (real estate, investments, cash, liabilities). Recurring outgoings are excluded from the net worth number and live in their own cash-flow view (§5.8).
- Asset list per category, sorted by value, with last-updated date and a freshness indicator (e.g. amber if > 90 days old).
- Currency toggle, persistent across the session.
- A net worth over time chart using monthly snapshots (see §5.9) as a secondary view.
- An "alerts" strip flagging assets with stale data (e.g. "Your TD mortgage statement was last updated 4 months ago").

### 5.7 Asset detail view

- Header: asset name, category, native currency, current value.
- Balance history: list of every captured balance with date and link to source document.
- Edit controls: rename, re-categorise, archive.
- For real estate: market value editor, mortgage link, sale scenario calculator (see §5.5).
- For investments and cash: trend chart of balance history.
- For liabilities: payoff date estimate based on current trajectory (basic, optional in v1).

### 5.8 Cash flow view (recurring outgoings)

Recurring outgoings are tracked as a flow, not a stock, and therefore live in their own view rather than being netted into the net worth headline. The cash-flow view answers the question "what is my fixed monthly burn?"

- Each outgoing has: a name, an amount in its native currency, a billing cadence (monthly, quarterly, annual), a category (utilities, subscriptions, insurance, education, household staff, other), and a next-due date.
- Outgoings can be captured either by uploading a bill (extraction flow as per §5.1–5.2) or added manually.
- Cash-flow view shows: total monthly burn normalised to the display currency, breakdown by category, and a list of upcoming bills in the next 30 days.
- An optional annualised view shows total outgoings normalised to one year, useful for the post-EY budgeting context.
- Outgoings can be archived without losing history when a subscription is cancelled or a service stops.

### 5.9 Historical net worth (monthly snapshots)

Historical net worth is computed as a monthly snapshot rather than a running average. This gives a clean comparable series and avoids smoothing out the impact of one-off events (a property valuation update, a bonus, a large purchase).

- On the last day of each calendar month, a job computes the net worth as of that date by taking the latest balance for each asset on or before that date.
- Snapshots are stored per asset and aggregated for display. Each snapshot also records the FX rates used so the historical chart can be rendered consistently in any display currency.
- If an asset has no balance for the month, its most recent prior balance is carried forward, with a flag on the snapshot indicating it was carried.
- A user can manually trigger a snapshot at any time (e.g. "snapshot today") in addition to the monthly auto-snapshot.
- The historical chart on the dashboard renders the last 24 months by default, with the ability to extend to all history.

---

## 6. Non-functional requirements

### 6.1 Security and privacy

- All financial data encrypted at rest (AES-256 or equivalent at the database layer).
- All data encrypted in transit (TLS 1.3).
- Authentication: passwordless via passkey / WebAuthn as primary, with email magic link fallback. Optional biometric unlock on iOS (Face ID / Touch ID via WebAuthn).
- Account numbers never stored in full — only last 4 digits, extracted then redacted before persistence.
- Original documents stored in private object storage (e.g. S3 with bucket policy and server-side encryption), accessible only via short-lived signed URLs.
- User can export all data and delete their account at any time. Deletion is hard delete with a 30-day grace window.
- No third-party analytics or trackers in the v1 build. Application logs scrubbed of financial values.

### 6.2 Performance

- Dashboard load < 1.5 seconds on a warm cache.
- Document extraction round-trip target: median 4 seconds, p95 under 10 seconds.
- Currency toggle should be instant (client-side conversion using cached rates).
- App must function fully offline for read; write actions (uploads) queue and sync on reconnect.

### 6.3 Cross-platform and PWA

- Built as a progressive web app, installable to iOS home screen with proper splash screen and icon.
- Camera capture via the standard HTML capture attribute or `getUserMedia`, with file picker fallback.
- Responsive layout: single-column on phone, two-column dashboard on tablet and desktop.
- No iOS or Android native app in v1.

---

## 7. Technical architecture (proposed)

Stack proposal is opinionated but interchangeable; the goal is to keep the surface small and the build fast for a single-developer project.

| Layer | Proposal | Rationale |
|---|---|---|
| **Frontend** | Next.js (App Router) + React + TypeScript, Tailwind for styling, installable as a PWA. | Familiar, fast to build |
| **Backend** | Next.js API routes for thin endpoints; heavier work in serverless functions (Vercel or Cloudflare Workers). | No separate server |
| **Database** | Supabase (Postgres) with row-level security policies bound to the authenticated user. | Already in your stack |
| **File storage** | Supabase Storage or S3-compatible bucket with private access. | Encrypted at rest |
| **Document extraction** | Calls routed through **OpenRouter** as the single LLM gateway. Model selection per prompt is managed in the admin backend (§14). Default primary for extraction is a vision-capable Claude model with two configured fallbacks. Optional fallback to a deterministic OCR pass (Tesseract) for cost control on simple cases. | Lets us swap models without code changes |
| **Auth** | Supabase Auth with passkey / WebAuthn primary. | Passwordless |
| **FX rates** | Daily cron pulling from exchangerate.host or ECB, stored in a `fx_rates` table. | Free, reliable |
| **LLM gateway** | OpenRouter as the only outbound LLM provider. API key stored in the admin backend (§14.1) and never exposed to the frontend. All prompts, model bindings, and fallback chains are managed via the admin pages and pulled at runtime by a thin `llm.call(promptSlug, vars)` service. | Single chokepoint for keys, logging, and cost control |

---

## 8. Data model (entities)

The model is **household-ready from day one**: every user-owned entity is scoped to a Household rather than a User, even though the v1 UI surfaces only the primary user. This lets a future release add a spouse or co-owner without a data migration.

| Entity | Key fields |
|---|---|
| **Household** | `id`, `name`, `default_currency`, `created_at`, `settings` |
| **User** | `id`, `household_id`, `email`, `role` (owner \| member \| viewer), `is_system_admin` (boolean — controls access to the admin backend §14, separate from household role), `created_at` |
| **Institution** | `id`, `household_id`, `name`, `country`, `type` (bank \| brokerage \| mortgage_lender \| utility \| other) |
| **Asset** | `id`, `household_id`, `name`, `category` (real_estate \| investment \| cash \| liability), `institution_id`, `account_last4`, `native_currency`, `archived`, `created_at` |
| **BalanceEntry** | `id`, `asset_id`, `amount` (native currency), `as_of_date`, `source` (document \| manual), `source_document_id` (nullable), `confidence`, `manually_edited`, `created_at` |
| **Property** | `id`, `asset_id` (1:1), `address`, `country`, `purchase_date`, `purchase_price`, `sale_cost_overrides` (jsonb) |
| **PropertyValuation** | `id`, `property_id`, `estimated_value`, `as_of_date`, `note` |
| **RecurringOutgoing** | `id`, `household_id`, `name`, `category`, `amount` (native currency), `cadence` (monthly \| quarterly \| annual), `next_due_date`, `institution_id` (nullable), `archived` |
| **OutgoingPayment** | `id`, `recurring_outgoing_id`, `amount`, `paid_on`, `source_document_id` (nullable) |
| **Document** | `id`, `household_id`, `storage_path`, `mime_type`, `uploaded_at`, `extracted_json`, `status` |
| **NetWorthSnapshot** | `id`, `household_id`, `snapshot_date`, `totals_by_category` (jsonb), `totals_by_currency` (jsonb), `fx_rates_used` (jsonb), `trigger` (auto_monthly \| manual) |
| **FxRate** | `date`, `base_currency`, `target_currency`, `rate` |

### Admin / LLM-infra entities (admin-only, see §14)

These are global (not household-scoped) and only readable / writable by users with `is_system_admin = true`.

| Entity | Key fields |
|---|---|
| **SystemSecret** | `id`, `key` (e.g. `OPENROUTER_API_KEY`), `value_encrypted`, `description`, `updated_by`, `updated_at`. Encrypted at rest with a separate KMS key from the user-data encryption. Values never returned to the client in full — only masked (`sk-or-…abcd`). |
| **Prompt** | `id`, `slug` (stable identifier used in code, e.g. `extract_statement`), `name` (human label), `description`, `purpose` (extraction \| classification \| summary \| other), `current_version_id`, `created_at`, `updated_at` |
| **PromptVersion** | `id`, `prompt_id`, `version_number`, `body` (the full prompt text with `{{variable}}` placeholders), `available_slugs` (jsonb array of slug names the prompt accepts), `notes`, `created_by`, `created_at`. Old versions are retained — editing creates a new version, never overwrites. |
| **PromptBinding** | `id`, `prompt_id` (1:1), `primary_model_slug` (OpenRouter model id, e.g. `anthropic/claude-opus-4`), `fallback_1_model_slug` (nullable), `fallback_2_model_slug` (nullable), `temperature`, `max_tokens`, `response_format` (text \| json), `json_schema` (jsonb, nullable), `updated_at` |
| **OpenRouterModel** | Cache table refreshed daily from OpenRouter's `/models` endpoint. `slug` (e.g. `anthropic/claude-opus-4`), `name`, `provider`, `context_length`, `input_cost_per_mtoken`, `output_cost_per_mtoken`, `supports_vision` (boolean), `supports_tools` (boolean), `supports_json_mode` (boolean), `is_coding_specialist` (boolean — heuristic from name + provider tags), `is_reasoning_specialist` (boolean), `is_available` (boolean), `last_synced_at` |
| **LLMCallLog** | `id`, `prompt_slug`, `model_used`, `was_fallback` (0 = primary, 1 = first fallback, 2 = second fallback), `latency_ms`, `input_tokens`, `output_tokens`, `cost_usd`, `success`, `error_message` (nullable), `created_at`. Used for admin observability and cost tracking. |

---

## 9. UI / UX principles

- **One-tap-to-capture** from the home screen. The camera or upload action is the largest control on mobile.
- **Confirmation, not configuration.** The AI proposes, the user confirms with one tap. Power users can edit details, but the default path is fast.
- **Calm, dense, monochrome** with a single accent colour. Financial data deserves restraint — no animations, no celebratory confetti, no progress meters that mean nothing.
- **Numbers are the hero.** Large, tabular figures for balances. Right-aligned in lists. Currency symbol shown but de-emphasised.
- **Staleness is visible.** An asset that hasn't been updated in a while should make itself known without alarmism.
- **Privacy mode:** a single tap blurs all balances for over-shoulder situations.

---

## 10. Out of scope for v1 — future considerations

- Open-banking and brokerage API integrations (Plaid, TrueLayer) for automatic balance refresh.
- Multi-user household UI. The data model is household-ready (see §8), but the v1 UI surfaces only the primary user. A future release adds member invitations and role-based access (owner / member / viewer).
- Tax-lot tracking and capital gains modelling for investments.
- Liability payoff modelling and scenario planning (e.g. "what if I overpay £1k/month on the mortgage").
- Apple Pay / Google Pay integration for paid tier or premium AI extraction tier.
- Native iOS app with deeper camera and widget integration.

---

## 11. Risks and resolved decisions

### Risks

- **Extraction accuracy on unfamiliar statement formats.** Mitigation: confidence scores, mandatory user confirmation, and a feedback loop where corrections improve a per-user mapping table.
- **Cost per extraction.** Vision LLM calls add up. Mitigation: cache extractions per document hash, route simple cases through cheaper OCR, and consider a monthly cap with graceful degradation.
- **Cross-jurisdiction tax assumptions in the sale scenario.** Mitigation: clearly label all tax estimates as illustrative, not advice. No CGT calculation should default-on; user must enable per property.
- **Storing sensitive financial documents is a high-value target.** Mitigation: strong encryption, short signed-URL TTLs, audit logging, and a clear data deletion path.

### Decisions resolved

| Question | Decision |
|---|---|
| Should v1 support manual entry, or force document-driven capture? | Manual entry is supported as a first-class flow alongside document capture. Manual balances are flagged as such in history. |
| Should the LLM extraction be shown to the user, or just trusted? | Always shown. The extraction review screen (§5.2.1) displays every extracted field with confidence indicators alongside the source document thumbnail. Nothing saves until the user confirms. |
| Where do recurring outgoings sit — netted into net worth, or separate? | Separate cash-flow view (§5.8). Recurring outgoings are a flow, not a stock, and do not affect the net worth headline. |
| Cadence for the historical net worth chart? | Monthly snapshots (§5.9), computed on the last day of each calendar month using the latest balance for each asset on or before that date. |
| Single-user only, or household-ready data model from day one? | Household-ready. All entities are scoped to a Household. The v1 UI remains single-user; multi-user invitations are a v2 feature with no schema migration required. |

---

## 12. Success metrics

- **Time from app open to balance captured:** median under 15 seconds.
- **Extraction accuracy:** > 95% on the user's recurring statement formats after 5 captures.
- **Coverage:** 100% of the user's material assets and liabilities (> £/$/CAD 10k) tracked within 30 days of starting to use the app.
- **Freshness:** 80% of tracked assets updated within the last 90 days at any given time.
- **User-perceived trust:** the user is willing to quote their net worth from the app without cross-checking another source.

---

## 13. Suggested build sequence

1. **Auth + empty dashboard.** Single screen, signed-in shell, deploy. Include the `is_system_admin` flag on the User table from day one.
2. **Manual asset creation and balance entry**, with category and currency. Dashboard totals working without FX.
3. **FX rate fetch + multi-currency display.** Currency toggle live.
4. **Document upload (no AI yet).** Linkage between balance entry and source document.
5. **Admin backend foundation (§14):** Settings page with encrypted `SystemSecret` storage, OpenRouter API key stored, model catalogue sync from `/models` endpoint, basic `llm.call(promptSlug, vars)` service routing through OpenRouter with primary + 2 fallback chain.
6. **Admin Prompts page (§14.2):** prompt list, prompt editor with slug awareness, model picker with cost / context / capability indicators, primary + 2 fallback binding per prompt.
7. **AI extraction.** Pipe the first real prompt (`extract_statement`) through the `llm.call` service into the upload flow with structured output. User must still confirm.
8. **Classification:** new vs update proposal logic, also via a named prompt through the same gateway.
9. **Real estate special path:** market value editor, mortgage linkage, sale scenario.
10. **PWA install**, iOS camera capture polish, offline cache.
11. **Privacy mode, staleness indicators, alerts.**
12. **Historical net worth chart.**

---

## 14. Admin backend (LLM infrastructure)

All LLM interactions in Numara route through **OpenRouter** rather than calling provider SDKs directly. This makes models hot-swappable, lets us run a primary-plus-fallback chain for reliability, and keeps a single chokepoint for API keys, logging, and cost control. The admin backend exists to manage this infrastructure without touching application code or redeploying.

### 14.1 Access and visibility

- The admin backend is mounted at `/admin` and is **only accessible to users with `is_system_admin = true`**. Anyone else hitting the route gets a 404, not a 403 — we don't advertise its existence.
- Regular users (the primary application audience) never see admin links, navigation, or any reference to OpenRouter, model names, prompts, or fallbacks. The model that processed their statement is an implementation detail.
- The flag is set by direct database write or via a seed script. There is no UI to grant admin to another user in v1.
- All admin pages enforce the flag in middleware on every request, not just on initial route load.

### 14.2 Page structure (two pages)

The admin backend consists of two pages. The originally-considered "models" page is folded into the prompt detail view, since model selection is always done in the context of a specific prompt.

| Page | Path | Purpose |
|---|---|---|
| **Settings** | `/admin/settings` | API keys, defaults, model catalogue sync status, recent call logs. |
| **Prompts** | `/admin/prompts` | List view of all prompts with their slugs. Click into a prompt to edit its body and bind it to a primary + 2 fallback OpenRouter models. |

### 14.3 Settings page (`/admin/settings`)

A single page covering global LLM-infrastructure settings.

- **API keys.** OpenRouter API key entry (write-only — once saved, the UI shows a masked version like `sk-or-…abcd`, never the raw value). Future keys (e.g. for direct provider access, OCR fallback, FX provider) live in the same section. All values stored as `SystemSecret` records, encrypted at rest, decrypted only inside the server-side `llm.call` service.
- **Defaults.** A global default primary model and two global default fallbacks. New prompts inherit these unless overridden in their binding. Useful for fast bootstrap.
- **Model catalogue.** Status of the OpenRouter `/models` sync — last refresh time, number of models cached, manual "Refresh now" button. The catalogue auto-refreshes once a day via cron.
- **Cost dashboard.** Aggregated `LLMCallLog` data: total spend last 7 days, top 10 prompts by spend, fallback rate (how often the primary model failed and a fallback was used). This is observability, not control — it's how the admin notices a misbehaving prompt or an unreliable model.
- **Recent calls.** A table of the last 50 LLM calls: prompt slug, model used, whether it was primary / fallback 1 / fallback 2, latency, token counts, cost, success / failure. Failed calls show the error inline.

### 14.4 Prompts page (`/admin/prompts`)

The list view and detail view of the prompts that power the app.

#### 14.4.1 List view

A table of every prompt registered in the app. Columns:

- **Slug** — the stable code identifier (e.g. `extract_statement`, `classify_new_vs_update`, `summarise_property_valuation`). This is what code calls: `llm.call('extract_statement', { document_image, known_institutions })`.
- **Name** — human label.
- **Purpose** — extraction / classification / summary / other.
- **Available slugs** — chips showing the `{{variable}}` placeholders this prompt accepts, e.g. `{{document_image}}`, `{{known_institutions}}`, `{{user_currency}}`.
- **Bound primary model** — what is currently configured.
- **Fallbacks** — count (0 / 1 / 2) and which models, on hover.
- **Last edited** — timestamp + admin who made the change.
- **Status** — active / disabled.

A "New prompt" button creates a blank prompt with a slug, name, purpose. Slugs are immutable once a prompt is referenced in code.

#### 14.4.2 Detail / edit view

Two panels side by side: prompt editor on the left, model binding on the right.

**Left panel — prompt editor:**

- **Slug** — read-only after creation.
- **Name, description, purpose** — editable.
- **Available slugs** — managed list. Adding a new slug here makes `{{slug_name}}` a recognised placeholder. The editor highlights any `{{...}}` in the body that isn't in the declared list (typo guard).
- **Body** — the full prompt text. Monospaced editor with syntax highlighting for `{{slug}}` placeholders. Saving creates a new `PromptVersion`; the old version is retained and viewable from a "Version history" tab.
- **Test panel** — a small form where the admin can fill in values for each slug and run the prompt against the bound primary model to see the output without leaving the page. Round-trip cost is shown.

**Right panel — model binding:**

- **Primary model** — searchable dropdown of every model in the `OpenRouterModel` cache.
- **Fallback 1 model** — same picker, nullable.
- **Fallback 2 model** — same picker, nullable.
- **Temperature, max tokens, response format** (text / JSON).
- **JSON schema** (optional, used when response format is JSON).
- **Save** writes a new `PromptBinding` revision.

### 14.5 Model picker (the searchable dropdown)

This is the workhorse component, reused for primary + both fallback slots. Requirements:

- **Includes every model OpenRouter exposes** via `/models`. The cache table (`OpenRouterModel`) is the source of truth; the picker queries it, not OpenRouter directly.
- **Search by name, provider, or capability.** Typing "claude" filters to Anthropic models; typing "coding" filters to coding specialists; typing "vision" filters to vision-capable.
- **Capability indicators (icons / badges) on each row:**
  - 🅥 vision-capable
  - 🅒 coding specialist (by name heuristic + provider tag)
  - 🅡 reasoning / thinking model
  - 🅣 supports tools / function calling
  - 🅙 supports JSON / structured outputs
- **Cost shown per row:** input and output cost per million tokens, e.g. `$15 / $75 per MTok`.
- **Context window shown per row:** e.g. `200k ctx` or `1M ctx`.
- **Provider grouping** (optional, toggleable): collapse rows under Anthropic / OpenAI / Google / Mistral / Qwen / DeepSeek / others.
- **Sortable** by cost (input or output), context length, name.
- **Unavailable models** (where `is_available = false` from the last sync) are shown but dimmed and not selectable.
- The picker should be fast — virtualised list — given OpenRouter exposes hundreds of models.

### 14.6 Runtime call flow (primary + 2 fallbacks)

The `llm.call(promptSlug, vars, opts?)` service is the only path from app code to an LLM. Internally:

1. Look up the `Prompt` by slug → load its `current_version_id` body, substitute `{{vars}}`.
2. Load the `PromptBinding` → get primary, fallback 1, fallback 2 model slugs, plus generation params.
3. Send the request to OpenRouter using the primary model.
4. **Treat as failure** and try the next model if: OpenRouter returns a 5xx, the request times out (configurable, default 30s), the response is empty, the response fails JSON schema validation when one is configured, or the model returns an explicit error (rate limit, content filter, model offline).
5. Try fallback 1. If that also fails, try fallback 2. If all three fail, raise to the caller with the chain of errors.
6. Log every attempt as an `LLMCallLog` row, including whether it was primary or which fallback was used. This is what powers the cost dashboard and the "fallback rate" metric on the Settings page.

### 14.7 Initial prompts (suggested seed)

The app should ship with these prompts pre-registered so the admin has something to edit on day one. Each one's binding is set to the global defaults until the admin tunes it.

| Slug | Purpose | Slugs (placeholders) |
|---|---|---|
| `extract_statement` | Read a financial document and return structured fields. | `{{document_image_or_text}}`, `{{known_institutions}}`, `{{user_default_currency}}` |
| `classify_new_vs_update` | Decide whether an extracted statement matches an existing asset. | `{{extracted}}`, `{{candidate_assets}}` |
| `normalise_institution_name` | Map a raw institution name to a canonical one. | `{{raw_name}}`, `{{known_institutions}}` |
| `summarise_property_valuation` | Generate a one-line summary of a property valuation report. | `{{document_text}}` |
| `suggest_outgoing_category` | Pick the most likely category for a recurring bill. | `{{vendor_name}}`, `{{amount}}`, `{{currency}}` |

### 14.8 Security notes specific to the admin backend

- The `SystemSecret` table uses a different encryption key from the user-data tables, so a compromise of one does not give access to the other.
- Admin actions (key updates, prompt edits, binding changes) are written to an `AdminAuditLog` (one line per change, with old + new values for non-secret fields, and "secret updated" for secrets without revealing the value).
- No admin page is server-side cacheable; every load goes through the middleware admin check.
- Test runs from the prompt editor's test panel use a separate rate limit so a runaway admin can't accidentally burn through OpenRouter credit.

---

*— End of document —*
