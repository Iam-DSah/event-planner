import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  server: {
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
