import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";

/**
 * Mount point only — find the root element, fail loudly if it is missing, and
 * render. Everything else belongs in App.tsx; this file should not grow.
 */

const rootElement = document.getElementById("root");

// Non-null assertions hide exactly this failure. If the div is missing, say so.
if (!rootElement) {
  throw new Error("No #root element found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * READ THIS BEFORE YOU WRITE THE BOOT SEQUENCE — StrictMode will bite you.
 *
 * In development only, StrictMode mounts every component, unmounts it, and
 * mounts it again. Effects therefore run TWICE. It does this deliberately, to
 * surface effects that are not safe to run more than once.
 *
 * Your day 7 boot sequence is exactly such an effect: GET /me, and on 401 call
 * /refresh. Under StrictMode that becomes two /me calls and, if the access
 * token is dead, two /refresh calls firing at once — two rotations of the same
 * refresh token in the same millisecond.
 *
 * That is not a StrictMode bug. It is the concurrent-refresh case you already
 * built for on day 6, arriving on the first page load rather than in a load
 * harness. Three things are worth knowing about it:
 *
 *   1. The server survives it. The compare-and-set in markRefreshTokenUsed
 *      means one caller wins and the loser gets a sibling in the same family;
 *      the 10-second grace window keeps the second call from reading as reuse.
 *      Nobody is logged out.
 *   2. Surviving it is not the same as being correct. Two rotations per page
 *      load is waste, and it is precisely what the single-flight rule in the
 *      API client exists to prevent — one in-flight /refresh, everything else
 *      queues behind it. D019 calls the grace window the safety net, not the
 *      mechanism.
 *   3. So do NOT remove StrictMode to make the double call go away. It is the
 *      cheapest test you will get of whether single-flight actually works, and
 *      it runs on every page load for free.
 */
