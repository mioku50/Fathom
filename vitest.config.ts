import { defineConfig } from 'vitest/config'
import { readFileSync } from 'fs'

/**
 * Wrangler bundles `**\/*.md` as text (see the [[rules]] block in
 * wrangler.toml), which is how SKILL.md reaches the Worker without being
 * duplicated into a TypeScript string. Vitest needs to be told the same thing,
 * or every module that imports it fails to load.
 */
const markdownAsText = {
  name: 'markdown-as-text',
  transform(_code: string, id: string) {
    if (!id.endsWith('.md')) return null
    return {
      code: `export default ${JSON.stringify(readFileSync(id.split('?')[0], 'utf8'))};`,
      map: null
    }
  }
}

export default defineConfig({
  plugins: [markdownAsText],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    retry: process.env.CI ? 2 : 1,
  },
})
