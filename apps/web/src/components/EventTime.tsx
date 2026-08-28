import { describeEventTime, describeEventTimeParts } from "../lib/datetime.js";

export default function EventTime({
  iso,
  timeZone,
  variant = "inline",
}: {
  iso: string;
  timeZone: string;
  variant?: "inline" | "stacked";
}) {
  if (variant === "stacked") {
    const { date, time, offset, viewer } = describeEventTimeParts(
      iso,
      timeZone,
    );

    return (
      <div>
        <div className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
          {date}
        </div>

        <div className="tnum mt-0.5 text-2xl leading-none text-ink">{time}</div>

        <div className="tnum mt-1.5 text-xs text-ink-muted">{offset}</div>

        {viewer && (
          <div className="tnum mt-1 text-xs font-medium text-accent">
            {viewer} your time
          </div>
        )}
      </div>
    );
  }

  const { venue, viewer } = describeEventTime(iso, timeZone);

  return (
    <>
      <span className="tnum">{venue}</span>

      {viewer && (
        <span className="tnum text-ink-muted">
          {" · "}
          {viewer} your time
        </span>
      )}
    </>
  );
}
