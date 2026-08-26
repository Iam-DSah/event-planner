import { useEffect, useState } from "react";

import {
  ApiError,
  listEvents,
  type Event,
  type EventListParams,
  type Pagination,
} from "../api/client.js";

/**
 * EventListParams has every field optional, which is correct for the API — a
 * caller may omit page and take the server's default. This page's state always
 * carries them, so it needs the narrower type. Widening EventListParams to fix
 * it would make the client lie about what the endpoint accepts.
 */
type ListState = EventListParams & { page: number; limit: number };

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);

  const [params, setParams] = useState<ListState>({
    page: 1,
    limit: 20,
    when: "upcoming",
    sort: "startsAt",
    order: "asc",
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      setLoading(true);
      setError(null);

      try {
        const result = await listEvents(params);

        if (cancelled) {
          return;
        }

        setEvents(result.events);
        setPagination(result.pagination);
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (error instanceof ApiError) {
          setError(error.message);
        } else {
          setError("Failed to load events.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadEvents();

    return () => {
      cancelled = true;
    };
  }, [params]);

  const totalPages = pagination
    ? Math.ceil(pagination.total / params.limit)
    : 0;

  function previousPage() {
    setParams((current) => ({
      ...current,
      page: Math.max(1, current.page - 1),
    }));
  }

  function nextPage() {
    if (!pagination || params.page >= totalPages) {
      return;
    }

    setParams((current) => ({
      ...current,
      page: current.page + 1,
    }));
  }

  return (
    <main>
      <h1>Events</h1>

      {loading && <p>Loading events...</p>}

      {error && <p role="alert">{error}</p>}

      {!loading && !error && events.length === 0 && <p>No events found.</p>}

      <section>
        {events.map((event) => (
          <article key={event.id}>
            <h2>{event.title}</h2>

            <p>
              <strong>Starts:</strong>{" "}
              {new Date(event.startsAt).toLocaleString()}
            </p>

            <p>
              <strong>Location:</strong> {event.location}
            </p>

            {event.tags.length > 0 && (
              <p>
                <strong>Tags:</strong> {event.tags.join(", ")}
              </p>
            )}
          </article>
        ))}
      </section>

      {pagination && (
        <nav aria-label="Event pagination">
          <button
            type="button"
            onClick={previousPage}
            disabled={params.page <= 1 || loading}
          >
            Previous
          </button>

          <span>
            Page {params.page} of {totalPages}
            {" · "}
            {pagination.total} events
          </span>

          <button
            type="button"
            onClick={nextPage}
            disabled={loading || params.page >= totalPages}
          >
            Next
          </button>
        </nav>
      )}
    </main>
  );
}
