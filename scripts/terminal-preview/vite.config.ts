// Local preview of the FYNX Trade terminal with simulated prices: `npx vite --config scripts/terminal-preview/vite.config.ts`.
// Never deployed: the production build only uses the root index.html.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
const stubs = path.resolve(__dirname, "stubs.ts");
export default defineConfig({
  root: __dirname,
  server: { host: "127.0.0.1", port: 5199 },
  plugins: [react()],
  resolve: { alias: [
    { find: "@/contexts/AuthContext", replacement: stubs },
    { find: "@/services/funded-access", replacement: stubs },
    { find: "@/lib/firebase", replacement: stubs },
    { find: "@", replacement: path.resolve(__dirname, "../../src") },
  ] },
  css: { postcss: path.resolve(__dirname, "../..") },
});
