import { defineConfig } from "vite";

// Relative base so the built assets load correctly when served from nginx root.
export default defineConfig({
  base: "./",
  server: {
    host: true,
    port: 4080,
  },
});
