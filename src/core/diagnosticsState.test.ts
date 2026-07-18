import { describe, it, expect } from 'vitest'
import {
  ESCALATION_THRESHOLD,
  DIAGNOSTICS_STATE_KEY,
  applyScanOutcome,
  type DiagnosticsState,
} from './diagnosticsState'
import type { DiagnosticCode } from './diagnose'

const T1 = '2026-07-18T10:00:00.000Z'
const T2 = '2026-07-18T11:00:00.000Z'
const T3 = '2026-07-18T12:00:00.000Z'
const T4 = '2026-07-18T13:00:00.000Z'

function outcome(codes: DiagnosticCode[], at: string) {
  return { codes, at }
}

describe('定数', () => {
  it('ESCALATION_THRESHOLD は 2（spec§7: 単発の一過性失敗でバナーを出さない）', () => {
    expect(ESCALATION_THRESHOLD).toBe(2)
  })

  it('storageキーは diagnosticsState（タスク指定の固定キー）', () => {
    expect(DIAGNOSTICS_STATE_KEY).toBe('diagnosticsState')
  })
})

describe('applyScanOutcome: 成功（codes空）', () => {
  it('prev=null（初回）の成功で lastGoodAt/updatedAt を刻み全カウンタが0/空になる', () => {
    expect(applyScanOutcome(null, outcome([], T1))).toEqual({
      lastGoodAt: T1,
      consecutiveFailures: 0,
      activeCodes: [],
      lastCodes: [],
      updatedAt: T1,
    } satisfies DiagnosticsState)
  })

  it('失敗の蓄積後の成功で lastGoodAt を更新し consecutiveFailures/activeCodes/lastCodes を全クリアする', () => {
    const failing: DiagnosticsState = {
      lastGoodAt: T1,
      consecutiveFailures: 5,
      activeCodes: ['DASHBOARD_UNREADABLE'],
      lastCodes: ['DASHBOARD_UNREADABLE'],
      updatedAt: T2,
    }
    expect(applyScanOutcome(failing, outcome([], T3))).toEqual({
      lastGoodAt: T3,
      consecutiveFailures: 0,
      activeCodes: [],
      lastCodes: [],
      updatedAt: T3,
    })
  })

  it('LOGGED_OUT が active でも成功で即クリアされる（再ログイン後に警告を残さない）', () => {
    const loggedOut: DiagnosticsState = {
      lastGoodAt: null,
      consecutiveFailures: 1,
      activeCodes: ['LOGGED_OUT'],
      lastCodes: ['LOGGED_OUT'],
      updatedAt: T1,
    }
    const next = applyScanOutcome(loggedOut, outcome([], T2))
    expect(next.activeCodes).toEqual([])
    expect(next.lastGoodAt).toBe(T2)
  })
})

describe('applyScanOutcome: 失敗（codes非空）とエスカレーション', () => {
  it('成功状態からの単発失敗は記録するが activeCodes へは昇格しない（一過性失敗のdebounce）', () => {
    const good = applyScanOutcome(null, outcome([], T1))
    const next = applyScanOutcome(good, outcome(['DASHBOARD_UNREADABLE'], T2))
    expect(next).toEqual({
      lastGoodAt: T1, // last-good は保持（spec§7: 前回成功と今回失敗を区別）
      consecutiveFailures: 1,
      activeCodes: [],
      lastCodes: ['DASHBOARD_UNREADABLE'],
      updatedAt: T2,
    })
  })

  it('prev=null（初回スキャンが失敗）でも単発では昇格しない', () => {
    const next = applyScanOutcome(null, outcome(['NOT_A_MOODLE_PAGE'], T1))
    expect(next.consecutiveFailures).toBe(1)
    expect(next.activeCodes).toEqual([])
    expect(next.lastCodes).toEqual(['NOT_A_MOODLE_PAGE'])
    expect(next.lastGoodAt).toBeNull()
  })

  it('連続2回目の失敗で activeCodes へ昇格する（遷移表: 成功→失敗1→失敗2）', () => {
    const good = applyScanOutcome(null, outcome([], T1))
    const fail1 = applyScanOutcome(good, outcome(['DASHBOARD_UNREADABLE'], T2))
    const fail2 = applyScanOutcome(fail1, outcome(['DASHBOARD_UNREADABLE'], T3))
    expect(fail2).toEqual({
      lastGoodAt: T1,
      consecutiveFailures: 2,
      activeCodes: ['DASHBOARD_UNREADABLE'],
      lastCodes: ['DASHBOARD_UNREADABLE'],
      updatedAt: T3,
    })
  })

  it('昇格後の3回目以降は最新観測のコードで activeCodes を置き換える（古い症状を引きずらない）', () => {
    const fail2: DiagnosticsState = {
      lastGoodAt: T1,
      consecutiveFailures: 2,
      activeCodes: ['DASHBOARD_UNREADABLE'],
      lastCodes: ['DASHBOARD_UNREADABLE'],
      updatedAt: T2,
    }
    const fail3 = applyScanOutcome(fail2, outcome(['COURSE_LOST_ALL_ASSIGNMENTS'], T3))
    expect(fail3.consecutiveFailures).toBe(3)
    expect(fail3.activeCodes).toEqual(['COURSE_LOST_ALL_ASSIGNMENTS'])
    expect(fail3.lastCodes).toEqual(['COURSE_LOST_ALL_ASSIGNMENTS'])
  })

  it('失敗1回目と2回目でコードが異なっても連続失敗として数え、昇格時は今回のコードを載せる', () => {
    const fail1 = applyScanOutcome(null, outcome(['DASHBOARD_UNREADABLE'], T1))
    const fail2 = applyScanOutcome(fail1, outcome(['DEADLINE_KEYWORD_NO_DATE'], T2))
    expect(fail2.consecutiveFailures).toBe(2)
    expect(fail2.activeCodes).toEqual(['DEADLINE_KEYWORD_NO_DATE'])
  })

  it('失敗→成功→失敗は連続にならない（成功でカウンタが切れ、再度debounceが効く）', () => {
    const fail1 = applyScanOutcome(null, outcome(['DASHBOARD_UNREADABLE'], T1))
    const good = applyScanOutcome(fail1, outcome([], T2))
    const failAgain = applyScanOutcome(good, outcome(['DASHBOARD_UNREADABLE'], T3))
    expect(failAgain.consecutiveFailures).toBe(1)
    expect(failAgain.activeCodes).toEqual([])
    expect(failAgain.lastGoodAt).toBe(T2)
  })

  it('入力コードの重複は排除して記録する（複数コース横断で同じコードが集まる想定）', () => {
    const next = applyScanOutcome(
      null,
      outcome(['NOT_A_MOODLE_PAGE', 'NOT_A_MOODLE_PAGE', 'UNSUPPORTED_MODULE'], T1),
    )
    expect(next.lastCodes).toEqual(['NOT_A_MOODLE_PAGE', 'UNSUPPORTED_MODULE'])
  })
})

describe('applyScanOutcome: LOGGED_OUT の即時昇格例外', () => {
  it('単発失敗でも LOGGED_OUT は即 activeCodes に昇格する（ユーザーが対処可能な明確状態）', () => {
    const next = applyScanOutcome(null, outcome(['LOGGED_OUT'], T1))
    expect(next.consecutiveFailures).toBe(1)
    expect(next.activeCodes).toEqual(['LOGGED_OUT'])
    expect(next.lastCodes).toEqual(['LOGGED_OUT'])
  })

  it('LOGGED_OUT と他コードの同時観測では、閾値未満なら LOGGED_OUT だけを昇格する', () => {
    // ログアウト中は他の矛盾（0コース等）はログアウトの随伴症状。原因1つだけを正直に示す。
    const next = applyScanOutcome(null, outcome(['DASHBOARD_UNREADABLE', 'LOGGED_OUT'], T1))
    expect(next.activeCodes).toEqual(['LOGGED_OUT'])
    expect(next.lastCodes).toEqual(['DASHBOARD_UNREADABLE', 'LOGGED_OUT'])
  })

  it('閾値到達時は LOGGED_OUT を含む全コードが activeCodes に載る', () => {
    const fail1 = applyScanOutcome(null, outcome(['LOGGED_OUT'], T1))
    const fail2 = applyScanOutcome(fail1, outcome(['LOGGED_OUT', 'DASHBOARD_UNREADABLE'], T2))
    expect(fail2.activeCodes).toEqual(['LOGGED_OUT', 'DASHBOARD_UNREADABLE'])
  })
})

describe('applyScanOutcome: 純粋性', () => {
  it('prev オブジェクトを変異させない', () => {
    const prev: DiagnosticsState = {
      lastGoodAt: T1,
      consecutiveFailures: 1,
      activeCodes: [],
      lastCodes: ['DASHBOARD_UNREADABLE'],
      updatedAt: T2,
    }
    const snapshot = structuredClone(prev)
    applyScanOutcome(prev, outcome(['DASHBOARD_UNREADABLE'], T3))
    applyScanOutcome(prev, outcome([], T4))
    expect(prev).toEqual(snapshot)
  })

  it('outcome.codes 配列を変異させない', () => {
    const codes: DiagnosticCode[] = ['LOGGED_OUT', 'LOGGED_OUT']
    applyScanOutcome(null, outcome(codes, T1))
    expect(codes).toEqual(['LOGGED_OUT', 'LOGGED_OUT'])
  })
})
