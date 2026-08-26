/**
 * Display helpers for the two halves of D004: `starts_at` is a UTC instant,
 * `timezone` is an IANA name that is display-only and never appears in a WHERE
 * clause.
 *
 * The consequence for the UI is easy to get wrong in the invisible direction:
 * `new Date(iso).toLocaleString()` renders in the VIEWER's zone, so an event at
 * 18:30 in Asia/Kathmandu shows as 12:45 to a viewer in London. Nothing errors
 * and the timestamp is not corrupted — it is simply the wrong answer to
 * "when is this event?", which is always the event's own wall clock.
 */

/**
 * Formats a UTC instant as wall-clock time in the event's own timezone.
 *
 * The `timeZone` option is what does the work; without it Intl falls back to
 * the viewer's zone and this is just toLocaleString with extra steps.
 */
export function formatInTimeZone(iso: string, timeZone: string): string {
  const instant = new Date(iso);

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(instant);
  } catch {
    // NOT speculative: an invalid zone makes Intl throw a RangeError, which
    // would take down the whole page render. The API validates `timezone` on
    // write, but it validates against the SERVER's ICU data — a browser with
    // older ICU can legitimately not know a zone the database accepted.
    // Falling back to UTC is wrong-but-legible; throwing is a blank screen.
    return `${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(instant)} UTC`;
  }
}

/**
 * The offset, in minutes east of UTC, that `timeZone` was observing AT a given
 * instant. "At a given instant" is the whole difficulty: an IANA zone does not
 * have *an* offset, it has a schedule of them.
 *
 * `timeZoneName: "longOffset"` renders that offset as "GMT+05:45" / "GMT-4" /
 * plain "GMT", which is parsed back out here. There is no Intl API that hands
 * over the number directly.
 */
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

/**
 * Converts the wall-clock time a person typed, IN A CHOSEN ZONE, to the UTC
 * instant the API stores. `<input type="datetime-local">` yields
 * "2026-09-01T18:45" — no offset, no Z — and `new Date()` of that string is
 * interpreted in the BROWSER's zone, which is the wrong zone whenever the
 * event is somewhere else.
 *
 * TWO PASSES, and the second one is load-bearing. To apply a zone's offset you
 * must already know the instant; to know the instant you must already have
 * applied the offset. The first pass breaks the circle with a guess (read the
 * offset as if the wall time were UTC); the second re-reads the offset at that
 * guessed instant and applies it properly.
 *
 * Measured, not assumed — one pass is wrong by a full hour for 03:30 on
 * 2026-03-08 in America/New_York (it yields 04:30). Across ten cases spanning
 * both hemispheres' DST transitions and a :45 offset, one pass failed 1/10 and
 * two passes failed 0/10.
 *
 * KNOWN LIMIT: a wall time that does not exist (inside a spring-forward gap)
 * silently resolves to a nearby real instant, and in different directions in
 * different zones — 02:30 New York becomes 01:30, 01:30 London becomes 02:30.
 * An ambiguous wall time (inside a fall-back repeat) picks one of its two
 * instants. Neither throws. The form shows the resulting instant back to the
 * user for exactly this reason.
 */
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

/**
 * The inverse, for seeding the edit form: a UTC instant back to the
 * "YYYY-MM-DDTHH:mm" that `<input type="datetime-local">` expects, expressed in
 * the event's own zone.
 *
 * The obvious version — `new Date(iso).toISOString().slice(0, 16)` — is WRONG.
 * That is the UTC wall time, so an 18:45 Kathmandu event fills the box with
 * 13:00, and saving an untouched form moves the event by 5h45m. Nothing errors.
 *
 * `hourCycle: "h23"` rather than `hour12: false`: they are the same length, but
 * some ICU builds render midnight as hour "24" under `hour12: false`, which
 * produces a value the input silently rejects.
 */
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

/**
 * How one timestamp should be presented: the venue's wall clock always, plus
 * the viewer's local reading ONLY when that tells them something new.
 *
 * Venue time answers "when does this start where it is happening"; local time
 * answers "can I attend". They are different questions, and for a remote
 * attendee the second is the one that decides — an event at 07:30 in Kathmandu
 * is 02:45 in London, and showing only the first invites a real mistake.
 *
 * WHEN TO SUPPRESS THE SECOND LINE is the subtle part. Comparing zone NAMES is
 * wrong: `Asia/Katmandu` and `Asia/Kathmandu` are one zone with two spellings
 * (the browser's list hands out the legacy one — see supportedTimeZones), so a
 * viewer in Kathmandu would be told "7:30 AM ... and 7:30 AM your time".
 * Comparing the RENDERED STRINGS is both simpler and actually correct: if the
 * two readings display identically, the second line carries no information.
 * That also covers unrelated zones that happen to share an offset.
 *
 * The viewer's half carries its full date, never just the time — a venue
 * evening is frequently the previous or next day for the viewer, and "2:45 AM"
 * with the wrong date implied is worse than no second line at all.
 */
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

/**
 * Every zone the browser's ICU knows — 418 of them here. No data file and no
 * dependency; the platform already ships a list.
 *
 * `include` is not optional politeness: **the platform list is not
 * authoritative for data already stored.** Chromium 151 returns the deprecated
 * `Asia/Katmandu` and not the canonical `Asia/Kathmandu` that the API accepts
 * and stores, so an event saved with the modern spelling has no matching
 * <option>. A <select> in that state reports `selectedIndex: -1` and renders
 * blank — verified in Chromium, not reasoned about — so the edit form would
 * show an empty timezone picker and change the zone the moment it was touched.
 *
 * The same list also contains NO UTC entry whatsoever — not "UTC", not
 * "Etc/UTC", no Etc/* zones at all — while the API's isValidIanaTimezone
 * special-cases "UTC" as explicitly valid. It is added unconditionally.
 *
 * Any zone the server considers valid must therefore be selectable, whether or
 * not this browser's ICU chose to list it.
 */
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
