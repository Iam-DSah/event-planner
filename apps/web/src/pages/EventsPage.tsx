import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { eventListQuerySchema } from "@event-planner/shared";

import {
  ApiError,
  listEvents,
  type Event,
  type Pagination,
} from "../api/client.js";
import EventTime from "../components/EventTime.js";

function parseListQuery(search: string) {
  const searchParams = new URLSearchParams(search);

  return eventListQuerySchema.safeParse({
    ...Object.fromEntries(searchParams),
    tag: searchParams.getAll("tag"),
  });
}

export default function EventsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [events, setEvents] = useState<Event[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const search = searchParams.toString();
  const parsed = useMemo(() => parseListQuery(search), [search]);

  useEffect(() => {
    if (!parsed.success) {
      setLoading(false);
      setError(
        parsed.error.issues
          .map((issue) =>
            issue.path.length > 0
              ? `${issue.path.join(".")}: ${issue.message}`
              : issue.message,
          )
          .join(". "),
      );

      return;
    }

    const query = parsed.data;

    let cancelled = false;

    async function loadEvents() {
      setLoading(true);
      setError(null);

      try {
        const result = await listEvents(query);

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
  }, [parsed]);

  const params = parsed.success ? parsed.data : null;

  const totalPages =
    pagination && params ? Math.ceil(pagination.total / params.limit) : 0;

  function goToPage(page: number) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);

      if (page <= 1) {
        next.delete("page");
      } else {
        next.set("page", String(page));
      }

      return next;
    });
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const data = new FormData(event.currentTarget);

    const next = new URLSearchParams(searchParams);

    next.delete("page");

    next.delete("tag");

    const when = String(data.get("when") ?? "");

    if (when && when !== "upcoming") {
      next.set("when", when);
    } else {
      next.delete("when");
    }

    const visibility = String(data.get("visibility") ?? "");

    if (visibility) {
      next.set("visibility", visibility);
    } else {
      next.delete("visibility");
    }

    const q = String(data.get("q") ?? "").trim();

    // Trimmed, and omitted when empty: the API rejects ?q= as a 400 rather
    // than reading it as "no search", the same rule as ?tag=.
    if (q) {
      next.set("q", q);
    } else {
      next.delete("q");
    }

    if (data.get("mine") === "true") {
      next.set("mine", "true");
    } else {
      next.delete("mine");
    }

    for (const tag of String(data.get("tags") ?? "").split(",")) {
      const trimmed = tag.trim();

      if (trimmed) {
        next.append("tag", trimmed);
      }
    }

    setSearchParams(next);
  }

  return (
    <main>
      <h1>Events</h1>

      {/* Uncontrolled, and keyed on the query string. A controlled draft would
        need an effect to re-seed itself when the back button changes the URL,
        which is the two-sources-of-truth bug this page exists to avoid. An
        uncontrolled input ignores a changed defaultValue once mounted, so the
        key remounts the form instead — one line rather than an effect. */}
      <form key={search} onSubmit={applyFilters}>
        <div>
          <label htmlFor="search">Search</label>

          {/* type="search" for the native clear button and correct mobile
            keyboard. Enter submits because it is a text input inside a form —
            no key handler needed. Searching also clears ?page= via the
            delete("page") in applyFilters, since page 5 of the old results
            means nothing against a new query. */}
          <input
            id="search"
            name="q"
            type="search"
            placeholder="Title, description or location"
            defaultValue={params?.q ?? ""}
          />
        </div>

        <div>
          <label htmlFor="when">When</label>

          <select
            id="when"
            name="when"
            defaultValue={params?.when ?? "upcoming"}
          >
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
            <option value="all">All</option>
          </select>
        </div>

        <div>
          <label htmlFor="visibility">Visibility</label>

          <select
            id="visibility"
            name="visibility"
            defaultValue={params?.visibility ?? ""}
          >
            <option value="">Any</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>

        <div>
          {/* A checkbox contributes to FormData ONLY when checked, so an
            unchecked box is simply an absent key, which is exactly the
            "no filter" case, with no false/"off" value to special-case. */}
          <input
            id="mine"
            name="mine"
            type="checkbox"
            value="true"
            defaultChecked={params?.mine ?? false}
          />{" "}
          <label htmlFor="mine">Only events I created</label>
        </div>

        <div>
          <label htmlFor="tags">Tags</label>

          <input
            id="tags"
            name="tags"
            type="text"
            placeholder="Music, Conference"
            defaultValue={params?.tags.join(", ") ?? ""}
            aria-describedby="tags-hint"
          />

          <p id="tags-hint">Separate multiple tags with commas.</p>
        </div>

        <button type="submit">Apply filters</button>
      </form>

      {loading && <p>Loading events...</p>}

      {error && <p role="alert">{error}</p>}

      {!loading && !error && events.length === 0 && <p>No events found.</p>}

      <section>
        {events.map((event) => (
          <article key={event.id}>
            <h2>
              <Link to={`/events/${event.id}`}>{event.title}</Link>
            </h2>

            {/* Venue time always; the viewer's local reading only when it
              differs. starts_at is a UTC instant and `timezone` is the venue's
              zone*/}
            <p>
              <strong>Starts:</strong>{" "}
              <EventTime iso={event.startsAt} timeZone={event.timezone} />
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

      {pagination && params && (
        <nav aria-label="Event pagination">
          <button
            type="button"
            onClick={() => goToPage(params.page - 1)}
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
            onClick={() => goToPage(params.page + 1)}
            disabled={loading || params.page >= totalPages}
          >
            Next
          </button>
        </nav>
      )}
    </main>
  );
}
