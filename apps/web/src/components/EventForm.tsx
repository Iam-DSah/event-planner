import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  createEventSchema,
  type CreateEventInput,
} from "@event-planner/shared";

import { ApiError, type Event } from "../api/client.js";
import EventTime from "./EventTime.js";
import {
  browserTimeZone,
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

  function toInstant(wall: string): string {
    try {
      return wallTimeToInstant(wall, form.timezone);
    } catch {
      return "";
    }
  }

  const previewInstant = form.startsAt
    ? toInstant(form.startsAt) || null
    : null;

  function buildInput(): unknown {
    return {
      title: form.title,
      description: form.description,
      startsAt: form.startsAt ? toInstant(form.startsAt) : "",
      endsAt: form.endsAt ? toInstant(form.endsAt) : null,
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
    <form onSubmit={handleSubmit} noValidate className="mt-8">
      {formError && (
        <p role="alert" className="alert mb-6">
          {formError}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="title" className="label">
            Title
          </label>

          <input
            id="title"
            className="input"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            aria-invalid={Boolean(fieldErrors.title)}
            aria-describedby={describedBy("title")}
          />

          {fieldErrors.title && (
            <p id="title-error" className="field-error">
              {fieldErrors.title}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="description" className="label">
            Description
          </label>

          <textarea
            id="description"
            rows={5}
            className="input resize-y"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            aria-invalid={Boolean(fieldErrors.description)}
            aria-describedby={describedBy("description")}
          />

          {fieldErrors.description && (
            <p id="description-error" className="field-error">
              {fieldErrors.description}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="timezone" className="label">
            Timezone
          </label>

          {/* The zone is chosen BEFORE the times, because it is what the times
            mean. Changing it re-interprets the same wall clock as a different
            instant — which is why the preview below sits under both. */}
          <select
            id="timezone"
            className="input select"
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
            <p id="timezone-error" className="field-error">
              {fieldErrors.timezone}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="startsAt" className="label">
            Starts
          </label>

          <input
            id="startsAt"
            type="datetime-local"
            className="input"
            value={form.startsAt}
            onChange={(e) => update("startsAt", e.target.value)}
            aria-invalid={Boolean(fieldErrors.startsAt)}
            aria-describedby={
              fieldErrors.startsAt
                ? "startsAt-error"
                : previewInstant
                  ? "startsAt-preview"
                  : undefined
            }
          />

          {fieldErrors.startsAt && (
            <p id="startsAt-error" className="field-error">
              {fieldErrors.startsAt}
            </p>
          )}

          {previewInstant && (
            <p id="startsAt-preview" className="field-hint">
              {/* The SAME component the list and detail pages use, so the
                organiser is shown exactly what a reader will be shown — and,
                when the venue is not her own zone, what it means locally. The
                suppression rule comes free: pick your own zone and there is one
                reading, not two. */}
              Saves as{" "}
              <EventTime iso={previewInstant} timeZone={form.timezone} />
            </p>
          )}
        </div>

        <div>
          <label htmlFor="endsAt" className="label">
            Ends (optional)
          </label>

          <input
            id="endsAt"
            type="datetime-local"
            className="input"
            value={form.endsAt}
            onChange={(e) => update("endsAt", e.target.value)}
            aria-invalid={Boolean(fieldErrors.endsAt)}
            aria-describedby={describedBy("endsAt")}
          />

          {fieldErrors.endsAt && (
            <p id="endsAt-error" className="field-error">
              {fieldErrors.endsAt}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="location" className="label">
            Location
          </label>

          <input
            id="location"
            className="input"
            value={form.location}
            onChange={(e) => update("location", e.target.value)}
            aria-invalid={Boolean(fieldErrors.location)}
            aria-describedby={describedBy("location")}
          />

          {fieldErrors.location && (
            <p id="location-error" className="field-error">
              {fieldErrors.location}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="visibility" className="label">
            Visibility
          </label>

          <select
            id="visibility"
            className="input select"
            value={form.visibility}
            onChange={(e) => update("visibility", e.target.value)}
            aria-describedby="visibility-hint"
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>

          <p id="visibility-hint" className="field-hint">
            Private events are visible only to you.
          </p>
        </div>

        <div>
          <label htmlFor="tags" className="label">
            Tags
          </label>

          <input
            id="tags"
            className="input"
            value={form.tags}
            onChange={(e) => update("tags", e.target.value)}
            placeholder="Music, Conference"
            aria-invalid={Boolean(fieldErrors.tags)}
            aria-describedby={fieldErrors.tags ? "tags-error" : "tags-hint"}
          />

          {fieldErrors.tags ? (
            <p id="tags-error" className="field-error">
              {fieldErrors.tags}
            </p>
          ) : (
            <p id="tags-hint" className="field-hint">
              Separate multiple tags with commas.
            </p>
          )}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-rule pt-6">
        <button type="submit" disabled={submitting} className="btn btn-primary">
          {submitting ? "Saving…" : submitLabel}
        </button>

        <Link to={cancelTo} className="btn btn-quiet no-underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
