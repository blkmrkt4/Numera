# Numara

Personal net worth tracker built around document capture. See `PRD.md` for the
full specification and `CLAUDE.md` for build conventions.

**Stack:** Next.js (App Router) + React + TypeScript · Tailwind · Supabase
(Postgres + Auth + Storage) · OpenRouter for all LLM calls · installable PWA.

---

## Running on a new machine

`git pull` brings the code but **not** your secrets — `.env.local` is gitignored
and travels with nothing. To bring Numara up on a fresh checkout:

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env.local` from the template:
   ```bash
   cp .env.example .env.local
   ```
3. Fill in the four values (see below), then:
   ```bash
   npm run dev
   ```

### Environment variables

| Variable | Where to get it | Recoverable? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API | ✅ any time |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page | ✅ any time |
| `SUPABASE_SERVICE_ROLE_KEY` | same page → `service_role` key | ✅ any time |
| `SECRET_ENCRYPTION_KEY` | **`.env.local` only — copy the existing value across** | ❌ not stored anywhere else |

The three Supabase values are always retrievable from the dashboard, so a new
machine just needs them re-pasted. Make sure every machine points at the **same**
Supabase project.

`SECRET_ENCRYPTION_KEY` is the one that matters: it is the AES-256 key that
encrypts `public.system_secrets` (where the OpenRouter API key lives), kept
separate from Supabase by design (PRD §8). It exists **only** in `.env.local`.

- **Carry the existing value** to any new machine via a password manager or
  encrypted transfer — not git, chat, or email.
- If you lose it, nothing is permanently bricked: generate a new one
  (`openssl rand -hex 32`) and re-enter the OpenRouter key in `/admin/settings`.
  The old ciphertext in `system_secrets` becomes unreadable until you do.

## Scripts

```bash
npm run dev        # local dev server (Turbopack)
npm run build      # production build
npm run start      # serve production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```
