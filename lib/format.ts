import type { Currency } from "./types";

const FORMATTERS: Record<Currency, Intl.NumberFormat> = {
  GBP: new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    currencyDisplay: "symbol",
  }),
  USD: new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
  }),
  CAD: new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "CAD",
    currencyDisplay: "symbol",
  }),
};

// USD with narrowSymbol gives "$1,234.56"; CAD with default symbol gives "CA$1,234.56".
// GBP gives "£1,234.56".

export function formatMoney(
  amount: number | string,
  currency: Currency,
  masked: boolean = false
): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  if (masked) {
    // Preserve the currency symbol so the layout doesn't reflow when the
    // user toggles privacy mode mid-session; only digits get hidden.
    const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : "CA$";
    return `${symbol}••••••`;
  }
  return FORMATTERS[currency].format(n);
}

export const STALE_DAYS = 90;

export function daysSince(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return Number.POSITIVE_INFINITY;
  const then = new Date(y, m - 1, d);
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}

export function isStale(iso: string | null | undefined, threshold = STALE_DAYS): boolean {
  if (!iso) return true;
  return daysSince(iso) > threshold;
}

export function formatDate(iso: string): string {
  // dates are stored as YYYY-MM-DD; treat as local to avoid TZ drift.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function relativeAge(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date();
  const days = Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

export function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
