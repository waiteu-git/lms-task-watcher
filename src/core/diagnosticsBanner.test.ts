import { describe, it, expect } from 'vitest'
import {
  buildBannerContent,
  type BannerContent,
  type BannerKind,
} from './diagnosticsBanner'
import type { DiagnosticsState } from './diagnosticsState'
import type { DiagnosticCode } from './diagnose'

const T_GOOD = '2026-07-18T10:00:00.000Z'
const T_NOW = '2026-07-18T12:00:00.000Z'

/** activeCodes だけ差し替えた DiagnosticsState を作るヘルパ */
function stateWith(
  activeCodes: DiagnosticCode[],
  overrides: Partial<DiagnosticsState> = {},
): DiagnosticsState {
  return {
    lastGoodAt: T_GOOD,
    consecutiveFailures: activeCodes.length > 0 ? 2 : 0,
    activeCodes,
    infoCodes: [],
    lastCodes: activeCodes,
    updatedAt: T_NOW,
    ...overrides,
  }
}

describe('buildBannerContent: 非表示（kind: none）', () => {
  it('state=null（未スキャン・保存無し）では表示しない', () => {
    expect(buildBannerContent(null)).toEqual({
      kind: 'none',
      title: '',
      body: '',
      lastGoodAt: null,
    } satisfies BannerContent)
  })

  it('activeCodes が空（健全状態）では表示しない', () => {
    expect(buildBannerContent(stateWith([])).kind).toBe('none')
  })

  it('infoCodes だけがある状態（activeCodes空）では表示しない（カバレッジ注記は警告にしない）', () => {
    const state = stateWith([], { infoCodes: ['UNSUPPORTED_MODULE'] })
    expect(buildBannerContent(state).kind).toBe('none')
  })

  it('lastCodes に hard コードが残っていても activeCodes が空なら表示しない（debounce尊重）', () => {
    // 単発失敗（閾値未満）: lastCodes には観測が残るが activeCodes は空。
    const state = stateWith([], {
      consecutiveFailures: 1,
      lastCodes: ['DASHBOARD_UNREADABLE'],
    })
    expect(buildBannerContent(state).kind).toBe('none')
  })

  it('kind: none では lastGoodAt も null（何も描画させない）', () => {
    const state = stateWith([], { lastGoodAt: T_GOOD })
    expect(buildBannerContent(state).lastGoodAt).toBeNull()
  })
})

describe('buildBannerContent: logged_out', () => {
  it('LOGGED_OUT で再ログインを促す非技術的な文言を返す', () => {
    expect(buildBannerContent(stateWith(['LOGGED_OUT']))).toEqual({
      kind: 'logged_out',
      title: 'LETUSからログアウトされています',
      body: 'LETUSにログインし直すと自動的に再開します。',
      lastGoodAt: T_GOOD,
    } satisfies BannerContent)
  })
})

describe('buildBannerContent: unreadable（画面構成変更の可能性）', () => {
  const unreadableCodes: DiagnosticCode[] = [
    'DASHBOARD_UNREADABLE',
    'COURSE_PAGE_NO_ACTIVITIES',
    'NOT_A_MOODLE_PAGE',
    'DEADLINE_KEYWORD_NO_DATE',
    'COURSE_LOST_ALL_ASSIGNMENTS',
  ]

  it.each(unreadableCodes)('%s 単独で unreadable になる', (code) => {
    const content = buildBannerContent(stateWith([code]))
    expect(content.kind).toBe('unreadable')
    expect(content.title).toBe('LETUSの情報を読み取れませんでした')
    expect(content.body).toBe(
      'LETUSの画面構成が変わった可能性があり、一部の情報を読み取れませんでした。表示中のデータは最後に取得できた時点のものです。',
    )
    expect(content.lastGoodAt).toBe(T_GOOD)
  })

  it('将来追加される未知の hard コードも unreadable へ倒す（黙って none にしない）', () => {
    const future = 'SOME_FUTURE_CODE' as DiagnosticCode
    expect(buildBannerContent(stateWith([future])).kind).toBe('unreadable')
  })
})

describe('buildBannerContent: unsupported（未対応モジュール）', () => {
  it('UNSUPPORTED_MODULE 単独（旧形式データ等）で unsupported になる', () => {
    const content = buildBannerContent(stateWith(['UNSUPPORTED_MODULE']))
    expect(content.kind).toBe('unsupported')
    expect(content.title).toBe('一部の活動は自動取得に未対応です')
    expect(content.body).toBe('一部の活動はまだ締切の自動取得に対応していません。')
    expect(content.lastGoodAt).toBe(T_GOOD)
  })
})

describe('buildBannerContent: 複数該当時の優先順位（logged_out > unreadable > unsupported）', () => {
  it('LOGGED_OUT + unreadable系 → logged_out（原因1つだけを示す）', () => {
    const state = stateWith(['DASHBOARD_UNREADABLE', 'LOGGED_OUT'])
    expect(buildBannerContent(state).kind).toBe('logged_out')
  })

  it('LOGGED_OUT + UNSUPPORTED_MODULE → logged_out', () => {
    const state = stateWith(['UNSUPPORTED_MODULE', 'LOGGED_OUT'])
    expect(buildBannerContent(state).kind).toBe('logged_out')
  })

  it('unreadable系 + UNSUPPORTED_MODULE → unreadable', () => {
    const state = stateWith(['UNSUPPORTED_MODULE', 'NOT_A_MOODLE_PAGE'])
    expect(buildBannerContent(state).kind).toBe('unreadable')
  })

  it('LOGGED_OUT + unreadable系 + UNSUPPORTED_MODULE → logged_out（全部乗せでも最優先のみ）', () => {
    const state = stateWith([
      'UNSUPPORTED_MODULE',
      'COURSE_PAGE_NO_ACTIVITIES',
      'LOGGED_OUT',
    ])
    expect(buildBannerContent(state).kind).toBe('logged_out')
  })

  it('コードの並び順に依存しない（配列先頭でなく優先順位で決まる）', () => {
    const a = buildBannerContent(stateWith(['LOGGED_OUT', 'DASHBOARD_UNREADABLE']))
    const b = buildBannerContent(stateWith(['DASHBOARD_UNREADABLE', 'LOGGED_OUT']))
    expect(a.kind).toBe('logged_out')
    expect(b.kind).toBe('logged_out')
  })
})

describe('buildBannerContent: lastGoodAt の引き渡し', () => {
  it('lastGoodAt=null（一度も成功していない）でも kind はそのまま・lastGoodAt は null', () => {
    const state = stateWith(['LOGGED_OUT'], { lastGoodAt: null })
    const content = buildBannerContent(state)
    expect(content.kind).toBe('logged_out')
    expect(content.lastGoodAt).toBeNull()
  })

  it('表示対象の kind では state.lastGoodAt をそのまま返す（整形はUI側の責務）', () => {
    const state = stateWith(['NOT_A_MOODLE_PAGE'], { lastGoodAt: T_GOOD })
    expect(buildBannerContent(state).lastGoodAt).toBe(T_GOOD)
  })
})

describe('buildBannerContent: 純粋性と網羅性', () => {
  it('state を変異させない', () => {
    const state = stateWith(['LOGGED_OUT', 'DASHBOARD_UNREADABLE'])
    const snapshot = structuredClone(state)
    buildBannerContent(state)
    expect(state).toEqual(snapshot)
  })

  it('表示対象の全 kind で title/body が空でない（空バナーを出さない）', () => {
    const kinds: Array<[DiagnosticCode, BannerKind]> = [
      ['LOGGED_OUT', 'logged_out'],
      ['DASHBOARD_UNREADABLE', 'unreadable'],
      ['UNSUPPORTED_MODULE', 'unsupported'],
    ]
    for (const [code, kind] of kinds) {
      const content = buildBannerContent(stateWith([code]))
      expect(content.kind).toBe(kind)
      expect(content.title.length).toBeGreaterThan(0)
      expect(content.body.length).toBeGreaterThan(0)
    }
  })
})
