import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Course } from '../core/types'
import { COURSES_KEY, TERMS_CONSENT_KEY } from './storageKeys'
import { TERMS_VERSION } from '../legal/termsVersion'
import {
  DIAGNOSTICS_STATE_KEY,
  ESCALATION_THRESHOLD,
  type DiagnosticsState,
} from '../core/diagnosticsState'

/**
 * COURSE_DETECTION_EMPTY（content script の0コース能動報告・spec§6 T4）の背景側配線テスト。
 * onMessage リスナーを捕まえて直接ディスパッチし、同意ゲート・コース面判定・
 * diagnoseDashboard 経由の台帳畳み込みを検証する。
 */

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | undefined

const store: Record<string, unknown> = {}
let messageListener: MessageListener | undefined

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const result: Record<string, unknown> = {}
        const keyList = Array.isArray(keys) ? keys : [keys]
        for (const k of keyList) result[k] = store[k]
        return result
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(store, obj)
      }),
      onChanged: { addListener: vi.fn() },
    },
    onChanged: { addListener: vi.fn() },
  },
  notifications: { create: vi.fn(), onClicked: { addListener: vi.fn() }, onClosed: { addListener: vi.fn() } },
  alarms: { create: vi.fn(), get: vi.fn(), onAlarm: { addListener: vi.fn() } },
  action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
  runtime: {
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    onMessage: {
      addListener: (fn: MessageListener) => {
        messageListener = fn
      },
    },
    getURL: vi.fn((p: string) => p),
  },
  tabs: { create: vi.fn() },
})

await import('./index')

const consent = { version: TERMS_VERSION, acceptedAt: '2026-07-10T00:00:00.000Z' }

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: 'course-1',
    name: 'テスト講義',
    url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1',
    enabled: true,
    lmsType: 'letus',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** リスナーへディスパッチし、sendResponse の応答を待つ（非同期応答＝return true 前提） */
async function dispatch(message: unknown): Promise<unknown> {
  if (!messageListener) throw new Error('onMessage listener not registered')
  const response = await new Promise<unknown>((resolve) => {
    const returned = messageListener!(message, {}, resolve)
    // 同意ゲート経由の非同期応答パターン（COLLECTING_MESSAGES）を踏襲していること
    expect(returned).toBe(true)
  })
  // sendResponse 後に fire-and-forget で走る台帳畳み込みの完了を待つ
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
  return response
}

function getLedger(): DiagnosticsState | undefined {
  return store[DIAGNOSTICS_STATE_KEY] as DiagnosticsState | undefined
}

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k])
})

describe('COURSE_DETECTION_EMPTY 受信配線', () => {
  it('未同意なら consent_required で拒否し、台帳に何も記録しない', async () => {
    store[COURSES_KEY] = [makeCourse()]

    const response = await dispatch({ type: 'COURSE_DETECTION_EMPTY', path: '/my/' })

    expect(response).toEqual({ ok: false, reason: 'consent_required' })
    expect(getLedger()).toBeUndefined()
  })

  it('コース面以外のパスは not_dashboard で拒否する（ノイズ防止）', async () => {
    store[TERMS_CONSENT_KEY] = consent
    store[COURSES_KEY] = [makeCourse()]

    const response = await dispatch({
      type: 'COURSE_DETECTION_EMPTY',
      path: '/course/view.php',
    })

    expect(response).toEqual({ ok: false, reason: 'not_dashboard' })
    expect(getLedger()).toBeUndefined()
  })

  it('path が文字列でない不正メッセージも not_dashboard で拒否する', async () => {
    store[TERMS_CONSENT_KEY] = consent
    store[COURSES_KEY] = [makeCourse()]

    const response = await dispatch({ type: 'COURSE_DETECTION_EMPTY' })

    expect(response).toEqual({ ok: false, reason: 'not_dashboard' })
    expect(getLedger()).toBeUndefined()
  })

  it('既知コースありのコース面0件は DASHBOARD_UNREADABLE の失敗観測として畳み込む', async () => {
    store[TERMS_CONSENT_KEY] = consent
    store[COURSES_KEY] = [makeCourse()]

    const response = await dispatch({ type: 'COURSE_DETECTION_EMPTY', path: '/my/' })

    expect(response).toEqual({ ok: true })
    const ledger = getLedger()
    expect(ledger?.consecutiveFailures).toBe(1)
    expect(ledger?.lastCodes).toEqual(['DASHBOARD_UNREADABLE'])
    // 単発ではバナーを出さない（ESCALATION_THRESHOLD 未満）
    expect(ledger?.activeCodes).toEqual([])
  })

  it('閾値回連続の報告で activeCodes へ昇格する（debounce 規則の継承）', async () => {
    store[TERMS_CONSENT_KEY] = consent
    store[COURSES_KEY] = [makeCourse()]

    for (let i = 0; i < ESCALATION_THRESHOLD; i++) {
      await dispatch({ type: 'COURSE_DETECTION_EMPTY', path: '/my/courses.php' })
    }

    const ledger = getLedger()
    expect(ledger?.consecutiveFailures).toBe(ESCALATION_THRESHOLD)
    expect(ledger?.activeCodes).toEqual(['DASHBOARD_UNREADABLE'])
  })

  it('既知コース0件（初回利用の正当な空）は中立スキップ＝台帳を書かない', async () => {
    store[TERMS_CONSENT_KEY] = consent
    store[COURSES_KEY] = []

    const response = await dispatch({ type: 'COURSE_DETECTION_EMPTY', path: '/my/' })

    expect(response).toEqual({ ok: true })
    expect(getLedger()).toBeUndefined()
  })

  it('中立スキップは既存の台帳（lastGoodAt・activeCodes）を消さない', async () => {
    store[TERMS_CONSENT_KEY] = consent
    store[COURSES_KEY] = []
    const existing: DiagnosticsState = {
      lastGoodAt: '2026-07-01T00:00:00.000Z',
      consecutiveFailures: 2,
      activeCodes: ['NOT_A_MOODLE_PAGE'],
      infoCodes: [],
      lastCodes: ['NOT_A_MOODLE_PAGE'],
      updatedAt: '2026-07-01T00:00:00.000Z',
    }
    store[DIAGNOSTICS_STATE_KEY] = existing

    await dispatch({ type: 'COURSE_DETECTION_EMPTY', path: '/my/' })

    expect(getLedger()).toEqual(existing)
  })

  it.each(['/my', '/my/', '/my/index.php', '/my/courses.php'])(
    'コース面パス %s を受理する',
    async (path) => {
      store[TERMS_CONSENT_KEY] = consent
      store[COURSES_KEY] = [makeCourse()]

      const response = await dispatch({ type: 'COURSE_DETECTION_EMPTY', path })

      expect(response).toEqual({ ok: true })
      expect(getLedger()?.lastCodes).toEqual(['DASHBOARD_UNREADABLE'])
    },
  )
})
