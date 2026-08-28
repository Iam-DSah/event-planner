import { Navigate, Outlet, useLocation, type Location } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.js";
import Loading from "./Loading.js";

export default function PublicOnlyRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return <Loading label="Checking your session…" />;
  }

  if (status === "authenticated") {
    const from = (location.state as { from?: Location } | null)?.from;

    return (
      <Navigate to={from ? from.pathname + from.search : "/events"} replace />
    );
  }

  return <Outlet />;
}
