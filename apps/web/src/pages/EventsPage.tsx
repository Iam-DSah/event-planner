import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { eventListQuerySchema } from "@event-planner/shared";

import {
  ApiError,
  listEvents,
  type Event,
  type Pagination,
} from "../api/client.js";
import EventTime from "../components/EventTime.js";
import { ChevronLeft, ChevronRight, Plus } from "../components/Icon.js";

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

      if (next.get("sort") === "relevance") {
        next.delete("sort");
      }
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

  const filtered = Boolean(
    params &&
    (params.q ||
      params.tags.length > 0 ||
      params.mine ||
      params.visibility ||
      params.when !== "upcoming"),
  );

  return (
    <main className="page-body">
      <h1 className="font-display text-4xl leading-tight text-ink">Events</h1>

      {/* Uncontrolled, and keyed on the query string. A controlled draft would
        need an effect to re-seed itself when the back button changes the URL,
        which is the two-sources-of-truth bug this page exists to avoid. An
        uncontrolled input ignores a changed defaultValue once mounted, so the
        key remounts the form instead — one line rather than an effect. */}
      <form
        key={search}
        onSubmit={applyFilters}
        className="panel mt-6 grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4"
      >
        <div className="lg:col-span-2">
          <label htmlFor="search" className="label">
            Search
          </label>

          {/* type="search" for the native clear button and correct mobile
            keyboard. Enter submits because it is a text input inside a form —
            no key handler needed. Searching also clears ?page= via the
            delete("page") in applyFilters, since page 5 of the old results
            means nothing against a new query. */}
          <input
            id="search"
            name="q"
            type="search"
            className="input"
            placeholder="Title, description or location"
            defaultValue={params?.q ?? ""}
          />
        </div>

        <div>
          <label htmlFor="when" className="label">
            When
          </label>

          <select
            id="when"
            name="when"
            className="input select"
            defaultValue={params?.when ?? "upcoming"}
          >
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
            <option value="all">All</option>
          </select>
        </div>

        <div>
          <label htmlFor="visibility" className="label">
            Visibility
          </label>

          <select
            id="visibility"
            name="visibility"
            className="input select"
            defaultValue={params?.visibility ?? ""}
          >
            <option value="">Any</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="tags" className="label">
            Tags
          </label>

          <input
            id="tags"
            name="tags"
            type="text"
            className="input"
            placeholder="Music, Conference"
            defaultValue={params?.tags.join(", ") ?? ""}
            aria-describedby="tags-hint"
          />

          <p id="tags-hint" className="field-hint">
            Separate multiple tags with commas.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 sm:col-span-2 lg:pt-7">
          <div className="flex items-center gap-2">
            {/* A checkbox contributes to FormData ONLY when checked, so an
            unchecked box is simply an absent key, which is exactly the
            "no filter" case, with no false/"off" value to special-case. */}
            <input
              id="mine"
              name="mine"
              type="checkbox"
              value="true"
              className="size-4 rounded border-rule"
              defaultChecked={params?.mine ?? false}
            />{" "}
            <label htmlFor="mine" className="text-sm text-ink">
              Only events I created
            </label>
          </div>

          <button type="submit" className="btn btn-primary">
            Apply filters
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="alert mt-8">
          {error}
        </p>
      )}

      {loading && events.length === 0 && (
        <p role="status" className="mt-8 text-sm text-ink-muted">
          Loading events…
        </p>
      )}

      {!error && !loading && events.length === 0 && (
        <div className="mt-16 text-center">
          <h2 className="font-display text-2xl text-ink">
            {filtered ? "No events match those filters" : "No events yet"}
          </h2>

          <p className="mx-auto mt-2 max-w-sm text-ink-muted">
            {filtered
              ? "Try a broader search, or widen the date range to include past events."
              : "The first event you create will appear here."}
          </p>

          <Link to="/events/new" className="btn btn-primary mt-6 no-underline">
            <Plus />
            New event
          </Link>
        </div>
      )}

      {events.length > 0 && (
        <ol
          aria-busy={loading}
          className={`mt-8 border-b border-rule transition-opacity duration-200 ${
            loading ? "opacity-50" : "opacity-100"
          }`}
        >
          {events.map((event, index) => (
            <li
              key={event.id}
              className="settle border-t border-rule"
              style={{ "--row": index } as CSSProperties}
            >
              <article className="grid gap-x-8 gap-y-3 py-6 sm:grid-cols-[10rem_1fr]">
                {/* Venue time always; the viewer's local reading only when it
                  differs. starts_at is a UTC instant and `timezone` is the
                  venue's zone. */}
                <EventTime
                  iso={event.startsAt}
                  timeZone={event.timezone}
                  variant="stacked"
                />

                <div>
                  <h2 className="font-display text-2xl leading-snug">
                    <Link
                      to={`/events/${event.id}`}
                      className="text-ink no-underline hover:underline"
                    >
                      {event.title}
                    </Link>
                  </h2>

                  <p className="mt-1 text-ink-muted">{event.location}</p>

                  {event.tags.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {event.tags.map((tag) => (
                        <li
                          key={tag}
                          className="rounded-full border border-rule px-2.5 py-0.5 text-xs text-ink-muted"
                        >
                          {tag}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            </li>
          ))}
        </ol>
      )}

      {pagination && params && events.length > 0 && (
        <nav
          aria-label="Event pagination"
          className="mt-8 flex flex-wrap items-center justify-between gap-4"
        >
          <button
            type="button"
            onClick={() => goToPage(params.page - 1)}
            disabled={params.page <= 1 || loading}
            className="btn btn-quiet"
          >
            <ChevronLeft />
            Previous
          </button>

          <span className="tnum order-last w-full text-center text-sm text-ink-muted sm:order-none sm:w-auto">
            Page {params.page} of {totalPages}
            {" · "}
            {pagination.total} events
          </span>

          <button
            type="button"
            onClick={() => goToPage(params.page + 1)}
            disabled={loading || params.page >= totalPages}
            className="btn btn-quiet"
          >
            Next
            <ChevronRight />
          </button>
        </nav>
      )}
    </main>
  );
}
