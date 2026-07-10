import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Assignment, AssignmentCandidate, Course } from '../core/types'
import {
  ASSIGNMENT_CANDIDATES_KEY,
  ASSIGNMENTS_KEY,
  COURSES_KEY,
  DEADLINE_SCAN_STATUS_KEY,
  TERMS_CONSENT_KEY,
  WELCOME_GUIDE_SHOWN_KEY,
} from './storageKeys'
import { TABLE_MINIMAL } from '../core/timetable.fixtures'

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
      onChanged: { addListener: vi.fn() },
    },
    onChanged: { addListener: vi.fn() },
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
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
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
  handleInstalled,
  applyAutoSelect,
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
    deadlineSource: null,
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
        onChanged: { addListener: vi.fn() },
      },
      onChanged: { addListener: vi.fn() },
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
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
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
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1',
      text: async () => '<html>コース内容...</html>',
    })))
    const result = await checkIsLoggedIn([makeCourse()])
    expect(result).toBe('ok')
  })

  it('レスポンスURLに/login/を含む場合はlogin_requiredを返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, url: 'https://letus.ed.tus.ac.jp/login/index.php' })))
    const result = await checkIsLoggedIn([makeCourse()])
    expect(result).toBe('login_required')
  })

  it('URLはリダイレクトされないがゲスト閲覧で「ログインしていません」と表示される場合はlogin_requiredを返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1',
      text: async () => '<span>あなたはログインしていません。(<a href="/login/index.php">ログイン</a>)</span>',
    })))
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

  it('一部コースのfetchがCORS等で例外を投げても、スキャン全体は中断せず他コースを処理する', async () => {
    store[COURSES_KEY] = [
      makeCourse({ id: 'course-1', url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1' }),
      makeCourse({ id: 'course-2', url: 'https://letus.ed.tus.ac.jp/course/view.php?id=2', name: '講義2' }),
    ]
    store[ASSIGNMENT_CANDIDATES_KEY] = [
      makeCandidate({ id: 'cand-course-2', courseId: 'course-2', courseName: '講義2' }),
    ]

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('id=1')) {
        throw new TypeError('Failed to fetch')
      }
      return { ok: true, text: async () => '<a href="/mod/assign/view.php?id=99">新課題</a>' }
    }))

    const result = await scanAssignmentCandidatesInBackground('standard')

    expect(result.ok).toBe(true)
    const saved = store[ASSIGNMENT_CANDIDATES_KEY] as AssignmentCandidate[]
    expect(saved.some((c) => c.id === 'cand-course-2')).toBe(true)
    expect(saved.some((c) => c.courseId === 'course-2' && c.title === '新課題')).toBe(true)
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
      return { ok: true, url, text: async () => '' }
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

  it('個別候補のfetchがCORS等で例外を投げても、その課題の既存データを保持し他の候補は処理する', async () => {
    store[COURSES_KEY] = [makeCourse()]
    store[ASSIGNMENT_CANDIDATES_KEY] = [
      makeCandidate({ id: 'cand-1', url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1' }),
      makeCandidate({ id: 'cand-2', url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=2' }),
    ]
    store[ASSIGNMENTS_KEY] = [
      makeAssignment({ id: 'cand-2', title: '既存の課題2' }),
    ]

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('mod/assign') && url.includes('id=2')) {
        throw new TypeError('Failed to fetch')
      }
      return { ok: true, url, text: async () => '' }
    }))

    const result = await scanDeadlinesInBackground()

    expect(result.ok).toBe(true)
    const saved = store[ASSIGNMENTS_KEY] as Assignment[]
    const kept = saved.find((a) => a.id === 'cand-2')
    expect(kept?.title).toBe('既存の課題2')
    expect(saved.some((a) => a.id === 'cand-1')).toBe(true)
  })
})

describe('handleInstalled', () => {
  it('新規インストール時はwelcome.htmlを開きフラグを保存する', async () => {
    await handleInstalled({ reason: 'install' } as chrome.runtime.InstalledDetails)

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'welcome.html' })
    expect(store[WELCOME_GUIDE_SHOWN_KEY]).toBe(true)
  })

  it('アップデート時にフラグ未保存ならwelcome.htmlを開きフラグを保存する', async () => {
    await handleInstalled({ reason: 'update' } as chrome.runtime.InstalledDetails)

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'welcome.html' })
    expect(chrome.tabs.create).not.toHaveBeenCalledWith({ url: 'changelog.html' })
    expect(store[WELCOME_GUIDE_SHOWN_KEY]).toBe(true)
  })

  it('アップデート時にフラグ保存済みならchangelog.htmlを開く', async () => {
    store[WELCOME_GUIDE_SHOWN_KEY] = true

    await handleInstalled({ reason: 'update' } as chrome.runtime.InstalledDetails)

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'changelog.html' })
    expect(chrome.tabs.create).not.toHaveBeenCalledWith({ url: 'welcome.html' })
  })

  it('理由によらず定期スキャンのアラームを作成する', async () => {
    await handleInstalled({ reason: 'install' } as chrome.runtime.InstalledDetails)

    expect(chrome.alarms.create).toHaveBeenCalledWith(
      expect.any(String),
      { delayInMinutes: ALARM_PERIOD_MINUTES, periodInMinutes: ALARM_PERIOD_MINUTES },
    )
  })
})

describe('applyAutoSelect', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })
  it('時間割にあるコースを自動ONし保存する', async () => {
    store[COURSES_KEY] = [makeCourse({ id: 'a', name: '9973337 電気数学', enabled: false })]
    store['timetable:2026:zenki'] = { rawTableHtml: TABLE_MINIMAL, jigenText: '', capturedAt: '2026-07-08T00:00:00.000Z' }
    await applyAutoSelect(new Date('2026-07-08T10:00:00+09:00'))
    const saved = store[COURSES_KEY] as Course[]
    expect(saved[0].enabled).toBe(true)
  })
  it('時間割未取得なら何もしない', async () => {
    store[COURSES_KEY] = [makeCourse({ id: 'a', name: '9973337 電気数学', enabled: false })]
    await applyAutoSelect(new Date('2026-07-08T10:00:00+09:00'))
    const saved = store[COURSES_KEY] as Course[]
    expect(saved[0].enabled).toBe(false)
  })
})

describe('未同意時の収集ガード', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('未同意なら runAutoScan は何も収集せずに return する', async () => {
    // storage は termsConsent 未設定を返す
    const getSpy = vi.fn().mockResolvedValue({})
    vi.stubGlobal('chrome', {
      ...globalThis.chrome,
      storage: { ...globalThis.chrome.storage, local: { ...globalThis.chrome.storage.local, get: getSpy } },
    })
    const mod = await import('./index')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await mod.runAutoScan()

    expect(fetchSpy).not.toHaveBeenCalled()
    // 同意ガードで止まった証拠：COURSES_KEY では呼ばれない
    // （TERMS_CONSENT_KEY での同意チェックだけで終わる）
    expect(getSpy).not.toHaveBeenCalledWith(COURSES_KEY)
  })

  it('同意済みなら runAutoScan はコース取得まで進む', async () => {
    const getSpy = vi.fn().mockResolvedValue({
      [TERMS_CONSENT_KEY]: { version: 1, acceptedAt: '2026-07-10T00:00:00.000Z' },
      [COURSES_KEY]: [],
    })
    vi.stubGlobal('chrome', {
      ...globalThis.chrome,
      storage: { ...globalThis.chrome.storage, local: { ...globalThis.chrome.storage.local, get: getSpy } },
    })
    const mod = await import('./index')

    await mod.runAutoScan()

    // 同意ガードを通過して getCourses() まで到達したことを確認
    // enabledCourses が空なので scan本体は実行されないが、COURSES_KEY で呼ばれたことが証拠
    expect(getSpy).toHaveBeenCalledWith(COURSES_KEY)
  })

  it('updateConsentBadge は未同意なら "!" を、同意済みなら "" を設定する', async () => {
    const setBadgeText = vi.fn().mockResolvedValue(undefined)
    const setBadgeBackgroundColor = vi.fn().mockResolvedValue(undefined)
    const getSpy = vi.fn().mockResolvedValue({})
    vi.stubGlobal('chrome', {
      ...globalThis.chrome,
      action: { setBadgeText, setBadgeBackgroundColor },
      storage: { ...globalThis.chrome.storage, local: { ...globalThis.chrome.storage.local, get: getSpy } },
    })
    const mod = await import('./index')

    await mod.updateConsentBadge()
    expect(setBadgeText).toHaveBeenCalledWith({ text: '!' })

    getSpy.mockResolvedValue({
      [TERMS_CONSENT_KEY]: { version: 1, acceptedAt: '2026-07-10T00:00:00.000Z' },
    })
    await mod.updateConsentBadge()
    expect(setBadgeText).toHaveBeenLastCalledWith({ text: '' })
  })
})
