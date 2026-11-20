import { searchBuild } from "./scripts/search-build";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => {
  const configuredBase = process.env.VITE_BASE_PATH || "/";
  const base = configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`;

  return {
    base,
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), searchBuild(true)],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // React and the small helpers every page uses get their own chunks, so the
        // first page load no longer pulls in the charts (recharts) or Firebase chunk
        // just because a shared helper (clsx, tslib) happened to be bundled there.
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run)\//.test(id)) return "react";
          if (/node_modules\/(clsx|tailwind-merge|class-variance-authority|tslib)\//.test(id)) return "vendor";
          if (id.includes("node_modules/firebase") || id.includes("node_modules/@firebase")) return "firebase";
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) return "charts";
          if (id.includes("node_modules/@radix-ui")) return "ui";
          return undefined;
        },
      },
    },
  },
  };
});
