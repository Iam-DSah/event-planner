import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  createEventSchema,
  type CreateEventInput,
} from "@event-planner/shared";

import { ApiError, type Event } from "../api/client.js";
import {
  browserTimeZone,
  formatInTimeZone,
  instantToWallTime,
  supportedTimeZones,
  wallTimeToInstant,
} from "../lib/datetime.js";

interface EventFormProps {
  /** Absent for create, present for edit. Seeds every field. */
  event?: Event;
  submitLabel: string;
  onSubmit: (input: CreateEventInput) => Promise<void>;
  cancelTo: string;
}

/**
 * One form for create and edit. Not a speculative abstraction — there are two
 * concrete callers today, and the ~100 lines they share are the datetime
 * conversion and the error mapping, which are exactly the parts that must not
 * drift between them.
 *
 * Both modes build the SAME full payload and validate it with
 * `createEventSchema`. The edit path could have used `updateEventSchema`, but
 * that schema is `.partial()` and accepts the complete object anyway (verified),
 * so branching on two schemas would buy a second code path and no correctness.
 */
export default function EventForm({
  event,
  submitLabel,
  onSubmit,
  cancelTo,
}: EventFormProps) {
  const initialTimeZone = event?.timezone ?? browserTimeZone();

  // Built with the event's own zone folded in — see supportedTimeZones. The
  // platform list omits spellings the API stores.
  const timeZones = useMemo(
    () => supportedTimeZones(initialTimeZone),
    [initialTimeZone],
  );

  const [form, setForm] = useState({
    title: event?.title ?? "",
    description: event?.description ?? "",
    // instantToWallTime, NOT toISOString().slice(0,16). The latter fills the
    // box with the UTC wall time, so an untouched edit form silently moves the
    // event by the zone's offset.
    startsAt: event ? instantToWallTime(event.startsAt, initialTimeZone) : "",
    endsAt: event?.endsAt
      ? instantToWallTime(event.endsAt, initialTimeZone)
      : "",
    location: event?.location ?? "",
    visibility: event?.visibility ?? "public",
    timezone: initialTimeZone,
    tags: event?.tags.join(", ") ?? "",
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  /**
   * The live confirmation of what will actually be saved.
   *
   * This is the mitigation for the one case the conversion cannot get right:
   * a wall time inside a spring-forward gap does not exist, and resolves to a
   * nearby real instant instead. Rather than warn about a case most users will
   * never hit, the form always shows the instant it is about to store, read
   * back in the chosen zone. In the normal case it reassures; in the gap case
   * the user sees the time change and can react.
   */
  let preview: string | null = null;

  if (form.startsAt) {
    try {
      const instant = wallTimeToInstant(form.startsAt, form.timezone);
      preview = `${formatInTimeZone(instant, form.timezone)} (${form.timezone})`;
    } catch {
      preview = null;
    }
  }

  function buildInput(): unknown {
    return {
      title: form.title,
      // "" is fine — the schema's transform maps it to null. Verified, despite
      // a note claiming .partial() suppresses that transform on update: it
      // does not.
      description: form.description,
      startsAt: form.startsAt
        ? wallTimeToInstant(form.startsAt, form.timezone)
        : "",
      // null, NOT "". An empty datetime-local yields "", which the schema
      // rejects as "Invalid ISO datetime" rather than reading as "no end time".
      endsAt: form.endsAt
        ? wallTimeToInstant(form.endsAt, form.timezone)
        : null,
      location: form.location,
      visibility: form.visibility,
      timezone: form.timezone,
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ""),
    };
  }

  function applyIssues(
    entries: Iterable<[string, string]>,
  ): Record<string, string> {
    const errors: Record<string, string> = {};

    for (const [path, message] of entries) {
      // A "" path is an object-level issue — .strict()'s unknown-key error and
      // the update schema's "at least one field" both land here, and neither
      // belongs against an input.
      if (path === "" || path === "_form") {
        setFormError(message);
        continue;
      }

      errors[path] ??= message;
    }

    return errors;
  }

  async function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();

    setFieldErrors({});
    setFormError(null);

    const result = createEventSchema.safeParse(buildInput());

    if (!result.success) {
      setFieldErrors(
        applyIssues(
          result.error.issues.map((issue) => [
            issue.path.join("."),
            issue.message,
          ]),
        ),
      );

      return;
    }

    setSubmitting(true);

    try {
      await onSubmit(result.data);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields) {
          setFieldErrors(
            applyIssues(
              Object.entries(error.fields).map(([field, messages]) => [
                field,
                messages[0] ?? error.message,
              ]),
            ),
          );
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError("Something went wrong. Please try again.");
      }

      // Only on failure. On success the page navigates away, and clearing it
      // there would set state on an unmounted component.
      setSubmitting(false);
    }
  }

  const describedBy = (field: string) =>
    fieldErrors[field] ? `${field}-error` : undefined;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {formError && <p role="alert">{formError}</p>}
      <div>
        <label htmlFor="title">Title</label>

        <input
          id="title"
          value={form.title}
          onChange={(e) => update("title", e.target.value)}
          aria-invalid={Boolean(fieldErrors.title)}
          aria-describedby={describedBy("title")}
        />

        {fieldErrors.title && <p id="title-error">{fieldErrors.title}</p>}
      </div>
      <div>
        <label htmlFor="description">Description</label>

        <textarea
          id="description"
          rows={4}
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          aria-invalid={Boolean(fieldErrors.description)}
          aria-describedby={describedBy("description")}
        />

        {fieldErrors.description && (
          <p id="description-error">{fieldErrors.description}</p>
        )}
      </div>
      <div>
        <label htmlFor="timezone">Timezone</label>

        {/* The zone is chosen BEFORE the times, because it is what the times
          mean. Changing it re-interprets the same wall clock as a different
          instant — which is why the preview below sits under both. */}
        <select
          id="timezone"
          value={form.timezone}
          onChange={(e) => update("timezone", e.target.value)}
          aria-invalid={Boolean(fieldErrors.timezone)}
          aria-describedby={describedBy("timezone")}
        >
          {timeZones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>

        {fieldErrors.timezone && (
          <p id="timezone-error">{fieldErrors.timezone}</p>
        )}
      </div>
      <div>
        <label htmlFor="startsAt">Starts</label>

        <input
          id="startsAt"
          type="datetime-local"
          value={form.startsAt}
          onChange={(e) => update("startsAt", e.target.value)}
          aria-invalid={Boolean(fieldErrors.startsAt)}
          aria-describedby={
            fieldErrors.startsAt ? "startsAt-error" : "startsAt-preview"
          }
        />

        {fieldErrors.startsAt && (
          <p id="startsAt-error">{fieldErrors.startsAt}</p>
        )}

        {preview && <p id="startsAt-preview">Saves as {preview}</p>}
      </div>
      <div>
        <label htmlFor="endsAt">Ends (optional)</label>

        <input
          id="endsAt"
          type="datetime-local"
          value={form.endsAt}
          onChange={(e) => update("endsAt", e.target.value)}
          aria-invalid={Boolean(fieldErrors.endsAt)}
          aria-describedby={describedBy("endsAt")}
        />

        {fieldErrors.endsAt && <p id="endsAt-error">{fieldErrors.endsAt}</p>}
      </div>
      <div>
        <label htmlFor="location">Location</label>

        <input
          id="location"
          value={form.location}
          onChange={(e) => update("location", e.target.value)}
          aria-invalid={Boolean(fieldErrors.location)}
          aria-describedby={describedBy("location")}
        />

        {fieldErrors.location && (
          <p id="location-error">{fieldErrors.location}</p>
        )}
      </div>
      <div>
        <label htmlFor="visibility">Visibility</label>

        <select
          id="visibility"
          value={form.visibility}
          onChange={(e) => update("visibility", e.target.value)}
        >
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
      </div>
      <div>
        <label htmlFor="tags">Tags</label>

        <input
          id="tags"
          value={form.tags}
          onChange={(e) => update("tags", e.target.value)}
          placeholder="Music, Conference"
          aria-invalid={Boolean(fieldErrors.tags)}
          aria-describedby={fieldErrors.tags ? "tags-error" : "tags-hint"}
        />

        {fieldErrors.tags ? (
          <p id="tags-error">{fieldErrors.tags}</p>
        ) : (
          <p id="tags-hint">Separate multiple tags with commas.</p>
        )}
      </div>
      <button type="submit" disabled={submitting}>
        {submitting ? "Saving..." : submitLabel}
      </button>{" "}
      <Link to={cancelTo}>Cancel</Link>
    </form>
  );
}
