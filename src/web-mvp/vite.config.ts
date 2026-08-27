import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./app/test-setup.ts"],
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
  },
});
