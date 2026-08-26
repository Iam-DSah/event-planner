import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { CreateEventInput } from "@event-planner/shared";

import { ApiError, getEvent, updateEvent, type Event } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.js";
import EventForm from "../components/EventForm.js";

export default function EventEditPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The form is seeded from the server's copy, never from router state handed
  // over by the detail page: a deep link to /events/5/edit has no router state
  // and would render an empty form, so the fetch path has to exist anyway.
  useEffect(() => {
    if (!id) {
      return;
    }

    let cancelled = false;

    async function load(eventId: string) {
      try {
        const result = await getEvent(eventId);

        if (!cancelled) {
          setEvent(result);
        }
      } catch (error) {
        if (!cancelled) {
          setError(
            error instanceof ApiError && error.status === 404
              ? "This event does not exist, or you do not have access to it."
              : "Failed to load this event.",
          );
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

  async function handleSubmit(input: CreateEventInput) {
    if (!event) {
      return;
    }

    await updateEvent(event.id, input);

    navigate(`/events/${event.id}`, { replace: true });
  }

  if (loading) {
    return (
      <main>
        <p>Loading event...</p>
      </main>
    );
  }

  /**
   * A GET succeeds for any public event, including someone else's — 403 is
   * raised only by the mutation endpoints. So this page has to refuse
   * non-owners itself, or it would render a fully populated form whose Save
   * button always 403s. The server is still the authority; this only avoids
   * offering an action that cannot succeed.
   */
  if (event && user && event.creatorId !== user.id) {
    return (
      <main>
        <h1>Cannot edit</h1>

        <p role="alert">Only the creator of an event can edit it.</p>

        <p>
          <Link to={`/events/${event.id}`}>Back to the event</Link>
        </p>
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
      <h1>Edit event</h1>

      <EventForm
        event={event}
        submitLabel="Save changes"
        onSubmit={handleSubmit}
        cancelTo={`/events/${event.id}`}
      />
    </main>
  );
}
