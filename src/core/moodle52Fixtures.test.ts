/**
 * Moodle 5.2 実DOM fixture テスト（spec §6）。
 *
 * Mount Orange（school.moodledemo.net・Moodle 5.2）から採取した生HTMLのトリム版
 * （src/core/fixtures/moodle/・由来は同ディレクトリ README.md）を Vite `?raw` import で
 * 実関数に通し、BS5世代に対する現行パーサの「生存箇所」と「実ギャップ」を物証として固定する:
 * - RAW Dashboard はコースアンカー0件（発見面が全面クライアント描画）→ 診断が黙殺しない
 * - course/view.php の活動一覧は 5.2 でも SSR 維持 → 背景スキャンは生存
 * - JA assign の「期限:」年月日書式は現行パーサで取得可・EN書式は不能（診断の題材）
 * - 「まだ提出されていません。」は現行 extractSubmissionStatus で unknown（特性固定・P3で更新予定）
 *
 * 検証観点は spec §6 の原則「各fixtureでパース成功 OR 対応する自己診断が発火」（黙って空を返さない）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import my52Raw from './fixtures/moodle/my52_raw.html?raw'
import course52Raw from './fixtures/moodle/course52_raw.html?raw'
import assign52Ja from './fixtures/moodle/assign52_ja.html?raw'
import assign52En from './fixtures/moodle/assign52_en.html?raw'
import { extractLinksFromHtml } from './letusLinks'
import { computeCourseSignature, hasCourseMarker } from './courseUpdates'
import { htmlToPlainText } from './htmlText'
import { fingerprintPage } from './moodleFingerprint'
import { classifyFetchedPage } from './authProbe'
import { diagnoseDashboard, diagnoseCoursePage, diagnoseActivityPage } from './diagnose'
import { extractDeadlineText, parseDeadline } from '../background/deadlineParser'
import {
  ASSIGNMENT_CANDIDATES_KEY,
  ASSIGNMENTS_KEY,
  COURSES_KEY,
} from '../background/storageKeys'
import type { Assignment, AssignmentCandidate, Course } from './types'

// ─── chrome スタブ（scanDeadlinesInBackground の実経路テスト用・index.test.ts と同型） ───

const noopPacer = { acquire: async () => {} }

const store: Record<string, unknown> = {}

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
    create: vi.fn((_id: string, _options: unknown, callback?: () => void) => {
      callback?.()
    }),
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

const { scanDeadlinesInBackground } = await import('../background/index')

const COURSE_URL = 'https://school.moodledemo.net/course/view.php?id=62'
const ASSIGN_URL = 'https://school.moodledemo.net/mod/assign/view.php?id=724'

/** fixture の実assign（id=724）の締切: 2023年 12月 12日(火曜日) 00:00（JST・vitest.setup.ts でTZ固定） */
const EXPECTED_DEADLINE_ISO = new Date(2023, 11, 12, 0, 0, 0, 0).toISOString()

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k])
})

// ─── my52_raw.html: RAW Dashboard ────────────────────────────────────────────

describe('my52_raw.html（RAW /my/・BS5世代Dashboard）', () => {
  it('course/view.php アンカーが0件＝コース発見面が全面クライアント描画である物証', () => {
    const links = extractLinksFromHtml(my52Raw, 'https://school.moodledemo.net/my/')
    const courseAnchors = links.filter((l) => l.url.includes('/course/view.php'))
    expect(courseAnchors).toHaveLength(0)

    // SSR は19コース登録済みを知っている（block_myoverview のプレースホルダ属性）のに
    // アンカーは1件も出さない＝「正当な空」ではなく描画方式の変化であることの物証
    expect(my52Raw).toContain('data-totalcoursecount="19"')
    expect(my52Raw).toContain('block-myoverview')
    expect(my52Raw).toContain('loading-placeholder')
  })

  it('fingerprintPage: docsリンクが無く version null・bodyClasses は返る（body classフォールバックの実証）', () => {
    const fp = fingerprintPage(my52Raw)
    expect(fp.version).toBeNull()
    expect(fp.bs5).toBe(false)
    expect(fp.bodyClasses).toContain('path-my')
    expect(fp.bodyClasses).toContain('pagelayout-mydashboard')
  })

  it('診断原則: 0件を黙殺しない＝logged_in 分類＋既知コース有りで DASHBOARD_UNREADABLE が発火', () => {
    // M.cfg 行が原文維持されているので認証分類は logged_in
    expect(
      classifyFetchedPage({ finalUrl: 'https://school.moodledemo.net/my/', bodyText: my52Raw }),
    ).toBe('logged_in')

    const links = extractLinksFromHtml(my52Raw, 'https://school.moodledemo.net/my/')
    const courseAnchorCount = links.filter((l) => l.url.includes('/course/view.php')).length
    expect(
      diagnoseDashboard({ pageAuthState: 'logged_in', courseAnchorCount, knownCourseCount: 19 }),
    ).toEqual(['DASHBOARD_UNREADABLE'])
  })
})

// ─── course52_raw.html: course/view.php SSR活動一覧 ──────────────────────────

describe('course52_raw.html（RAW course/view.php・SSR活動一覧）', () => {
  it('mod-anchor 22件が生HTMLに存在し実抽出関数が全件拾う＝5.2でも背景スキャン生存の物証', () => {
    const modLinks = extractLinksFromHtml(course52Raw, COURSE_URL).filter((l) =>
      /\/mod\/[^/]+\/view\.php/.test(l.url),
    )
    expect(modLinks).toHaveLength(22)
  })

  it('computeCourseSignature: URL重複排除後20件・assign 4件を含む', () => {
    const sig = computeCourseSignature(course52Raw, COURSE_URL)
    // 22アンカー中 quiz(id=723) と glossary(id=719) がブロックと本文で重複 → 一意URLは20
    expect(sig).toHaveLength(20)
    expect(sig.filter((l) => l.url.includes('/mod/assign/'))).toHaveLength(4)
    expect(sig.map((l) => l.url)).toContain(ASSIGN_URL)
  })

  it('パース成功時は診断が発火しない（正当な読取と破損の区別）', () => {
    expect(hasCourseMarker(course52Raw)).toBe(true) // format-topics 等のbodyクラス
    const sig = computeCourseSignature(course52Raw, COURSE_URL)
    expect(
      diagnoseCoursePage({
        pageAuthState: 'logged_in',
        modAnchorCount: sig.length,
        prevSignatureLen: 20,
        hasCourseMarker: true,
      }),
    ).toEqual([])
  })
})

// ─── assign52_ja.html / assign52_en.html: 実flatten経路（純関数パイプライン） ─

describe('assign52_ja.html（JA assign・実flatten経路）', () => {
  it('htmlToPlainText→extractDeadlineText→parseDeadline で「期限:」年月日書式から締切が取れる', () => {
    const plain = htmlToPlainText(assign52Ja)
    expect(plain).toContain('開始:') // 実ラベルは「開始:」「期限:」（TUS実機4.5.8と同一）
    expect(plain).toContain('最終更新日時')

    const deadlineText = extractDeadlineText(plain)
    expect(deadlineText.startsWith('期限')).toBe(true)
    expect(deadlineText).toContain('2023年 12月 12日')
    expect(parseDeadline(deadlineText)).toBe(EXPECTED_DEADLINE_ISO)
  })

  it('fingerprintPage: assignページのbodyクラス（cm-type-assign等）が読める・docsリンクは無い', () => {
    const fp = fingerprintPage(assign52Ja)
    expect(fp.version).toBeNull()
    expect(fp.bodyClasses).toContain('cm-type-assign')
    expect(fp.bodyClasses).toContain('path-mod-assign')
    expect(fp.bodyClasses).toContain('lang-ja')
  })
})

describe('assign52_en.html（EN assign・現行regex対象外書式）', () => {
  it('Due: の EN 書式はキーワードは見つかるが日付パース不能→DEADLINE_KEYWORD_NO_DATE が発火', () => {
    const plain = htmlToPlainText(assign52En)
    const deadlineText = extractDeadlineText(plain)
    expect(deadlineText.toLowerCase().startsWith('due')).toBe(true)
    expect(deadlineText).toContain('12 December 2023')
    // 「Tuesday, 12 December 2023, 12:00 AM」は現行regex（年月日/スラッシュ）に不一致
    expect(parseDeadline(deadlineText)).toBeNull()

    // spec§6原則: パース失敗は黙殺されず対応する診断コードが発火する
    expect(
      diagnoseActivityPage({
        pageAuthState: 'logged_in',
        keywordFound: true,
        dateParsed: false,
        statusResolved: false,
        moduleType: 'assign',
        moduleSupported: true,
      }),
    ).toEqual(['DEADLINE_KEYWORD_NO_DATE'])
  })
})

// ─── スキャン実経路（scanDeadlinesInBackground に実fixtureを流す） ────────────

describe('scanDeadlinesInBackground（実fixtureをそのまま背景スキャンに流す）', () => {
  const course: Course = {
    id: 'course-62',
    name: 'Psychology in Cinema',
    url: COURSE_URL,
    enabled: true,
    lmsType: 'moodle',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  const candidate: AssignmentCandidate = {
    id: 'cand-724',
    courseId: 'course-62',
    courseName: 'Psychology in Cinema',
    title: 'From Concept to Reality: Trauma and Film',
    url: ASSIGN_URL,
    sourceText: 'From Concept to Reality: Trauma and Film',
    detectedAt: '2026-01-01T00:00:00.000Z',
  }

  function stubFetchWithAssignPage(assignHtml: string): void {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      url,
      text: async () => (url.includes('/mod/assign/') ? assignHtml : course52Raw),
    })))
  }

  it('JA: 締切が field 取得され「まだ提出されていません。」は unknown（特性固定・P3で更新予定）', async () => {
    store[COURSES_KEY] = [course]
    store[ASSIGNMENT_CANDIDATES_KEY] = [candidate]
    stubFetchWithAssignPage(assign52Ja)

    const result = await scanDeadlinesInBackground(noopPacer)

    expect(result.ok).toBe(true)
    // 期限は取れ状態は対応型（assign）なので、診断コードは一切発火しない
    expect(result.diagnostics).toEqual([])

    const assignments = store[ASSIGNMENTS_KEY] as Assignment[]
    expect(assignments).toHaveLength(1)
    expect(assignments[0].deadline).toBe(EXPECTED_DEADLINE_ISO)
    expect(assignments[0].deadlineSource).toBe('field')
    // 特性固定: JA未提出値「まだ提出されていません。」は現行 extractSubmissionStatus の
    // 「未提出」includes に不一致で unknown に落ちる（5.2 Mount Orange と TUS実機4.5.8 で同値）。
    // P3（状態文字列セット補完）が not_submitted に修正する際、このアサートも更新する。
    expect(assignments[0].submissionStatus).toBe('unknown')
    expect(assignments[0].lifecycleStatus).toBe('passed') // 締切2023年＝超過
  })

  it('EN: 日付パース不能が黙殺されず DEADLINE_KEYWORD_NO_DATE がスキャン結果に浮上する', async () => {
    store[COURSES_KEY] = [course]
    store[ASSIGNMENT_CANDIDATES_KEY] = [candidate]
    stubFetchWithAssignPage(assign52En)

    const result = await scanDeadlinesInBackground(noopPacer)

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual(['DEADLINE_KEYWORD_NO_DATE'])

    const assignments = store[ASSIGNMENTS_KEY] as Assignment[]
    expect(assignments).toHaveLength(1)
    expect(assignments[0].deadline).toBeNull()
    // 「No submissions have been made yet」も現行ロジックでは unknown（特性固定）
    expect(assignments[0].submissionStatus).toBe('unknown')
    expect(assignments[0].lifecycleStatus).toBe('active')
  })
})
