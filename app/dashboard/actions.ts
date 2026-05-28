"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CURRENCIES, type Currency } from "@/lib/types";
import { writeDisplayCurrencyCookie } from "@/lib/display-currency";
import { readPrivacyMode, writePrivacyMode } from "@/lib/privacy";
import { createClient } from "@/lib/supabase/server";
import { computeAndStoreSnapshot } from "@/lib/snapshots";

export async function setDisplayCurrency(formData: FormData) {
  const value = String(formData.get("currency") ?? "");
  if (!(CURRENCIES as readonly string[]).includes(value)) return;
  await writeDisplayCurrencyCookie(value as Currency);
  revalidatePath("/dashboard");
}

export async function togglePrivacyMode() {
  const current = await readPrivacyMode();
  await writePrivacyMode(!current);
  // Revalidate every route that renders money so the toggle takes
  // effect immediately rather than requiring a hard refresh.
  revalidatePath("/", "layout");
}

/**
 * Manually trigger a net-worth snapshot for today. Auto-monthly
 * (running on the last day of each calendar month) is wired up when
 * we deploy and have a cron available (Vercel Cron, pg_cron, or a
 * GitHub Action). Until then the user can call this on demand.
 */
export async function snapshotNow() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("household_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.household_id) return;

  await computeAndStoreSnapshot(profile.household_id, undefined, "manual");
  revalidatePath("/dashboard");
}
