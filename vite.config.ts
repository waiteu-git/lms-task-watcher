import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development'
  const outDir = isDev ? 'dist-dev' : 'dist'

  return {
  base: './',
  define: {
    __DEV_TOOLS__: isDev,
  },
  plugins: [
    react(),
    {
      name: 'dev-manifest',
      closeBundle() {
        if (!isDev) return
        const path = resolve(__dirname, `${outDir}/manifest.json`)
        const manifest = JSON.parse(readFileSync(path, 'utf-8')) as { name: string }
        manifest.name = 'LETUS Task Watcher [開発版]'
        writeFileSync(path, JSON.stringify(manifest, null, 2))
      },
    },
  ],
  build: {
    outDir,
    emptyOutDir: true,
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
  }
})
