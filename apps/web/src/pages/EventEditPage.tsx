import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { CreateEventInput } from "@event-planner/shared";

import { ApiError, getEvent, updateEvent, type Event } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.js";
import EventForm from "../components/EventForm.js";
import { ArrowLeft } from "../components/Icon.js";
import Loading from "../components/Loading.js";

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
    return <Loading label="Loading event…" />;
  }

  if (event && user && event.creatorId !== user.id) {
    return (
      <main className="page-body max-w-2xl">
        <h1 className="font-display text-4xl leading-tight text-ink">
          Cannot edit
        </h1>

        <p role="alert" className="alert mt-6">
          Only the creator of an event can edit it.
        </p>

        <Link
          to={`/events/${event.id}`}
          className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-accent"
        >
          <ArrowLeft />
          Back to the event
        </Link>
      </main>
    );
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
    <main className="page-body max-w-3xl">
      <h1 className="font-display text-4xl leading-tight text-ink">
        Edit event
      </h1>

      <EventForm
        event={event}
        submitLabel="Save changes"
        onSubmit={handleSubmit}
        cancelTo={`/events/${event.id}`}
      />
    </main>
  );
}
