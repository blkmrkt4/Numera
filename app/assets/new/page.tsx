import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CURRENCIES, CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/types";
import { createAsset } from "./actions";

export default async function NewAssetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await searchParams;

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
            ← Dashboard
          </Link>
          <h1 className="text-base font-medium tracking-tight">Add asset</h1>
          <span className="w-20" />
        </div>
      </header>

      <main className="mx-auto max-w-xl px-6 py-12">
        <form action={createAsset} className="space-y-5">
          <div>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              Name
              <input
                type="text"
                name="name"
                required
                maxLength={100}
                placeholder="e.g. HSBC current account"
                className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:focus:border-neutral-100"
              />
            </label>
          </div>

          <fieldset>
            <legend className="block text-sm text-neutral-600 dark:text-neutral-400">Category</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CATEGORY_ORDER.map((c, i) => (
                <label
                  key={c}
                  className="flex cursor-pointer items-center justify-center rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 has-[:checked]:border-neutral-900 has-[:checked]:bg-neutral-900 has-[:checked]:text-white dark:border-neutral-700 dark:text-neutral-300 dark:has-[:checked]:border-white dark:has-[:checked]:bg-white dark:has-[:checked]:text-neutral-900"
                >
                  <input
                    type="radio"
                    name="category"
                    value={c}
                    required
                    defaultChecked={i === 1}
                    className="sr-only"
                  />
                  {CATEGORY_LABELS[c]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="block text-sm text-neutral-600 dark:text-neutral-400">Currency</legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {CURRENCIES.map((c, i) => (
                <label
                  key={c}
                  className="flex cursor-pointer items-center justify-center rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 has-[:checked]:border-neutral-900 has-[:checked]:bg-neutral-900 has-[:checked]:text-white dark:border-neutral-700 dark:text-neutral-300 dark:has-[:checked]:border-white dark:has-[:checked]:bg-white dark:has-[:checked]:text-neutral-900"
                >
                  <input
                    type="radio"
                    name="currency"
                    value={c}
                    required
                    defaultChecked={i === 0}
                    className="sr-only"
                  />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              Institution <span className="text-neutral-400">(optional)</span>
              <input
                type="text"
                name="institution"
                maxLength={100}
                placeholder="e.g. HSBC UK"
                className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:focus:border-neutral-100"
              />
            </label>
          </div>

          <div>
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              Last 4 digits of account <span className="text-neutral-400">(optional)</span>
              <input
                type="text"
                name="account_last4"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                placeholder="1234"
                className="mt-1 block w-32 rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 tabular outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:focus:border-neutral-100"
              />
            </label>
            <p className="mt-1 text-xs text-neutral-500">
              Never the full account number — only the last 4.
            </p>
          </div>

          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
            >
              Create asset
            </button>
            <Link
              href="/dashboard"
              className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
