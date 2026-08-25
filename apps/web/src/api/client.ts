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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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
