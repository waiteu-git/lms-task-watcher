import { defineConfig } from 'vite'
import { resolve } from 'path'

// Content script は Chrome の classic script として実行されるため ES module の
// import 文が使えない。format: 'iife' で全依存をインライン化した単一ファイルにする。
export default defineConfig(({ mode }) => ({
  define: {
    __DEV_TOOLS__: mode === 'development',
  },
  build: {
    rollupOptions: {
      input: resolve(__dirname, 'src/content/courseDetector.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'content.js',
        dir: 'dist',
      },
    },
    outDir: 'dist',
    emptyOutDir: false,
  },
}))
