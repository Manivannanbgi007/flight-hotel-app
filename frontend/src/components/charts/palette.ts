/**
 * Chart colours (DESIGN_SYSTEM.md "Chart kit"). The categorical order is validated for colour-blind separation on a
 * white surface (adjacent pairs ΔE ≥ 8, OKLab); a series keeps its slot (never re-coloured when another series is
 * filtered out). Up to 4 series on one chart; fold more into "Other". Status colours are not series colours.
 */
export const CHART_SERIES_COLORS = [
  '#2a78d6', // blue
  '#eb6834', // orange (sunset)
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#6250d6', // violet
  '#e34948', // red
] as const;

/** Chart furniture: one step off the surface, hairline, solid. */
export const CHART_GRID = '#e2e8f0';
export const CHART_AXIS_TEXT = '#64748b';
export const CHART_CURSOR = '#94a3b8';

/** The colour of series number `index` (or the one the series asks for). */
export function seriesColor(index: number, own?: string): string {
  return own ?? CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length] ?? CHART_SERIES_COLORS[0];
}
