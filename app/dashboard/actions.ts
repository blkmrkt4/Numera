"use server";

import { revalidatePath } from "next/cache";
import { CURRENCIES, type Currency } from "@/lib/types";
import { writeDisplayCurrencyCookie } from "@/lib/display-currency";

export async function setDisplayCurrency(formData: FormData) {
  const value = String(formData.get("currency") ?? "");
  if (!(CURRENCIES as readonly string[]).includes(value)) return;
  await writeDisplayCurrencyCookie(value as Currency);
  revalidatePath("/dashboard");
}
