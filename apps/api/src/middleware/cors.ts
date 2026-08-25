import cors from "cors";

/**
 * CORS for the SPA. Config only — there is no application logic in this file.
 *
 * WHY THIS IS NEEDED AT ALL
 * The browser treats http://localhost:5173 (Vite) and http://localhost:3000
 * (this API) as different ORIGINS, because an origin is scheme + host + port.
 * Without the headers below, the browser makes the request, receives the
 * response, and then throws it away before JavaScript can read it.
 *
 * This is a different mechanism from SameSite, which was checked on day 4:
 * a *site* ignores the port, so a SameSite=Lax cookie already crosses
 * 5173 -> 3000 and is sent. The cookie arriving and the response being
 * readable are two separate permissions, and both are required.
 */

/**
 * Exactly one origin, never "*".
 *
 * The CORS spec forbids Access-Control-Allow-Origin: * on a credentialed
 * request. `credentials: "include"` on the client plus a wildcard here is not
 * a warning — the browser rejects the response outright, and the console
 * message names the wildcard rather than the cookie, which sends you looking
 * in the wrong place.
 *
 * Default rather than requireEnv(): a missing WEB_ORIGIN should not stop the
 * API from booting for someone who only wants to curl it. The ceiling is that
 * a real deployment which forgets to set this silently trusts localhost, so
 * a production build should promote this to requireEnv.
 */
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

export const corsMiddleware = cors({
  origin: WEB_ORIGIN,

  // Sends Access-Control-Allow-Credentials: true. Without it the browser
  // strips the Set-Cookie on the response and refuses to attach cookies to
  // the request — every endpoint answers 401 while the network tab shows a
  // perfectly normal request going out.
  credentials: true,

  // The preflight answer is stable, so let the browser cache it instead of
  // sending an OPTIONS before every PATCH and DELETE. 10 minutes; Chrome caps
  // this at 2 hours regardless of what is asked for.
  maxAge: 600,
});

/**
 * MOUNT THIS FIRST, ABOVE THE BODY PARSER.
 *
 * cors() writes its headers synchronously and then calls next(), so anything
 * that fails later still carries them. Mounted below express.json(), an
 * oversized body would 413 with no CORS headers on it, the browser would
 * discard the response, and the frontend would see an opaque network failure
 * instead of the 413 the error handler worked to produce.
 *
 * It also answers OPTIONS itself and ends the response there — do NOT add an
 * app.options() route. Express 5 uses path-to-regexp v8, where the old
 * app.options("*", ...) throws at startup.
 */

/**
 * WHO ACTUALLY ENFORCES THIS — verified in Chromium, because it is the single
 * most commonly misunderstood thing about CORS.
 *
 * The server does not block anything. With a string `origin`, the cors package
 * echoes the configured value on EVERY request, whatever Origin was sent:
 *
 *   OPTIONS from http://localhost:5173  ->  204, Allow-Origin: …5173
 *   OPTIONS from http://localhost:5174  ->  204, Allow-Origin: …5173   <-- same
 *
 * The 5174 request is served in full. The browser then compares the header
 * against the page's own origin, finds they differ, and throws the response
 * away — `fetch` rejects with the contentless "Failed to fetch".
 *
 * Measured, same probe server, same handler:
 *
 *   http://localhost:5173  ->  READABLE: 200 {"ok":true}
 *   http://localhost:5174  ->  BLOCKED BY BROWSER: Failed to fetch
 *
 * Two consequences worth being able to state:
 *   - CORS is not access control. curl, Postman and any server-side client
 *     ignore it completely. Authorization is requireAuth's job, not this file's.
 *   - A CORS failure in the console does NOT mean the request did not happen.
 *     It ran, and any side effect it had has already happened.
 */
