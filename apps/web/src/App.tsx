import { Navigate, Route, Routes } from "react-router-dom";

import ProtectedRoute from "./components/ProtectedRoute.js";
import EventsPage from "./pages/EventsPage.js";
import LoginPage from "./pages/LoginPage.js";
import RegisterPage from "./pages/RegisterPage.js";

export default function App() {
  return (
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
  );
}
