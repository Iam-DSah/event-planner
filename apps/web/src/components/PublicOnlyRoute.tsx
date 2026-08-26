import { Navigate, Outlet, useLocation, type Location } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.js";

/**
 * The mirror of ProtectedRoute: gates /login and /register the other way.
 * Without it an authenticated user sees a login form with a "Log out" button
 * above it — the header and the page contradicting each other on one screen.
 *
 * Same rule as ProtectedRoute, for the same reason: while the boot /me is in
 * flight this must RENDER and return, never redirect. Redirecting on
 * `status !== "anonymous"` would bounce a genuinely logged-out visitor away
 * from the login page for as long as /me takes to answer.
 */
export default function PublicOnlyRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return <p>Loading...</p>;
  }

  if (status === "authenticated") {
    // Honour the location ProtectedRoute was carrying. This guard re-renders
    // the moment login() flips the state, which is BEFORE LoginPage's own
    // navigate(from) runs — so a bare <Navigate to="/events"> here silently
    // wins the race and throws the requested URL away. Measured: a deep link
    // to /events?tag=Music came back as /events until this line existed.
    const from = (location.state as { from?: Location } | null)?.from;

    return (
      <Navigate to={from ? from.pathname + from.search : "/events"} replace />
    );
  }

  return <Outlet />;
}
