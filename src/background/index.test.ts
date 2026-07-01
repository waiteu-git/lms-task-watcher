import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Assignment, AssignmentCandidate, Course } from '../core/types'
import {
  ASSIGNMENT_CANDIDATES_KEY,
  ASSIGNMENTS_KEY,
  COURSES_KEY,
  DEADLINE_SCAN_STATUS_KEY,
} from './storageKeys'

const store: Record<string, unknown> = {}

const notificationsCreate = vi.fn(
  (_id: string, _options: unknown, callback?: () => void) => {
    callback?.()
  },
)

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
    },
  },
  notifications: {
    create: notificationsCreate,
    onClicked: { addListener: vi.fn() },
    onClosed: { addListener: vi.fn() },
  },
  alarms: {
    create: vi.fn(),
    get: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  },
  runtime: {
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    onMessage: { addListener: vi.fn() },
    getURL: vi.fn((path: string) => path),
  },
  tabs: {
    create: vi.fn(),
  },
})

const {
  upsertAssignments,
  checkIsLoggedIn,
  scanAssignmentCandidatesInBackground,
  scanDeadlinesInBackground,
  ALARM_PERIOD_MINUTES,
} = await import('./index')

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: 'course-1',
    name: 'テスト講義',
    url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1',
    enabled: true,
    lmsType: 'moodle',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeCandidate(overrides: Partial<AssignmentCandidate> = {}): AssignmentCandidate {
  return {
    id: 'candidate-1',
    courseId: 'course-1',
    courseName: 'テスト講義',
    title: '課題1',
    url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1',
    sourceText: '課題1',
    detectedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'candidate-1',
    courseId: 'course-1',
    courseName: 'テスト講義',
    title: '課題1',
    url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1',
    deadline: null,
    deadlineText: '',
    sourceText: '課題1',
    submissionStatus: 'unknown',
    lifecycleStatus: 'active',
    detectedAt: '2026-01-01T00:00:00.000Z',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    lastCheckedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k])
  notificationsCreate.mockClear()
  vi.unstubAllGlobals()
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
      },
    },
    notifications: {
      create: notificationsCreate,
      onClicked: { addListener: vi.fn() },
      onClosed: { addListener: vi.fn() },
    },
    alarms: {
      create: vi.fn(),
      get: vi.fn(),
      onAlarm: { addListener: vi.fn() },
    },
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      getURL: vi.fn((path: string) => path),
    },
    tabs: {
      create: vi.fn(),
    },
  })
})

describe('ALARM_PERIOD_MINUTES', () => {
  it('1日(1440分)である', () => {
    expect(ALARM_PERIOD_MINUTES).toBe(1440)
  })
})

describe('upsertAssignments', () => {
  it('新規課題を保存する', async () => {
    const result = await upsertAssignments([makeAssignment()])
    expect(result).toHaveLength(1)
    expect(store[ASSIGNMENTS_KEY]).toEqual(result)
  })

  it('既存課題のfirstSeenAtを保持しつつ他のフィールドを更新する', async () => {
    store[ASSIGNMENTS_KEY] = [
      makeAssignment({ firstSeenAt: '2025-01-01T00:00:00.000Z', title: '旧タイトル' }),
    ]

    const result = await upsertAssignments([
      makeAssignment({ firstSeenAt: '2026-05-01T00:00:00.000Z', title: '新タイトル' }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].firstSeenAt).toBe('2025-01-01T00:00:00.000Z')
    expect(result[0].title).toBe('新タイトル')
  })

  it('既存課題のうち新規リストに含まれないものは保持する', async () => {
    store[ASSIGNMENTS_KEY] = [makeAssignment({ id: 'other', title: '他の課題' })]

    const result = await upsertAssignments([makeAssignment({ id: 'candidate-1' })])

    expect(result.map((a) => a.id).sort()).toEqual(['candidate-1', 'other'])
  })
})

describe('checkIsLoggedIn', () => {
  it('有効なコースがない場合はokを返す', async () => {
    const result = await checkIsLoggedIn([makeCourse({ enabled: false })])
    expect(result).toBe('ok')
  })

  it('ログイン済みの場合はokを返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1' })))
    const result = await checkIsLoggedIn([makeCourse()])
    expect(result).toBe('ok')
  })

  it('レスポンスURLに/login/を含む場合はlogin_requiredを返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, url: 'https://letus.ed.tus.ac.jp/login/index.php' })))
    const result = await checkIsLoggedIn([makeCourse()])
    expect(result).toBe('login_required')
  })

  it('fetchが例外を投げた場合はnetwork_errorを返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch') }))
    const result = await checkIsLoggedIn([makeCourse()])
    expect(result).toBe('network_error')
  })

  it('response.okがfalseの場合はnetwork_errorを返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1' })))
    const result = await checkIsLoggedIn([makeCourse()])
    expect(result).toBe('network_error')
  })
})

describe('scanAssignmentCandidatesInBackground', () => {
  it('スキャン中も既存の候補を空にしない(冒頭でクリアしない)', async () => {
    store[COURSES_KEY] = [makeCourse()]
    store[ASSIGNMENT_CANDIDATES_KEY] = [makeCandidate()]

    let sawEmptyDuringScan = false
    vi.stubGlobal('fetch', vi.fn(async () => {
      const candidatesDuringScan = store[ASSIGNMENT_CANDIDATES_KEY] as AssignmentCandidate[]
      if (candidatesDuringScan.length === 0) sawEmptyDuringScan = true
      return {
        ok: true,
        text: async () => '<a href="/mod/assign/view.php?id=1">課題1</a>',
      }
    }))

    await scanAssignmentCandidatesInBackground('standard')

    expect(sawEmptyDuringScan).toBe(false)
  })

  it('一部コースの取得失敗時、そのコースの既存候補を保持する', async () => {
    store[COURSES_KEY] = [
      makeCourse({ id: 'course-1', url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1' }),
      makeCourse({ id: 'course-2', url: 'https://letus.ed.tus.ac.jp/course/view.php?id=2', name: '講義2' }),
    ]
    store[ASSIGNMENT_CANDIDATES_KEY] = [
      makeCandidate({ id: 'cand-course-2', courseId: 'course-2', courseName: '講義2' }),
    ]

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('id=2')) {
        return { ok: false, text: async () => '' }
      }
      return { ok: true, text: async () => '<a href="/mod/assign/view.php?id=99">新課題</a>' }
    }))

    const result = await scanAssignmentCandidatesInBackground('standard')

    expect(result.ok).toBe(true)
    const saved = store[ASSIGNMENT_CANDIDATES_KEY] as AssignmentCandidate[]
    expect(saved.some((c) => c.id === 'cand-course-2')).toBe(true)
  })

  it('コースが無効化され対象外になった場合、そのコースの候補をスキャン完了時に除去する', async () => {
    store[COURSES_KEY] = [makeCourse({ id: 'course-1', enabled: false })]
    store[ASSIGNMENT_CANDIDATES_KEY] = [makeCandidate({ courseId: 'course-1' })]

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '' })))

    await scanAssignmentCandidatesInBackground('standard')

    const saved = store[ASSIGNMENT_CANDIDATES_KEY] as AssignmentCandidate[]
    expect(saved).toHaveLength(0)
  })
})

describe('scanDeadlinesInBackground', () => {
  it('未ログインの場合、assignmentsを変更せずエラー状態を保存する', async () => {
    store[COURSES_KEY] = [makeCourse()]
    store[ASSIGNMENT_CANDIDATES_KEY] = [makeCandidate()]
    store[ASSIGNMENTS_KEY] = [makeAssignment({ title: '既存の課題' })]

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, url: 'https://letus.ed.tus.ac.jp/login/index.php' })))

    const result = await scanDeadlinesInBackground()

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('login_required')
    expect(store[ASSIGNMENTS_KEY]).toEqual([makeAssignment({ title: '既存の課題' })])

    const status = store[DEADLINE_SCAN_STATUS_KEY] as { state: string; errorMessage: string | null }
    expect(status.state).toBe('error')
    expect(status.errorMessage).toBe('LETUSにログインしていないため更新できませんでした。')
  })

  it('通信エラーの場合、assignmentsを変更せずエラー状態を保存する', async () => {
    store[COURSES_KEY] = [makeCourse()]
    store[ASSIGNMENT_CANDIDATES_KEY] = [makeCandidate()]
    store[ASSIGNMENTS_KEY] = [makeAssignment({ title: '既存の課題' })]

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch') }))

    const result = await scanDeadlinesInBackground()

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('network_error')
    expect(store[ASSIGNMENTS_KEY]).toEqual([makeAssignment({ title: '既存の課題' })])

    const status = store[DEADLINE_SCAN_STATUS_KEY] as { state: string; errorMessage: string | null }
    expect(status.state).toBe('error')
    expect(status.errorMessage).toBe('LETUSへの通信に失敗しました。ネットワーク接続を確認してください。')
  })

  it('ログイン済みの場合、スキャン中も既存のassignmentsを空にしない', async () => {
    store[COURSES_KEY] = [makeCourse()]
    store[ASSIGNMENT_CANDIDATES_KEY] = [makeCandidate()]
    store[ASSIGNMENTS_KEY] = [makeAssignment()]

    let sawEmptyDuringScan = false
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('mod/assign')) {
        const assignmentsDuringScan = store[ASSIGNMENTS_KEY] as Assignment[]
        if (assignmentsDuringScan.length === 0) sawEmptyDuringScan = true
        return { ok: true, url, text: async () => '提出期限 2026年12月1日 23時59分' }
      }
      return { ok: true, url }
    }))

    await scanDeadlinesInBackground()

    expect(sawEmptyDuringScan).toBe(false)
  })

  it('候補一覧から消えた課題は、スキャン完了時にassignmentsから除去する', async () => {
    store[COURSES_KEY] = [makeCourse()]
    store[ASSIGNMENT_CANDIDATES_KEY] = [makeCandidate({ id: 'candidate-1' })]
    store[ASSIGNMENTS_KEY] = [
      makeAssignment({ id: 'candidate-1' }),
      makeAssignment({ id: 'removed-candidate', title: '削除された課題' }),
    ]

    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, url, text: async () => '' })))

    await scanDeadlinesInBackground()

    const saved = store[ASSIGNMENTS_KEY] as Assignment[]
    expect(saved.some((a) => a.id === 'removed-candidate')).toBe(false)
  })

  it('個別候補の取得失敗時、その課題の既存データを保持する', async () => {
    store[COURSES_KEY] = [makeCourse()]
    store[ASSIGNMENT_CANDIDATES_KEY] = [
      makeCandidate({ id: 'cand-1', url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1' }),
      makeCandidate({ id: 'cand-2', url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=2' }),
    ]
    store[ASSIGNMENTS_KEY] = [
      makeAssignment({ id: 'cand-2', title: '既存の課題2' }),
    ]

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('id=2')) return { ok: false, url, text: async () => '' }
      return { ok: true, url, text: async () => '' }
    }))

    await scanDeadlinesInBackground()

    const saved = store[ASSIGNMENTS_KEY] as Assignment[]
    const kept = saved.find((a) => a.id === 'cand-2')
    expect(kept?.title).toBe('既存の課題2')
  })
})
