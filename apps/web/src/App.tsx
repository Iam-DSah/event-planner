import { Link, Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext.js";
import ProtectedRoute from "./components/ProtectedRoute.js";
import PublicOnlyRoute from "./components/PublicOnlyRoute.js";
import { ArrowLeft, Plus } from "./components/Icon.js";
import EventCreatePage from "./pages/EventCreatePage.js";
import EventDetailPage from "./pages/EventDetailPage.js";
import EventEditPage from "./pages/EventEditPage.js";
import EventsPage from "./pages/EventsPage.js";
import LoginPage from "./pages/LoginPage.js";
import RegisterPage from "./pages/RegisterPage.js";

function Wordmark() {
  return (
    <Link
      to="/events"
      className="font-display text-xl leading-none text-ink no-underline"
    >
      Event Planner
    </Link>
  );
}

function Header() {
  const { status, user, logout } = useAuth();

  if (status === "loading") {
    return <div className="h-16 border-b border-rule" />;
  }

  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-paper">
      <div className="page flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3">
        <Wordmark />

        {status === "anonymous" ? (
          <nav className="flex items-center gap-2">
            <Link to="/login" className="btn btn-quiet no-underline">
              Log in
            </Link>

            <Link to="/register" className="btn btn-primary no-underline">
              Sign up
            </Link>
          </nav>
        ) : (
          <nav className="flex items-center gap-x-4 gap-y-2">
            <Link
              to="/events"
              className="text-sm text-ink-muted no-underline hover:text-ink"
            >
              Events
            </Link>

            <span className="hidden text-sm text-ink-muted sm:inline">
              {user?.name}
            </span>

            <button
              type="button"
              onClick={() => void logout()}
              className="text-sm text-ink-muted underline-offset-2 hover:text-ink"
            >
              Log out
            </button>

            <Link to="/events/new" className="btn btn-primary no-underline">
              <Plus />
              New event
            </Link>
          </nav>
        )}
      </div>
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
            <main className="page-body max-w-2xl">
              <h1 className="font-display text-4xl leading-tight text-ink">
                Page not found
              </h1>

              <p className="mt-3 text-ink-muted">
                That page does not exist. It may have been deleted, or the link
                may be wrong.
              </p>

              <Link
                to="/events"
                className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-accent"
              >
                <ArrowLeft />
                All events
              </Link>
            </main>
          }
        />
      </Routes>
    </>
  );
}
