import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import svgr from 'vite-plugin-svgr'

export default defineConfig({
  base: '/app/',
  server: {
    fs: {
      allow: ['..'],
    },
  },
  plugins: [react(), svgr()],
  resolve: {
    alias: {
      '@shared': path.resolve('./node_modules/coalesce-shared'),
      // Resolve local tiny-invariant in shared code
      'tiny-invariant': path.resolve('./node_modules/tiny-invariant'),
      // Fix different lexical instance between shared and app
      lexical: path.resolve('./node_modules/lexical'),
      '@lexical/rich-text': path.resolve('./node_modules/@lexical/rich-text'),
      // https://github.com/facebook/lexical/issues/2153
      yjs: path.resolve('./node_modules/yjs/src/index.js'),
    },
  },
})
