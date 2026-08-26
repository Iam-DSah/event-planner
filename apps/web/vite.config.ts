import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  server: {
    // WSL2: without this Vite binds IPv6 loopback ONLY ([::1]), and Windows'
    // localhost forwarding relays over IPv4 — so curl inside WSL works and the
    // browser on Windows gets connection refused. Verified: 127.0.0.1:5173
    // answered 000 before this line, 200 after. `true` listens on every
    // interface, which is also what makes the dev server reachable from a
    // phone on the same network.
    host: true,

    port: 5173,

    // strictPort is load-bearing, not tidiness. Vite's default behaviour when
    // 5173 is taken is to move quietly to 5174 and print it in small text. The
    // API allows exactly ONE origin, so every request from 5174 then fails
    // preflight — and the browser reports that as a generic CORS error rather
    // than "wrong port", which is a long way from the cause. Failing to start
    // is the cheaper failure.
    strictPort: true,
  },
});
