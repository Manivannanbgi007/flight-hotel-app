/** "Good morning" before 12, "Good afternoon" before 17, then "Good evening" (the visitor's own clock). */
export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
