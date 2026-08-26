import { Link, Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext.js";
import ProtectedRoute from "./components/ProtectedRoute.js";
import PublicOnlyRoute from "./components/PublicOnlyRoute.js";
import EventsPage from "./pages/EventsPage.js";
import LoginPage from "./pages/LoginPage.js";
import RegisterPage from "./pages/RegisterPage.js";

/**
 * Renders nothing while the boot /me is still in flight — a logged-out header
 * during "loading" is the same flash the three-state model exists to avoid,
 * just in the chrome instead of the page body. Once the answer arrives, BOTH
 * outcomes get chrome: an anonymous visitor needs a way to reach sign-up, and
 * /register is otherwise only reachable by typing the URL.
 */
function Header() {
  const { status, user, logout } = useAuth();

  if (status === "loading") {
    return null;
  }

  if (status === "anonymous") {
    return (
      <header>
        <Link to="/login">Log in</Link> <Link to="/register">Sign up</Link>
      </header>
    );
  }

  return (
    <header>
      <Link to="/events">Events</Link> <span>Signed in as {user?.name}</span>{" "}
      <button type="button" onClick={() => void logout()}>
        Log out
      </button>
    </header>
  );
}

export default function App() {
  return (
    <>
      <Header />

      <Routes>
        <Route path="/" element={<Navigate to="/events" replace />} />

        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        {/* A layout route: ProtectedRoute renders <Outlet />, so every child
          below is gated by one guard rather than each page checking auth. */}
        <Route element={<ProtectedRoute />}>
          <Route path="/events" element={<EventsPage />} />
        </Route>

        <Route path="*" element={<p>Not found.</p>} />
      </Routes>
    </>
  );
}
