import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.js";

export default function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  // Must RETURN, not redirect. Redirecting while the boot /me is still in
  // flight bounces every logged-in user to /login on refresh — the exact bug
  // the three-state model exists to prevent.
  if (status === "loading") {
    return <p>Loading...</p>;
  }

  if (status === "anonymous") {
    // Carry the requested location so login can send them back to it. Without
    // this a shared link to /events?tag=Music lands on an unfiltered list.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
