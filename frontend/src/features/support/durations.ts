const decimal = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

/**
 * A wall-clock duration in minutes as words: "Under 1 min", "45 min", "3 h 20 min", "2.5 days"; "–" when there is no
 * figure (no answered ticket in the range).
 */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return '–';
  if (minutes < 1) return 'Under 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes - hours * 60);
    return rest === 0 || rest === 60 ? `${rest === 60 ? hours + 1 : hours} h` : `${hours} h ${rest} min`;
  }
  return `${decimal.format(minutes / (24 * 60))} days`;
}

/** The same for a figure in hours (resolution time, ticket age). */
export function formatHours(hours: number | null | undefined): string {
  return hours === null || hours === undefined ? '–' : formatMinutes(hours * 60);
}
