import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    __DEV_TOOLS__: mode === 'development',
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/courseDetector.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background.js'
          if (chunk.name === 'content') return 'content.js'
          return 'assets/[name]-[hash].js'
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        // background は "type": "module" のサービスワーカーとして動作するため ES 形式でよい。
        // content は chrome の content_scripts として classic script で実行されるが、
        // Rollup が単一ファイルにバンドルするため import/export がなければ問題ない。
        // (src/content/courseDetector.ts は外部ライブラリを import しないため
        //  出力ファイルに import/export 文が残らない)
        format: 'es',
      },
    },
  },
}))
