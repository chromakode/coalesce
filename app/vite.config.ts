import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      // Fix different lexical instance between shared and app
      lexical: path.resolve('./node_modules/lexical'),
      '@lexical/rich-text': path.resolve('./node_modules/@lexical/rich-text'),
      // https://github.com/facebook/lexical/issues/2153
      yjs: path.resolve('./node_modules/yjs/src/index.js'),
    },
  },
})
