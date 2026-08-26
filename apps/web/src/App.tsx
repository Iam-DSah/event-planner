import { Link, Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext.js";
import ProtectedRoute from "./components/ProtectedRoute.js";
import EventsPage from "./pages/EventsPage.js";
import LoginPage from "./pages/LoginPage.js";
import RegisterPage from "./pages/RegisterPage.js";

/**
 * Renders nothing until the boot /me has answered. Showing a logged-out header
 * during "loading" is the same flash the three-state model exists to avoid,
 * just in the chrome instead of the page.
 */
function Header() {
  const { status, user, logout } = useAuth();

  if (status !== "authenticated") {
    return null;
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

        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

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
