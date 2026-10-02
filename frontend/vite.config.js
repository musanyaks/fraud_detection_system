import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",   // compose maps api -> host 8000
        changeOrigin: true,
        // rewrite: (p) => p.replace(/^\/api/, ""),  // uncomment ONLY if FastAPI routes don't start with /api
      },
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
      },
    },
  },
});