// Generates store-promo.png (440x280) using @resvg/resvg-js
// Run: node scripts/gen-promo.mjs

import { Resvg } from '@resvg/resvg-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="440" y2="280" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1a0a2e"/>
      <stop offset="100%" stop-color="#0d0620"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2a1a4a"/>
      <stop offset="100%" stop-color="#1e1036"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="440" height="280" fill="url(#bg)"/>

  <!-- Decorative glow -->
  <ellipse cx="370" cy="60" rx="120" ry="80" fill="#863bff" opacity="0.12"/>
  <ellipse cx="80" cy="220" rx="90" ry="60" fill="#47bfff" opacity="0.08"/>

  <!-- Logo icon (lightning bolt shape, simplified) -->
  <g transform="translate(32, 32)">
    <path d="M19 0 L7 18 h9 L12 36 L28 14 h-10 Z" fill="#863bff"/>
    <path d="M19 0 L7 18 h9 L12 36 L28 14 h-10 Z" fill="url(#iconGlow)" opacity="0.4"/>
  </g>

  <!-- Title -->
  <text x="72" y="54" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="700" fill="#ffffff">LETUS Task Watcher</text>

  <!-- Tagline -->
  <text x="32" y="80" font-family="system-ui, -apple-system, sans-serif" font-size="13" fill="#c4a8ff" letter-spacing="0.3">課題の締切を、見逃さない。</text>

  <!-- Card 1: 24h -->
  <rect x="32" y="106" width="116" height="68" rx="10" fill="url(#card)" stroke="#863bff" stroke-width="1" stroke-opacity="0.5"/>
  <text x="44" y="127" font-family="system-ui, sans-serif" font-size="10" fill="#c4a8ff">24時間以内</text>
  <text x="44" y="149" font-family="system-ui, sans-serif" font-size="28" font-weight="700" fill="#ff6b6b">2</text>
  <text x="72" y="149" font-family="system-ui, sans-serif" font-size="12" fill="#888" dy="-2">件</text>
  <rect x="44" y="158" width="92" height="6" rx="3" fill="#ff6b6b" opacity="0.25"/>
  <rect x="44" y="158" width="52" height="6" rx="3" fill="#ff6b6b"/>

  <!-- Card 2: 今週 -->
  <rect x="160" y="106" width="116" height="68" rx="10" fill="url(#card)" stroke="#47bfff" stroke-width="1" stroke-opacity="0.4"/>
  <text x="172" y="127" font-family="system-ui, sans-serif" font-size="10" fill="#a0d4ff">今週</text>
  <text x="172" y="149" font-family="system-ui, sans-serif" font-size="28" font-weight="700" fill="#47bfff">5</text>
  <text x="200" y="149" font-family="system-ui, sans-serif" font-size="12" fill="#888" dy="-2">件</text>
  <rect x="172" y="158" width="92" height="6" rx="3" fill="#47bfff" opacity="0.25"/>
  <rect x="172" y="158" width="68" height="6" rx="3" fill="#47bfff"/>

  <!-- Card 3: 対象コース -->
  <rect x="288" y="106" width="116" height="68" rx="10" fill="url(#card)" stroke="#a855f7" stroke-width="1" stroke-opacity="0.4"/>
  <text x="300" y="127" font-family="system-ui, sans-serif" font-size="10" fill="#c4a8ff">対象コース</text>
  <text x="300" y="149" font-family="system-ui, sans-serif" font-size="28" font-weight="700" fill="#c084fc">8</text>
  <text x="328" y="149" font-family="system-ui, sans-serif" font-size="12" fill="#888" dy="-2">科目</text>
  <rect x="300" y="158" width="92" height="6" rx="3" fill="#a855f7" opacity="0.25"/>
  <rect x="300" y="158" width="76" height="6" rx="3" fill="#a855f7"/>

  <!-- Assignment item row -->
  <rect x="32" y="192" width="376" height="36" rx="8" fill="#1e1036" stroke="#2a1a4a" stroke-width="1"/>
  <rect x="44" y="204" width="6" height="12" rx="2" fill="#ff6b6b"/>
  <text x="58" y="215" font-family="system-ui, sans-serif" font-size="12" fill="#e0d0ff">第3回レポート提出</text>
  <text x="320" y="215" font-family="system-ui, sans-serif" font-size="11" fill="#ff6b6b" font-weight="600">あと 2時間</text>

  <!-- Bottom row -->
  <rect x="32" y="236" width="376" height="28" rx="8" fill="#1e1036" stroke="#2a1a4a" stroke-width="1"/>
  <rect x="44" y="245" width="6" height="12" rx="2" fill="#47bfff"/>
  <text x="58" y="256" font-family="system-ui, sans-serif" font-size="12" fill="#e0d0ff">確認テスト（第5回）</text>
  <text x="320" y="256" font-family="system-ui, sans-serif" font-size="11" fill="#888">明日 23:59</text>
</svg>
`

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 440 },
})

const png = resvg.render()
const buffer = png.asPng()

const outPath = path.join(root, 'store-promo.png')
fs.writeFileSync(outPath, buffer)
console.log(`Written: ${outPath} (${buffer.length} bytes)`)
