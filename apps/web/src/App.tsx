import { Link, Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext.js";
import ProtectedRoute from "./components/ProtectedRoute.js";
import PublicOnlyRoute from "./components/PublicOnlyRoute.js";
import EventCreatePage from "./pages/EventCreatePage.js";
import EventDetailPage from "./pages/EventDetailPage.js";
import EventEditPage from "./pages/EventEditPage.js";
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
      <Link to="/events">Events</Link> <Link to="/events/new">New event</Link>{" "}
      <span>Signed in as {user?.name}</span>{" "}
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
          {/* /events/new is declared before /events/:id for readability only.
            React Router 7 ranks a static segment above a dynamic one whatever
            the order, which is what stops "new" being sent to the API as an id
            and coming back 400. */}
          <Route path="/events/new" element={<EventCreatePage />} />
          <Route path="/events/:id" element={<EventDetailPage />} />
          <Route path="/events/:id/edit" element={<EventEditPage />} />
        </Route>

        {/* An <h1> and a way out. As an inline <p> this was the only screen
          in the app with no heading — a screen reader landed on a bare
          sentence with no announced page title. Flagged by the route crawl
          (day 7 wart 1c), not by any behavioural check. */}
        <Route
          path="*"
          element={
            <main>
              <h1>Page not found</h1>

              <p>That page does not exist.</p>

              <p>
                <Link to="/events">All events</Link>
              </p>
            </main>
          }
        />
      </Routes>
    </>
  );
}
