import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ApiError, deleteEvent, getEvent, type Event } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.js";
import EventTime from "../components/EventTime.js";
import { ArrowLeft } from "../components/Icon.js";
import Loading from "../components/Loading.js";

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "This event does not exist, or you do not have access to it.";
    }

    if (error.status === 400) {
      return "That is not a valid event link.";
    }

    return error.message;
  }

  return "Failed to load this event.";
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) {
      return;
    }

    let cancelled = false;

    async function load(eventId: string) {
      setLoading(true);
      setError(null);

      try {
        const result = await getEvent(eventId);

        if (!cancelled) {
          setEvent(result);
        }
      } catch (error) {
        if (!cancelled) {
          setEvent(null);
          setError(describeError(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load(id);

    return () => {
      cancelled = true;
    };
  }, [id]);

  const isOwner = Boolean(event && user && event.creatorId === user.id);

  async function handleDelete() {
    if (!event) {
      return;
    }

    if (!window.confirm(`Delete "${event.title}"? This cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      await deleteEvent(event.id);
      navigate("/events", { replace: true });
    } catch (error) {
      setError(describeError(error));
      setDeleting(false);
    }
  }

  if (loading) {
    return <Loading label="Loading event…" />;
  }

  if (error || !event) {
    return (
      <main className="page-body max-w-2xl">
        <h1 className="font-display text-4xl leading-tight text-ink">
          Event unavailable
        </h1>

        <p role="alert" className="alert mt-6">
          {error ?? "Failed to load this event."}
        </p>

        <Link
          to="/events"
          className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-accent"
        >
          <ArrowLeft />
          All events
        </Link>
      </main>
    );
  }

  return (
    <main className="page-body max-w-4xl">
      <Link
        to="/events"
        className="inline-flex items-center gap-2 text-sm text-ink-muted no-underline hover:text-ink"
      >
        <ArrowLeft />
        All events
      </Link>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <h1 className="font-display text-4xl leading-tight text-ink sm:text-5xl">
          {event.title}
        </h1>

        {isOwner && (
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to={`/events/${event.id}/edit`}
              className="btn btn-quiet no-underline"
            >
              Edit event
            </Link>

            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="btn btn-danger"
            >
              {deleting ? "Deleting…" : "Delete event"}
            </button>
          </div>
        )}
      </div>

      <dl className="mt-8 border-t border-rule">
        <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[9rem_1fr] sm:gap-6">
          <dt className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
            Starts
          </dt>
          {/* Rendered in the EVENT's timezone, not the viewer's. starts_at is a
            UTC instant and `timezone` is the venue's zone; toLocaleString
            would answer "when is this for me?", which is not the question. */}
          <dd className="text-pretty text-ink">
            <EventTime iso={event.startsAt} timeZone={event.timezone} />
          </dd>
        </div>

        {event.endsAt && (
          <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[9rem_1fr] sm:gap-6">
            <dt className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
              Ends
            </dt>
            <dd className="text-pretty text-ink">
              <EventTime iso={event.endsAt} timeZone={event.timezone} />
            </dd>
          </div>
        )}

        <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[9rem_1fr] sm:gap-6">
          <dt className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
            Location
          </dt>
          <dd className="text-ink">{event.location}</dd>
        </div>

        <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[9rem_1fr] sm:gap-6">
          <dt className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
            Visibility
          </dt>
          <dd className="capitalize text-ink">{event.visibility}</dd>
        </div>

        {event.tags.length > 0 && (
          <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[9rem_1fr] sm:gap-6">
            <dt className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
              Tags
            </dt>
            <dd>
              {/* Each tag links to the list filtered by it — the filter is in
                the URL now, so this is just a link, with no state to
                hand over. */}
              <ul className="flex flex-wrap gap-1.5">
                {event.tags.map((tag) => (
                  <li key={tag}>
                    <Link
                      to={`/events?tag=${encodeURIComponent(tag)}`}
                      className="inline-block rounded-full border border-rule px-2.5 py-0.5 text-sm text-ink-muted no-underline transition-colors hover:border-ink-muted hover:text-ink"
                    >
                      {tag}
                    </Link>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>

      {event.description && (
        <p className="measure mt-8 whitespace-pre-line text-ink">
          {event.description}
        </p>
      )}
    </main>
  );
}
