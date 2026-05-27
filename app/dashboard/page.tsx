import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

const CATEGORIES = [
  { key: "real_estate", label: "Real estate" },
  { key: "investments", label: "Investments" },
  { key: "cash", label: "Cash" },
  { key: "liabilities", label: "Liabilities" },
] as const;

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("email, household_id, is_system_admin")
    .eq("id", user.id)
    .maybeSingle();

  const { data: household } = profile?.household_id
    ? await supabase
        .from("households")
        .select("name, default_currency")
        .eq("id", profile.household_id)
        .maybeSingle()
    : { data: null };

  const currency = household?.default_currency ?? "GBP";
  const symbol = currency === "USD" ? "$" : currency === "CAD" ? "CA$" : "£";

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-base font-medium tracking-tight">Numara</h1>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-neutral-500">{profile?.email ?? user.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <section>
          <p className="text-sm text-neutral-500">Total net worth</p>
          <p className="mt-2 text-5xl font-medium tracking-tight tabular">
            <span className="text-neutral-400">{symbol}</span>
            <span>0.00</span>
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            No assets yet. Add your first to start tracking.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Categories
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-neutral-200 bg-neutral-200 sm:grid-cols-2 lg:grid-cols-4 dark:border-neutral-800 dark:bg-neutral-800">
            {CATEGORIES.map((c) => (
              <div
                key={c.key}
                className="bg-white p-4 dark:bg-neutral-950"
              >
                <p className="text-xs text-neutral-500">{c.label}</p>
                <p className="mt-1 text-xl font-medium tabular">
                  <span className="text-neutral-400">{symbol}</span>0.00
                </p>
              </div>
            ))}
          </div>
        </section>

        {profile?.is_system_admin ? (
          <p className="mt-12 text-xs text-neutral-400">
            Admin tools are not yet available.
          </p>
        ) : null}
      </main>
    </div>
  );
}
