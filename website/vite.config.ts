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
        agentHarness: resolve(__dirname, "agent-harness.html"),
        mcpAgentHarness: resolve(__dirname, "mcp-agent-harness.html"),
        slackAiAgent: resolve(__dirname, "slack-ai-agent.html"),
        telegramAiAgent: resolve(__dirname, "telegram-ai-agent.html"),
        googleChatAiAgent: resolve(__dirname, "google-chat-ai-agent.html"),
        browserAutomationAgent: resolve(__dirname, "browser-automation-agent.html"),
        onboarding: resolve(__dirname, "onboarding.html")
      }
    }
  }
});
