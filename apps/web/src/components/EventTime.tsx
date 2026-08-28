import { describeEventTime } from "../lib/datetime.js";

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
