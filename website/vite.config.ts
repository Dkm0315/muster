import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? (process.env.GITHUB_PAGES === "true" ? "/muster/" : "/"),
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        portal: resolve(__dirname, "portal.html"),
        docs: resolve(__dirname, "docs.html"),
        frappeAi: resolve(__dirname, "frappe-ai.html"),
        onboarding: resolve(__dirname, "onboarding.html")
      }
    }
  }
});
