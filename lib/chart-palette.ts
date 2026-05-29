// Numara brand palette (PRD §9.1). The application UI stays monochrome —
// a single accent on a black/charcoal/white ground — but DATA VISUALISATIONS
// are deliberately colourful and graphic, drawing from these electric accents.
// This module is the single source of truth for chart colour; never inline
// hex values in a chart component.

export const BRAND = {
  black: "#0A0A0A", // primary background
  charcoal: "#0F0F0F", // section background
  white: "#F0F0F0", // primary text on dark
  electricYellow: "#F4EE35", // brand mark · primary accent
  hotCoral: "#FF5F3A",
  cedarSage: "#6BBF8A",
  electricIce: "#3AAFFF",
  reserveGold: "#C4952A",
} as const;

// Ordered series palette for categorical dimensions (country, currency, …).
// The five brand accents come first; the trailing three extend the cycle for
// breakdowns with many groups without falling back to greys.
export const CHART_SERIES: string[] = [
  BRAND.electricIce,
  BRAND.electricYellow,
  BRAND.hotCoral,
  BRAND.cedarSage,
  BRAND.reserveGold,
  "#A78BFA", // electric violet
  "#2DD4BF", // electric teal
  "#F472B6", // electric pink
];

// Fixed mapping for the asset-class dimension so a category always reads the
// same colour: cash = yellow, investments = ice, property = sage, debt = coral.
export const CATEGORY_CHART_COLORS: Record<string, string> = {
  cash: BRAND.electricYellow,
  investment: BRAND.electricIce,
  real_estate: BRAND.cedarSage,
  liability: BRAND.hotCoral,
};

export function colorForSeries(
  dimension: string,
  key: string,
  idx: number
): string {
  if (dimension === "category" && CATEGORY_CHART_COLORS[key]) {
    return CATEGORY_CHART_COLORS[key];
  }
  return CHART_SERIES[idx % CHART_SERIES.length];
}
