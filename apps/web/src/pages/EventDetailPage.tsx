import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ApiError, deleteEvent, getEvent, type Event } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.js";
import EventTime from "../components/EventTime.js";

/**
 * The API deliberately answers 404 for BOTH "no such event" and "a private
 * event that is not yours" (eventService.getEvent). This page must conflate
 * them too: a message distinguishing the two would re-leak, through the UI,
 * exactly the existence the server took care to hide.
 *
 * Note what is NOT a state here: 403. A GET never returns it. A public event
 * you do not own is readable — 200 — and only its Edit/Delete controls are
 * withheld. 403 exists only on the mutation endpoints.
 */
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
          // The event is cleared as well as the error being set: leaving a
          // previously loaded event on screen under an error message shows two
          // contradictory answers at once.
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

  /**
   * Ownership is decided from data the server sent, not from anything the
   * client asserts. Hiding the buttons is a UI courtesy — the real rule is
   * getEventForMutation's ForbiddenError, which is what actually stops a
   * hand-made DELETE.
   */
  const isOwner = Boolean(event && user && event.creatorId === user.id);

  async function handleDelete() {
    if (!event) {
      return;
    }

    // window.confirm, not a modal component. It is native, focus-trapped and
    // keyboard-accessible for free, and a bespoke dialog would be the largest
    // thing on this page in service of one irreversible click.
    if (!window.confirm(`Delete "${event.title}"? This cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      await deleteEvent(event.id);

      // D023 says routing is a function of auth state and pages do not
      // navigate. This is the documented exception and not a violation of it:
      // the resource this URL names no longer exists, which is not an auth
      // transition and no guard can express it.
      //
      // replace, not push: without it the Back button returns to the detail
      // page of an event that is now deleted, which 404s.
      navigate("/events", { replace: true });
    } catch (error) {
      setError(describeError(error));
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <main>
        <p>Loading event...</p>
      </main>
    );
  }

  if (error || !event) {
    return (
      <main>
        <h1>Event unavailable</h1>

        <p role="alert">{error ?? "Failed to load this event."}</p>

        <p>
          <Link to="/events">All events</Link>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>{event.title}</h1>

      <dl>
        <dt>Starts</dt>
        {/* Rendered in the EVENT's timezone, not the viewer's. starts_at is a
          UTC instant and `timezone` is the venue's zone (D004); toLocaleString
          would answer "when is this for me?", which is not the question. */}
        <dd>
          <EventTime iso={event.startsAt} timeZone={event.timezone} />
        </dd>

        {event.endsAt && (
          <>
            <dt>Ends</dt>
            <dd>
              <EventTime iso={event.endsAt} timeZone={event.timezone} />
            </dd>
          </>
        )}

        <dt>Location</dt>
        <dd>{event.location}</dd>

        <dt>Visibility</dt>
        <dd>{event.visibility}</dd>

        {event.tags.length > 0 && (
          <>
            <dt>Tags</dt>
            <dd>
              {/* Each tag links to the list filtered by it — the filter is in
                the URL now (D024), so this is just a link, with no state to
                hand over. */}
              {event.tags.map((tag, index) => (
                <span key={tag}>
                  {index > 0 && ", "}
                  <Link to={`/events?tag=${encodeURIComponent(tag)}`}>
                    {tag}
                  </Link>
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>

      {event.description && <p>{event.description}</p>}

      {isOwner && (
        <p>
          <Link to={`/events/${event.id}/edit`}>Edit event</Link>{" "}
          <button type="button" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete event"}
          </button>
        </p>
      )}

      <p>
        <Link to="/events">All events</Link>
      </p>
    </main>
  );
}
