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

function viewerReadingDiffers(iso: string, timeZone: string): boolean {
  return (
    formatInTimeZone(iso, browserTimeZone()) !== formatInTimeZone(iso, timeZone)
  );
}

export function describeEventTime(
  iso: string,
  timeZone: string,
): { venue: string; viewer: string | null } {
  return {
    venue: `${formatInTimeZone(iso, timeZone)} (${timeZone})`,
    viewer: viewerReadingDiffers(iso, timeZone)
      ? formatInTimeZone(iso, browserTimeZone())
      : null,
  };
}

function part(
  iso: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  type?: Intl.DateTimeFormatPartTypes,
): string {
  const instant = new Date(iso);

  const render = (zone: string): string => {
    const formatter = new Intl.DateTimeFormat(undefined, {
      ...options,
      timeZone: zone,
    });

    if (!type) {
      return formatter.format(instant);
    }

    return (
      formatter.formatToParts(instant).find((piece) => piece.type === type)
        ?.value ?? ""
    );
  };

  try {
    return render(timeZone);
  } catch {
    return render("UTC");
  }
}

export interface EventTimeParts {
  date: string;
  time: string;
  offset: string;
  viewer: string | null;
}

export function describeEventTimeParts(
  iso: string,
  timeZone: string,
): EventTimeParts {
  return {
    date: part(iso, timeZone, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }),

    time: part(iso, timeZone, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),

    offset: part(
      iso,
      timeZone,
      { timeZoneName: "shortOffset" },
      "timeZoneName",
    ),

    viewer: viewerReadingDiffers(iso, timeZone)
      ? part(iso, browserTimeZone(), {
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })
      : null,
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
