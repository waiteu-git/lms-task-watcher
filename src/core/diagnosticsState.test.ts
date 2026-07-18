import { describe, it, expect } from 'vitest'
import {
  ESCALATION_THRESHOLD,
  DIAGNOSTICS_STATE_KEY,
  INFO_DIAGNOSTIC_CODES,
  isInfoDiagnosticCode,
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

describe('定数と階級区分', () => {
  it('ESCALATION_THRESHOLD は 2（spec§7: 単発の一過性失敗でバナーを出さない）', () => {
    expect(ESCALATION_THRESHOLD).toBe(2)
  })

  it('storageキーは diagnosticsState（タスク指定の固定キー）', () => {
    expect(DIAGNOSTICS_STATE_KEY).toBe('diagnosticsState')
  })

  it('info階級 = 健全なLETUSでも恒常発火し得るカバレッジ系3コード', () => {
    expect(INFO_DIAGNOSTIC_CODES).toEqual([
      'UNSUPPORTED_MODULE',
      'DEADLINE_KEYWORD_NO_DATE',
      'COURSE_LOST_ALL_ASSIGNMENTS',
    ])
    for (const code of INFO_DIAGNOSTIC_CODES) {
      expect(isInfoDiagnosticCode(code)).toBe(true)
    }
  })

  it('hard階級 = スキャン整合性の4コード（isInfoDiagnosticCode が false）', () => {
    const hard: DiagnosticCode[] = [
      'LOGGED_OUT',
      'NOT_A_MOODLE_PAGE',
      'DASHBOARD_UNREADABLE',
      'COURSE_PAGE_NO_ACTIVITIES',
    ]
    for (const code of hard) {
      expect(isInfoDiagnosticCode(code)).toBe(false)
    }
  })
})

describe('applyScanOutcome: 成功（hardコード無し）', () => {
  it('prev=null（初回）の成功で lastGoodAt/updatedAt を刻み全カウンタが0/空になる', () => {
    expect(applyScanOutcome(null, outcome([], T1))).toEqual({
      lastGoodAt: T1,
      consecutiveFailures: 0,
      activeCodes: [],
      infoCodes: [],
      lastCodes: [],
      updatedAt: T1,
    } satisfies DiagnosticsState)
  })

  it('失敗の蓄積後の成功で lastGoodAt を更新し consecutiveFailures/activeCodes/lastCodes を全クリアする', () => {
    const failing: DiagnosticsState = {
      lastGoodAt: T1,
      consecutiveFailures: 5,
      activeCodes: ['DASHBOARD_UNREADABLE'],
      infoCodes: [],
      lastCodes: ['DASHBOARD_UNREADABLE'],
      updatedAt: T2,
    }
    expect(applyScanOutcome(failing, outcome([], T3))).toEqual({
      lastGoodAt: T3,
      consecutiveFailures: 0,
      activeCodes: [],
      infoCodes: [],
      lastCodes: [],
      updatedAt: T3,
    })
  })

  it('LOGGED_OUT が active でも成功で即クリアされる（再ログイン後に警告を残さない）', () => {
    const loggedOut: DiagnosticsState = {
      lastGoodAt: null,
      consecutiveFailures: 1,
      activeCodes: ['LOGGED_OUT'],
      infoCodes: [],
      lastCodes: ['LOGGED_OUT'],
      updatedAt: T1,
    }
    const next = applyScanOutcome(loggedOut, outcome([], T2))
    expect(next.activeCodes).toEqual([])
    expect(next.lastGoodAt).toBe(T2)
  })

  it('infoコードのみの観測は成功として畳み込む（lastGoodAt更新・失敗カウンタ非駆動）', () => {
    // レビュー指摘の核心: 未対応モジュール型を含むコースがあるだけで毎スキャン
    // UNSUPPORTED_MODULE が出る。これを失敗に数えると lastGoodAt が恒久凍結する。
    expect(applyScanOutcome(null, outcome(['UNSUPPORTED_MODULE'], T1))).toEqual({
      lastGoodAt: T1,
      consecutiveFailures: 0,
      activeCodes: [],
      infoCodes: ['UNSUPPORTED_MODULE'],
      lastCodes: ['UNSUPPORTED_MODULE'],
      updatedAt: T1,
    } satisfies DiagnosticsState)
  })

  it('infoコードのみの観測は失敗streakも切る（hard無し=読めている）', () => {
    const fail1 = applyScanOutcome(null, outcome(['DASHBOARD_UNREADABLE'], T1))
    const next = applyScanOutcome(fail1, outcome(['UNSUPPORTED_MODULE'], T2))
    expect(next.consecutiveFailures).toBe(0)
    expect(next.lastGoodAt).toBe(T2)
    expect(next.activeCodes).toEqual([])
    expect(next.infoCodes).toEqual(['UNSUPPORTED_MODULE'])
  })

  it('infoコードが消えた成功で infoCodes は空へ置換される（古い注記を引きずらない）', () => {
    const withInfo = applyScanOutcome(null, outcome(['UNSUPPORTED_MODULE'], T1))
    const next = applyScanOutcome(withInfo, outcome([], T2))
    expect(next.infoCodes).toEqual([])
  })

  it('COURSE_LOST_ALL_ASSIGNMENTS は info（教員の全非表示という正当ケースで台帳を凍結しない）', () => {
    // skipSave により旧シグネチャが残り続けるため、このコードは正当ケースでも
    // 恒常発火する。lastGoodAt は毎サイクル進み、エスカレーションもしない。
    let state: DiagnosticsState | null = null
    for (const at of [T1, T2, T3, T4]) {
      state = applyScanOutcome(state, outcome(['COURSE_LOST_ALL_ASSIGNMENTS'], at))
    }
    expect(state?.lastGoodAt).toBe(T4)
    expect(state?.consecutiveFailures).toBe(0)
    expect(state?.activeCodes).toEqual([])
    expect(state?.infoCodes).toEqual(['COURSE_LOST_ALL_ASSIGNMENTS'])
  })
})

describe('applyScanOutcome: 失敗（hardコード有り）とエスカレーション', () => {
  it('成功状態からの単発失敗は記録するが activeCodes へは昇格しない（一過性失敗のdebounce）', () => {
    const good = applyScanOutcome(null, outcome([], T1))
    const next = applyScanOutcome(good, outcome(['DASHBOARD_UNREADABLE'], T2))
    expect(next).toEqual({
      lastGoodAt: T1, // last-good は保持（spec§7: 前回成功と今回失敗を区別）
      consecutiveFailures: 1,
      activeCodes: [],
      infoCodes: [],
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
      infoCodes: [],
      lastCodes: ['DASHBOARD_UNREADABLE'],
      updatedAt: T3,
    })
  })

  it('昇格後の3回目以降は最新観測の hard コードで activeCodes を置き換える（古い症状を引きずらない）', () => {
    const fail2: DiagnosticsState = {
      lastGoodAt: T1,
      consecutiveFailures: 2,
      activeCodes: ['DASHBOARD_UNREADABLE'],
      infoCodes: [],
      lastCodes: ['DASHBOARD_UNREADABLE'],
      updatedAt: T2,
    }
    const fail3 = applyScanOutcome(fail2, outcome(['NOT_A_MOODLE_PAGE'], T3))
    expect(fail3.consecutiveFailures).toBe(3)
    expect(fail3.activeCodes).toEqual(['NOT_A_MOODLE_PAGE'])
    expect(fail3.lastCodes).toEqual(['NOT_A_MOODLE_PAGE'])
  })

  it('失敗1回目と2回目で hard コードが異なっても連続失敗として数え、昇格時は今回のコードを載せる', () => {
    const fail1 = applyScanOutcome(null, outcome(['DASHBOARD_UNREADABLE'], T1))
    const fail2 = applyScanOutcome(fail1, outcome(['COURSE_PAGE_NO_ACTIVITIES'], T2))
    expect(fail2.consecutiveFailures).toBe(2)
    expect(fail2.activeCodes).toEqual(['COURSE_PAGE_NO_ACTIVITIES'])
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
    expect(next.infoCodes).toEqual(['UNSUPPORTED_MODULE'])
  })
})

describe('applyScanOutcome: hard/info 混在（レビュー指摘の遷移表）', () => {
  it('恒常infoコードは debounce を無効化しない（info成功続き→一過性hardは初回昇格しない）', () => {
    // レビュー指摘の再現: UNSUPPORTED_MODULE が毎サイクル出る利用者でも、
    // 単発の NOT_A_MOODLE_PAGE（プロキシ応答等の一過性）でバナーを出してはならない。
    let state: DiagnosticsState | null = null
    for (const at of [T1, T2, T3]) {
      state = applyScanOutcome(state, outcome(['UNSUPPORTED_MODULE'], at))
    }
    const blip = applyScanOutcome(state, outcome(['UNSUPPORTED_MODULE', 'NOT_A_MOODLE_PAGE'], T4))
    expect(blip.consecutiveFailures).toBe(1) // 恒常infoは失敗に数えていない
    expect(blip.activeCodes).toEqual([]) // debounce が生きている
    expect(blip.lastGoodAt).toBe(T3) // 直前まで毎サイクル成功
    expect(blip.infoCodes).toEqual(['UNSUPPORTED_MODULE'])
    expect(blip.lastCodes).toEqual(['UNSUPPORTED_MODULE', 'NOT_A_MOODLE_PAGE'])
  })

  it('hard+info 混在の連続失敗の昇格では activeCodes は hard のみ・info は infoCodes に載る', () => {
    const fail1 = applyScanOutcome(null, outcome(['NOT_A_MOODLE_PAGE'], T1))
    const fail2 = applyScanOutcome(
      fail1,
      outcome(['NOT_A_MOODLE_PAGE', 'UNSUPPORTED_MODULE'], T2),
    )
    expect(fail2.consecutiveFailures).toBe(2)
    expect(fail2.activeCodes).toEqual(['NOT_A_MOODLE_PAGE'])
    expect(fail2.infoCodes).toEqual(['UNSUPPORTED_MODULE'])
    expect(fail2.lastCodes).toEqual(['NOT_A_MOODLE_PAGE', 'UNSUPPORTED_MODULE'])
  })

  it('hard失敗時も infoCodes は最新観測で置換される（今回infoが無ければ空）', () => {
    const withInfo = applyScanOutcome(null, outcome(['UNSUPPORTED_MODULE'], T1))
    const hardFail = applyScanOutcome(withInfo, outcome(['LOGGED_OUT'], T2))
    expect(hardFail.infoCodes).toEqual([])
    expect(hardFail.lastCodes).toEqual(['LOGGED_OUT'])
  })

  it('旧形式の prev.activeCodes に info コードが混じっていても引き継がない（自己修復）', () => {
    // 旧仕様の保存データ想定: activeCodes に info コードが昇格済みで残っている
    const legacy: DiagnosticsState = {
      lastGoodAt: T1,
      consecutiveFailures: 0,
      activeCodes: ['UNSUPPORTED_MODULE'],
      infoCodes: [],
      lastCodes: ['UNSUPPORTED_MODULE'],
      updatedAt: T2,
    }
    // 単発hard失敗（閾値未満＝prev.activeCodes 引き継ぎ経路）で info は落ちる
    const fail1 = applyScanOutcome(legacy, outcome(['DASHBOARD_UNREADABLE'], T3))
    expect(fail1.consecutiveFailures).toBe(1)
    expect(fail1.activeCodes).toEqual([])
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

  it('LOGGED_OUT と info の同時観測では LOGGED_OUT が active・info は infoCodes に載る', () => {
    const next = applyScanOutcome(null, outcome(['LOGGED_OUT', 'UNSUPPORTED_MODULE'], T1))
    expect(next.activeCodes).toEqual(['LOGGED_OUT'])
    expect(next.infoCodes).toEqual(['UNSUPPORTED_MODULE'])
  })

  it('閾値到達時は LOGGED_OUT を含む全 hard コードが activeCodes に載る', () => {
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
      infoCodes: ['UNSUPPORTED_MODULE'],
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
