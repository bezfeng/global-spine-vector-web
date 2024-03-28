import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/global-spine-vector-web/",
  resolve: {
    alias: {
      "node-fetch": "isomorphic-fetch",
    },
  },
});
