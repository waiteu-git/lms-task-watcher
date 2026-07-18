import { describe, it, expect } from 'vitest'
import {
  buildBannerContent,
  buildInfoNotes,
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

/** infoCodes だけ差し替えた健全状態（activeCodes空）を作るヘルパ */
function infoStateWith(
  infoCodes: DiagnosticCode[],
  overrides: Partial<DiagnosticsState> = {},
): DiagnosticsState {
  return {
    lastGoodAt: T_GOOD,
    consecutiveFailures: 0,
    activeCodes: [],
    infoCodes,
    lastCodes: infoCodes,
    updatedAt: T_NOW,
    ...overrides,
  }
}

describe('buildInfoNotes: 非表示（空配列）', () => {
  it('state=null（未スキャン・保存無し）では出さない', () => {
    expect(buildInfoNotes(null)).toEqual([])
  })

  it('infoCodes が空（健全・注記なし）では出さない', () => {
    expect(buildInfoNotes(infoStateWith([]))).toEqual([])
  })

  it('activeCodes 非空（警告バナー表示中）は infoCodes があっても出さない（重複排除）', () => {
    const state = infoStateWith(['UNSUPPORTED_MODULE'], {
      activeCodes: ['DASHBOARD_UNREADABLE'],
      consecutiveFailures: 2,
    })
    expect(buildInfoNotes(state)).toEqual([])
  })
})

describe('buildInfoNotes: 既知 info コードの文言（spec§0「未対応と正直に示す」の実配線）', () => {
  it('UNSUPPORTED_MODULE で未対応注記を返す（バナー unsupported と同一文）', () => {
    const notes = buildInfoNotes(infoStateWith(['UNSUPPORTED_MODULE']))
    expect(notes).toEqual([
      {
        code: 'UNSUPPORTED_MODULE',
        text: '一部の活動はまだ締切の自動取得に対応していません。',
      },
    ])
    // バナー防御枝（旧形式データ）と同じ文言＝単一情報源の確認
    expect(notes[0].text).toBe(
      buildBannerContent(stateWith(['UNSUPPORTED_MODULE'])).body,
    )
  })

  it('DEADLINE_KEYWORD_NO_DATE で日時未読取の注記を返す', () => {
    expect(buildInfoNotes(infoStateWith(['DEADLINE_KEYWORD_NO_DATE']))).toEqual([
      {
        code: 'DEADLINE_KEYWORD_NO_DATE',
        text: '一部の活動で締切らしい記載を見つけましたが、日時を読み取れませんでした。',
      },
    ])
  })

  it('COURSE_LOST_ALL_ASSIGNMENTS で last-good 保持の注記を返す（正当な非表示化でも発火するため断定しない）', () => {
    expect(buildInfoNotes(infoStateWith(['COURSE_LOST_ALL_ASSIGNMENTS']))).toEqual([
      {
        code: 'COURSE_LOST_ALL_ASSIGNMENTS',
        text: '一部のコースで課題が見つからなくなりました。以前に取得した課題は引き続き表示しています。',
      },
    ])
  })
})

describe('buildInfoNotes: 複数コード・順序・未知コード', () => {
  it('複数コードは全件を固定順（unsupported 先頭）で返し、入力順に依存しない', () => {
    const a = buildInfoNotes(
      infoStateWith(['COURSE_LOST_ALL_ASSIGNMENTS', 'UNSUPPORTED_MODULE']),
    )
    const b = buildInfoNotes(
      infoStateWith(['UNSUPPORTED_MODULE', 'COURSE_LOST_ALL_ASSIGNMENTS']),
    )
    expect(a.map((n) => n.code)).toEqual([
      'UNSUPPORTED_MODULE',
      'COURSE_LOST_ALL_ASSIGNMENTS',
    ])
    expect(a).toEqual(b)
  })

  it('未知の info コード（将来の階級再分類等）は汎用文へ倒す（黙って落とさない）', () => {
    const future = 'SOME_FUTURE_INFO_CODE' as DiagnosticCode
    expect(buildInfoNotes(infoStateWith([future]))).toEqual([
      { code: future, text: '一部の情報を自動取得できていない可能性があります。' },
    ])
  })

  it('未知コードが複数あっても同一の汎用文は1つに束ねる', () => {
    const f1 = 'FUTURE_A' as DiagnosticCode
    const f2 = 'FUTURE_B' as DiagnosticCode
    const notes = buildInfoNotes(infoStateWith([f1, f2]))
    expect(notes).toHaveLength(1)
    expect(notes[0].text).toBe('一部の情報を自動取得できていない可能性があります。')
  })

  it('既知コードと未知コードの混在では既知の固定順→未知の順で全文言が出る', () => {
    const future = 'FUTURE_A' as DiagnosticCode
    const notes = buildInfoNotes(
      infoStateWith([future, 'UNSUPPORTED_MODULE', 'DEADLINE_KEYWORD_NO_DATE']),
    )
    expect(notes.map((n) => n.code)).toEqual([
      'UNSUPPORTED_MODULE',
      'DEADLINE_KEYWORD_NO_DATE',
      future,
    ])
    expect(new Set(notes.map((n) => n.text)).size).toBe(3)
  })

  it('state を変異させない', () => {
    const state = infoStateWith(['UNSUPPORTED_MODULE', 'DEADLINE_KEYWORD_NO_DATE'])
    const snapshot = structuredClone(state)
    buildInfoNotes(state)
    expect(state).toEqual(snapshot)
  })
})
