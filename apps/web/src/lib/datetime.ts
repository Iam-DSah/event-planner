export function formatInTimeZone(iso: string, timeZone: string): string {
  const instant = new Date(iso);

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(instant);
  } catch {
    return `${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(instant)} UTC`;
  }
}

function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";

  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);

  // Bare "GMT" — the zone is at +00:00 at this instant.
  if (!match?.[1] || !match[2]) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;

  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

export function wallTimeToInstant(wall: string, timeZone: string): string {
  // slice(16): datetime-local yields "YYYY-MM-DDTHH:mm", but with a `step`
  // attribute it can include seconds, which would break the concatenation.
  const pretendUtc = new Date(`${wall.slice(0, 16)}:00.000Z`);

  if (Number.isNaN(pretendUtc.getTime())) {
    throw new RangeError(`Not a datetime-local value: ${wall}`);
  }

  const firstGuess = new Date(
    pretendUtc.getTime() - zoneOffsetMinutes(pretendUtc, timeZone) * 60_000,
  );

  return new Date(
    pretendUtc.getTime() - zoneOffsetMinutes(firstGuess, timeZone) * 60_000,
  ).toISOString();
}

export function instantToWallTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function describeEventTime(
  iso: string,
  timeZone: string,
): { venue: string; viewer: string | null } {
  const venue = `${formatInTimeZone(iso, timeZone)} (${timeZone})`;
  const viewerZone = browserTimeZone();
  const viewer = formatInTimeZone(iso, viewerZone);

  return {
    venue,
    viewer: viewer === formatInTimeZone(iso, timeZone) ? null : viewer,
  };
}

/** The viewer's own zone — the only sensible default for a new event. */
export function browserTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function supportedTimeZones(include?: string): string[] {
  let zones: string[];

  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    // Pre-2022 browsers lack supportedValuesOf. Degrade to something usable
    // rather than rendering an empty <select>.
    zones = [browserTimeZone(), "UTC"];
  }

  const extras = ["UTC", include].filter(
    (zone): zone is string => Boolean(zone) && !zones.includes(zone as string),
  );

  return extras.length > 0 ? [...zones, ...extras].sort() : zones;
}
