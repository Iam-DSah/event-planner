import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import App from "./App.js";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.js";

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
    {/* Router OUTSIDE the provider: anything auth-aware that needs to
        navigate (a redirect after login, a guard on a protected route) has
        to sit inside a Router to use its hooks. The reverse nesting compiles
        and then throws "useNavigate() may be used only in the context of a
        <Router>" the first time it is needed. */}
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
