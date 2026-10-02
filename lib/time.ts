/** Start and end of the calendar day containing `now` in the given time zone. */
export function dayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  let parts: Record<string, number>;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      })
        .formatToParts(now)
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, Number(p.value)]),
    );
  } catch {
    return dayBounds(now, "UTC");
  }
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offset = wallClockAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const start = Date.UTC(parts.year, parts.month - 1, parts.day) - offset;
  return { start: new Date(start), end: new Date(start + 86_400_000) };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
