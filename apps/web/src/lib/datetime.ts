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
