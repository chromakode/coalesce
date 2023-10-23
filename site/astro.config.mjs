import path from 'path'
import { defineConfig } from 'astro/config'

// https://astro.build/config
export default defineConfig({
  vite: {
    resolve: {
      alias: {
        '@shared': new URL('../shared', import.meta.url).pathname,
      },
    },
  },
})
