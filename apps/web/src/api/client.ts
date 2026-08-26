import type { CreateEventInput } from "@event-planner/shared";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";

// One in-flight refresh for the whole module. Concurrent 401s await this same
// promise instead of each firing their own rotation.
let refreshInFlight: Promise<boolean> | null = null;

// Set by AuthProvider. Means "the session unexpectedly became invalid" — NOT
// "the user logged out", which is a deliberate local transition the provider
// owns in its own finally block.
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(callback: (() => void) | null): void {
  onUnauthorized = callback;
}

interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string[]>;
}

interface ApiErrorResponse {
  error: ApiErrorBody;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    // The per-field map from errorHandler's ZodError branch. Forms need it to
    // mark which input failed; {code, message} alone cannot say.
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// A 401 from these is an answer, not a stale session: login means wrong
// password, and refreshing on /auth/refresh would recurse.
function isAuthPath(path: string): boolean {
  return (
    path === "/auth/login" ||
    path === "/auth/register" ||
    path === "/auth/refresh"
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  // 204 has no response body.
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";

  let body: unknown = null;

  if (contentType.includes("application/json")) {
    body = await response.json();
  } else {
    const text = await response.text();

    if (text) {
      body = text;
    }
  }

  if (response.ok) {
    return body as T;
  }

  // Trust the envelope only once its shape is checked — a failure that is not
  // ours (a proxy, a dead server) falls through to the generic error below.
  if (typeof body === "object" && body !== null && "error" in body) {
    const errorBody = body as ApiErrorResponse;

    if (
      errorBody.error &&
      typeof errorBody.error.code === "string" &&
      typeof errorBody.error.message === "string"
    ) {
      throw new ApiError(
        response.status,
        errorBody.error.code,
        errorBody.error.message,
        errorBody.error.fields,
      );
    }
  }

  throw new ApiError(
    response.status,
    "HTTP_ERROR",
    `Request failed with status ${response.status}`,
  );
}

// Deliberately a bare fetch, not request(): routing it through request() would
// send a 401 from the refresh endpoint straight back into the refresh path.
async function doRefresh(): Promise<boolean> {
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });

  // /auth/refresh answers 204 by design — it exists to move cookies, not to
  // return data — so success is res.ok, not a body.
  return response.ok;
}

async function refreshOnce(): Promise<boolean> {
  // finally, not then: clearing only on success would cache a rejected promise
  // and leave every later request awaiting a permanent failure.
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  retried = false,
): Promise<T> {
  // Content-Type only when there is a body to describe. "application/json"
  // is not a CORS-safelisted header value, so sending it unconditionally
  // forces a preflight on every bodyless GET — measured server-side:
  //   with the header:     OPTIONS /probe  then  GET /probe
  //   without the header:  GET /probe
  const hasBody = options.body !== undefined && options.body !== null;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    // Spread AFTER options so a caller cannot accidentally drop it: the
    // cookies are httpOnly, so without this every request is a silent 401.
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  try {
    return await parseResponse<T>(response);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      !retried &&
      !isAuthPath(path)
    ) {
      if (await refreshOnce()) {
        // retried = true: exactly one attempt. Without it, a valid token for a
        // deleted user loops forever — refresh succeeds, /me 401s, repeat.
        return request<T>(path, options, true);
      }

      // A refresh has now failed, so the session is provably dead. This is the
      // only place that fires: a 401 the refresh then fixes is not a logout.
      onUnauthorized?.();
    }

    // The refresh could not recover the session, so the caller's ORIGINAL
    // failure is the truer story: their request failed because they are
    // logged out, not because /auth/refresh did.
    throw error;
  }
}

export interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthCredentials {
  email: string;
  password: string;
}

interface AuthResponse {
  user: User;
}

export async function login(credentials: AuthCredentials): Promise<User> {
  const response = await request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });

  return response.user;
}

export async function register(
  credentials: AuthCredentials & { name: string },
): Promise<User> {
  const response = await request<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(credentials),
  });

  return response.user;
}

export async function getMe(): Promise<User> {
  const response = await request<AuthResponse>("/auth/me");

  return response.user;
}

export async function logout(): Promise<void> {
  await request<void>("/auth/logout", { method: "POST" });
}

/**
 * Dates arrive as ISO STRINGS, not Date objects — JSON has no date type, so
 * the API's `Date` fields are serialised by JSON.stringify. Typing them as
 * Date here would compile and then blow up on the first `.toLocaleString()`.
 * Convert at the point of display.
 */
export interface Event {
  id: string;
  creatorId: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  location: string;
  visibility: "public" | "private";
  timezone: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}

export interface EventListParams {
  page?: number;
  limit?: number;
  q?: string;
  tags?: string[];
  visibility?: "public" | "private";
  mine?: boolean;
  when?: "upcoming" | "past" | "all";
  sort?: "startsAt" | "createdAt" | "relevance";
  order?: "asc" | "desc";
}

export async function listEvents(
  params: EventListParams = {},
): Promise<{ events: Event[]; pagination: Pagination }> {
  const query = new URLSearchParams();

  // Empty values are OMITTED, never appended blank. The API rejects `?tag=`
  // and `?page=` with 400 VALIDATION_ERROR rather than reading them as "no
  // filter" — deliberate on the server side, so a form that serialises every
  // input unconditionally gets a validation error instead of a full list.
  const set = (key: string, value: string | number | undefined) => {
    if (value !== undefined && String(value) !== "") {
      query.set(key, String(value));
    }
  };

  set("page", params.page);

  // The user's literal words. The API turns them into BOOLEAN MODE syntax;
  // sending pre-mangled text would make ?q= unreadable in a shared link and
  // put the same rule in two places.
  set("q", params.q);
  set("limit", params.limit);
  set("visibility", params.visibility);

  // Only when true. `set` would otherwise append "mine=false", which parses
  // to the same result but puts a default into every shared link — the same
  // reason page 1 is written as /events rather than /events?page=1.
  if (params.mine) {
    query.set("mine", "true");
  }
  set("when", params.when);
  set("sort", params.sort);
  set("order", params.order);

  // append, not set: it REPEATS the key (?tag=a&tag=b), which is the only
  // array form Express 5 understands. Its default query parser is `simple`,
  // not `qs`, so `?tag[]=a` arrives as a key literally named "tag[]" and the
  // filter silently does nothing — a 200 with an unfiltered result set.
  for (const tag of params.tags ?? []) {
    if (tag.trim() !== "") {
      query.append("tag", tag);
    }
  }

  const suffix = query.toString();

  return request<{ events: Event[]; pagination: Pagination }>(
    suffix ? `/events?${suffix}` : "/events",
  );
}

/**
 * encodeURIComponent, even though the API rejects any id that is not a
 * positive integer: the id arrives from a URL parameter, so an unencoded "/"
 * would change which PATH is requested rather than producing the 400 the
 * server is waiting to give. Encoding keeps a bad id a bad id.
 */
export async function getEvent(id: string): Promise<Event> {
  const response = await request<{ event: Event }>(
    `/events/${encodeURIComponent(id)}`,
  );

  return response.event;
}

export async function deleteEvent(id: string): Promise<void> {
  // 204, no body — parseResponse already returns undefined for it.
  await request<void>(`/events/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/**
 * Both take the FULL field set, and both are validated by the caller against
 * `createEventSchema` before they are sent.
 *
 * That the PATCH also sends everything is deliberate: `updateEventSchema` is
 * `.partial()`, so it accepts the complete object just as happily as a subset,
 * and sending the whole form removes the dirty-tracking a "send only what
 * changed" design would need. Accepted cost: two tabs editing one event, the
 * later save wins on every field rather than only on the fields it touched.
 * Only the creator can edit, so that is one person in two tabs.
 */
export async function createEvent(input: CreateEventInput): Promise<Event> {
  const response = await request<{ event: Event }>("/events", {
    method: "POST",
    body: JSON.stringify(input),
  });

  return response.event;
}

export async function updateEvent(
  id: string,
  input: CreateEventInput,
): Promise<Event> {
  const response = await request<{ event: Event }>(
    `/events/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );

  return response.event;
}
