import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@/": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` throws outside React Server Components; tests run plain Node.
      "server-only": fileURLToPath(new URL("./lib/test/server-only-stub.ts", import.meta.url)),
    },
  },
})
