import "server-only";
import { cookies } from "next/headers";

const COOKIE_NAME = "privacy_mode";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function readPrivacyMode(): Promise<boolean> {
  const c = await cookies();
  return c.get(COOKIE_NAME)?.value === "1";
}

export async function writePrivacyMode(on: boolean): Promise<void> {
  const c = await cookies();
  if (on) {
    c.set(COOKIE_NAME, "1", {
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
      sameSite: "lax",
    });
  } else {
    c.delete(COOKIE_NAME);
  }
}
