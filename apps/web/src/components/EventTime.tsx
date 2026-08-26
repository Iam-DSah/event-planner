import { describeEventTime } from "../lib/datetime.js";

/**
 * One timestamp, presented the same way everywhere: the venue's wall clock,
 * plus the viewer's local reading when the two differ.
 *
 * A component rather than a string helper because the second half needs its
 * own element, and because the list and the detail page must not drift on how
 * they present the same fact.
 */
export default function EventTime({
  iso,
  timeZone,
}: {
  iso: string;
  timeZone: string;
}) {
  const { venue, viewer } = describeEventTime(iso, timeZone);

  return (
    <>
      {venue}
      {viewer && (
        <>
          {" · "}
          <span>{viewer} your time</span>
        </>
      )}
    </>
  );
}
