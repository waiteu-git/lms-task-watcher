import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Course } from '../core/types'

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
      onChanged: { addListener: vi.fn() },
    },
    onChanged: { addListener: vi.fn() },
  },
  notifications: { create: vi.fn(), onClicked: { addListener: vi.fn() }, onClosed: { addListener: vi.fn() } },
  alarms: { create: vi.fn(), get: vi.fn(), onAlarm: { addListener: vi.fn() } },
  action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
  runtime: { onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() }, onMessage: { addListener: vi.fn() }, getURL: vi.fn((p: string) => p) },
  tabs: { create: vi.fn() },
})

const { checkIsLoggedIn } = await import('./index')

const courses: Course[] = [
  {
    id: 'c1',
    name: 'X',
    url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1',
    enabled: true,
  } as Course,
]

afterEach(() => vi.unstubAllGlobals())

describe('checkIsLoggedIn', () => {
  it('未ログインで外部SSOへリダイレクト(opaqueredirect)なら login_required', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'opaqueredirect', ok: false, url: '', text: async () => '' })) as unknown as typeof fetch)
    expect(await checkIsLoggedIn(courses)).toBe('login_required')
  })
  it('/login/ に着地したら login_required', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'basic', ok: true, url: 'https://letus.ed.tus.ac.jp/login/index.php', text: async () => '' })) as unknown as typeof fetch)
    expect(await checkIsLoggedIn(courses)).toBe('login_required')
  })
  it('200だが未ログイン文言を含むなら login_required', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'basic', ok: true, url: courses[0].url, text: async () => 'あなたはログインしていません' })) as unknown as typeof fetch)
    expect(await checkIsLoggedIn(courses)).toBe('login_required')
  })
  it('正常な200・課題ページなら ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'basic', ok: true, url: courses[0].url, text: async () => '<html>コース</html>' })) as unknown as typeof fetch)
    expect(await checkIsLoggedIn(courses)).toBe('ok')
  })
  it('fetch例外は network_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }) as unknown as typeof fetch)
    expect(await checkIsLoggedIn(courses)).toBe('network_error')
  })
  it('5xxは network_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'basic', ok: false, url: courses[0].url, text: async () => '' })) as unknown as typeof fetch)
    expect(await checkIsLoggedIn(courses)).toBe('network_error')
  })
})
