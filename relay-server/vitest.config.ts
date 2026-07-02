import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Why: the relay opens real sockets in tests; keep a generous-but-bounded
    // timeout so a hung handshake fails loudly instead of stalling CI.
    testTimeout: 10_000
  }
})
