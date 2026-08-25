const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";

interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string[]>;
}

interface ApiErrorResponse {
  error: ApiErrorBody;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string[]>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string[]>,
  ) {
    super(message);

    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

// One in-flight refresh for the whole module. Concurrent 401s await this same
// promise instead of each firing their own rotation.
let refreshInFlight: Promise<boolean> | null = null;

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
        // Carries the per-field map from errorHandler's ZodError branch.
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
  // Access-Control-Max-Age hides most of that after the first call, but the
  // fix is not to lean on the browser's preflight cache.
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

export async function getHealth(): Promise<{ status: string }> {
  return request<{ status: string }>("/health");
}

export async function getMe(): Promise<{ user: User }> {
  return request<{ user: User }>("/auth/me");
}
