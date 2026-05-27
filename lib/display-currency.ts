import "server-only";
import { cookies } from "next/headers";
import { CURRENCIES, type Currency } from "@/lib/types";

const COOKIE_NAME = "display_currency";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function isCurrency(v: unknown): v is Currency {
  return typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);
}

export async function readDisplayCurrencyCookie(): Promise<Currency | null> {
  const c = await cookies();
  const v = c.get(COOKIE_NAME)?.value;
  return isCurrency(v) ? v : null;
}

export async function writeDisplayCurrencyCookie(currency: Currency): Promise<void> {
  const c = await cookies();
  c.set(COOKIE_NAME, currency, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
    // Not httpOnly — it's a UI preference, not a credential.
  });
}
