import { defineConfig } from "vite";

// Relative asset paths so the same dist/ build loads from file:// inside
// the Electron shell (Phase 6) and from the Vite preview server.
export default defineConfig({
  base: "./",
});
