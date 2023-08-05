import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      // https://github.com/facebook/lexical/issues/2153
      yjs: path.resolve('./node_modules/yjs/src/index.js'),
    },
  },
})
