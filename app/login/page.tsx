import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sendMagicLink } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const sent = params.sent === "1";

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-medium tracking-tight">Numara</h1>
        <p className="mt-1 text-sm text-neutral-500">Sign in to continue.</p>

        {sent ? (
          <div className="mt-8 rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
            We have sent you a sign-in link. Open the email on this device and
            tap the link to continue.
          </div>
        ) : (
          <form action={sendMagicLink} className="mt-8 space-y-3">
            <label className="block text-sm text-neutral-600 dark:text-neutral-400">
              Email
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                inputMode="email"
                className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:focus:border-neutral-100"
              />
            </label>
            {params.next ? (
              <input type="hidden" name="next" value={params.next} />
            ) : null}
            <button
              type="submit"
              className="block w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
            >
              Send sign-in link
            </button>
            {params.error ? (
              <p className="text-sm text-red-600 dark:text-red-400">
                {params.error}
              </p>
            ) : null}
          </form>
        )}
      </div>
    </main>
  );
}
