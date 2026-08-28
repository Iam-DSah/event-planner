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
