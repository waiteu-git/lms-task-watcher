import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { TERMS_VERSION } from './src/legal/termsVersion.ts'

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development'
  const isBeta = mode === 'beta'
  const outDir = isDev ? 'dist-dev' : isBeta ? 'dist-beta' : 'dist'

  return {
  base: './',
  define: {
    __DEV_TOOLS__: isDev,
    __BETA__: isBeta,
    __TERMS_VERSION__: TERMS_VERSION,
  },
  plugins: [
    react(),
    {
      name: 'dev-manifest',
      closeBundle() {
        if (!isDev && !isBeta) return
        const path = resolve(__dirname, `${outDir}/manifest.json`)
        const manifest = JSON.parse(readFileSync(path, 'utf-8')) as { name: string }
        manifest.name = isDev
          ? 'LETUS Task Watcher [開発版]'
          : 'LETUS Task Watcher [ベータ]'
        writeFileSync(path, JSON.stringify(manifest, null, 2))
      },
    },
    {
      // content script は classic script として実行されるため import 文が残ると SyntaxError で全機能が死ぬ。
      // popup/background と実行時モジュールを共有すると Rollup が共有チャンクへ切り出して import が残るため、
      // ビルド時に検出して失敗させる。
      name: 'assert-content-scripts-are-self-contained',
      closeBundle() {
        for (const file of ['content.js', 'classTimetable.js']) {
          const code = readFileSync(resolve(__dirname, `${outDir}/${file}`), 'utf-8')
          if (/(^|[;\s])import[\s{*"']/.test(code)) {
            throw new Error(
              `${file} に import 文が残っています。content script は自己完結が必須です。` +
                `popup/background と共有される実行時モジュールを import していないか確認してください。`,
            )
          }
        }
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
        classTimetable: resolve(__dirname, 'src/content/classTimetable.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background.js'
          if (chunk.name === 'content') return 'content.js'
          if (chunk.name === 'classTimetable') return 'classTimetable.js'
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
  test: {
    setupFiles: ['./vitest.setup.ts'],
  },
  }
})
