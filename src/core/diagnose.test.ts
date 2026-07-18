import { describe, it, expect } from 'vitest'
import {
  DIAGNOSTIC_CODES,
  diagnoseDashboard,
  diagnoseCoursePage,
  diagnoseCourseLossAggregate,
  diagnoseActivityPage,
  diagnoseAuthProbe,
  type DiagnosticCode,
  type PageAuthState,
} from './diagnose'

describe('DIAGNOSTIC_CODES', () => {
  it('spec§4の7コード＋集計コード（COURSES_MAJORITY_LOST）を重複なく列挙する', () => {
    expect([...DIAGNOSTIC_CODES].sort()).toEqual(
      [
        'DASHBOARD_UNREADABLE',
        'COURSE_PAGE_NO_ACTIVITIES',
        'DEADLINE_KEYWORD_NO_DATE',
        'COURSE_LOST_ALL_ASSIGNMENTS',
        'COURSES_MAJORITY_LOST',
        'NOT_A_MOODLE_PAGE',
        'UNSUPPORTED_MODULE',
        'LOGGED_OUT',
      ].sort(),
    )
    expect(new Set(DIAGNOSTIC_CODES).size).toBe(DIAGNOSTIC_CODES.length)
  })
})

describe('diagnoseDashboard', () => {
  const cases: Array<{
    name: string
    pageAuthState: PageAuthState
    courseAnchorCount: number
    knownCourseCount: number
    expected: DiagnosticCode[]
  }> = [
    {
      name: 'ログアウト状態は LOGGED_OUT のみ（他コードと重畳しない）',
      pageAuthState: 'logged_out', courseAnchorCount: 0, knownCourseCount: 3,
      expected: ['LOGGED_OUT'],
    },
    {
      name: 'ログアウト状態はアンカーが拾えていても LOGGED_OUT（ログインページ内の飾りリンク対策）',
      pageAuthState: 'logged_out', courseAnchorCount: 5, knownCourseCount: 3,
      expected: ['LOGGED_OUT'],
    },
    {
      name: 'ログイン済み・0アンカー・既知コースあり → DASHBOARD_UNREADABLE（矛盾検知）',
      pageAuthState: 'logged_in', courseAnchorCount: 0, knownCourseCount: 3,
      expected: ['DASHBOARD_UNREADABLE'],
    },
    {
      name: 'ログイン済み・0アンカー・既知コース1件でも発火（閾値は件数でなく既知の有無）',
      pageAuthState: 'logged_in', courseAnchorCount: 0, knownCourseCount: 1,
      expected: ['DASHBOARD_UNREADABLE'],
    },
    {
      name: 'ログイン済み・0アンカーでも既知コース0件なら発火しない（初回利用/未登録＝正当な空）',
      pageAuthState: 'logged_in', courseAnchorCount: 0, knownCourseCount: 0,
      expected: [],
    },
    {
      name: 'ログイン済み・アンカーありは正常',
      pageAuthState: 'logged_in', courseAnchorCount: 4, knownCourseCount: 3,
      expected: [],
    },
    {
      name: '既知コース0件でもアンカーが拾えていれば正常（新規ユーザーの初回スキャン）',
      pageAuthState: 'logged_in', courseAnchorCount: 2, knownCourseCount: 0,
      expected: [],
    },
    {
      name: '認証状態不明なら発火しない（メンテページ等の誤検知抑制＝迷ったら鳴らさない）',
      pageAuthState: 'unknown', courseAnchorCount: 0, knownCourseCount: 3,
      expected: [],
    },
    {
      name: '認証状態不明・全部空でも発火しない',
      pageAuthState: 'unknown', courseAnchorCount: 0, knownCourseCount: 0,
      expected: [],
    },
  ]

  it.each(cases)('$name', ({ pageAuthState, courseAnchorCount, knownCourseCount, expected }) => {
    expect(diagnoseDashboard({ pageAuthState, courseAnchorCount, knownCourseCount })).toEqual(expected)
  })
})

describe('diagnoseCoursePage', () => {
  const cases: Array<{
    name: string
    pageAuthState: PageAuthState
    modAnchorCount: number
    prevSignatureLen: number | null
    hasCourseMarker: boolean
    expected: DiagnosticCode[]
  }> = [
    {
      name: 'ログアウト状態は LOGGED_OUT のみ',
      pageAuthState: 'logged_out', modAnchorCount: 0, prevSignatureLen: 3, hasCourseMarker: false,
      expected: ['LOGGED_OUT'],
    },
    {
      name: 'ログイン済み・アンカーありは正常',
      pageAuthState: 'logged_in', modAnchorCount: 5, prevSignatureLen: null, hasCourseMarker: true,
      expected: [],
    },
    {
      name: '初回スキャン（prev無し）は0アンカーでも発火しない（正当な空の可能性）',
      pageAuthState: 'logged_in', modAnchorCount: 0, prevSignatureLen: null, hasCourseMarker: true,
      expected: [],
    },
    {
      name: '初回スキャン・マーカー無しでも発火しない（ベースラインが無い限り鳴らさない）',
      pageAuthState: 'logged_in', modAnchorCount: 0, prevSignatureLen: null, hasCourseMarker: false,
      expected: [],
    },
    {
      name: '前回も0件の既知空コースは発火しない（正当な0課題コース）',
      pageAuthState: 'logged_in', modAnchorCount: 0, prevSignatureLen: 0, hasCourseMarker: true,
      expected: [],
    },
    {
      name: '前回0件・マーカー無しも発火しない（喪失の証拠が無い＝迷ったら鳴らさない）',
      pageAuthState: 'logged_in', modAnchorCount: 0, prevSignatureLen: 0, hasCourseMarker: false,
      expected: [],
    },
    {
      name: '既知コース（prev>0）が0件化・コースマーカーあり → COURSE_LOST_ALL_ASSIGNMENTS',
      pageAuthState: 'logged_in', modAnchorCount: 0, prevSignatureLen: 3, hasCourseMarker: true,
      expected: ['COURSE_LOST_ALL_ASSIGNMENTS'],
    },
    {
      name: 'prev=1でも全喪失なら発火（件数閾値なし）',
      pageAuthState: 'logged_in', modAnchorCount: 0, prevSignatureLen: 1, hasCourseMarker: true,
      expected: ['COURSE_LOST_ALL_ASSIGNMENTS'],
    },
    {
      name: '既知コースが0件化・コースマーカーも消失 → COURSE_PAGE_NO_ACTIVITIES（ページ自体が読めない）',
      pageAuthState: 'logged_in', modAnchorCount: 0, prevSignatureLen: 3, hasCourseMarker: false,
      expected: ['COURSE_PAGE_NO_ACTIVITIES'],
    },
    {
      name: '部分的な減少（0件化でない）は通常運用＝発火しない',
      pageAuthState: 'logged_in', modAnchorCount: 2, prevSignatureLen: 5, hasCourseMarker: true,
      expected: [],
    },
    {
      name: '認証状態不明なら prev>0 でも発火しない（メンテ/ポータル画面の誤検知抑制）',
      pageAuthState: 'unknown', modAnchorCount: 0, prevSignatureLen: 3, hasCourseMarker: true,
      expected: [],
    },
    {
      name: '認証状態不明・マーカー無しも発火しない',
      pageAuthState: 'unknown', modAnchorCount: 0, prevSignatureLen: 3, hasCourseMarker: false,
      expected: [],
    },
  ]

  it.each(cases)('$name', ({ pageAuthState, modAnchorCount, prevSignatureLen, hasCourseMarker, expected }) => {
    expect(
      diagnoseCoursePage({ pageAuthState, modAnchorCount, prevSignatureLen, hasCourseMarker }),
    ).toEqual(expected)
  })
})

describe('diagnoseCourseLossAggregate', () => {
  const cases: Array<{
    name: string
    lostCourseCount: number
    trackedCourseCount: number
    expected: DiagnosticCode[]
  }> = [
    {
      name: '喪失なし（健全）は発火しない',
      lostCourseCount: 0, trackedCourseCount: 5,
      expected: [],
    },
    {
      name: '既知コース0件（初回利用等）は発火しない',
      lostCourseCount: 0, trackedCourseCount: 0,
      expected: [],
    },
    {
      name: '1コースのみの喪失は既知コースが何件でも発火しない（教員の全非表示という正当ケースの本命）',
      lostCourseCount: 1, trackedCourseCount: 5,
      expected: [],
    },
    {
      name: '既知コース1件のユーザーの単独喪失も発火しない（info階級COURSE_LOST_ALL_ASSIGNMENTSの設計根拠を保存）',
      lostCourseCount: 1, trackedCourseCount: 1,
      expected: [],
    },
    {
      name: '2/4喪失（ちょうど半数）は発火しない（厳密過半のみ＝迷ったら鳴らさない）',
      lostCourseCount: 2, trackedCourseCount: 4,
      expected: [],
    },
    {
      name: '3/6喪失（ちょうど半数）も発火しない',
      lostCourseCount: 3, trackedCourseCount: 6,
      expected: [],
    },
    {
      name: '2/3喪失（過半）→ COURSES_MAJORITY_LOST',
      lostCourseCount: 2, trackedCourseCount: 3,
      expected: ['COURSES_MAJORITY_LOST'],
    },
    {
      name: '2/2喪失（全既知コース一斉）→ COURSES_MAJORITY_LOST',
      lostCourseCount: 2, trackedCourseCount: 2,
      expected: ['COURSES_MAJORITY_LOST'],
    },
    {
      name: '5/5喪失（レイアウト破損の典型形＝全コース一様に0件化）→ COURSES_MAJORITY_LOST',
      lostCourseCount: 5, trackedCourseCount: 5,
      expected: ['COURSES_MAJORITY_LOST'],
    },
    {
      name: '3/5喪失（過半だが全滅でない・一部コースだけ描画が壊れた場合）も発火する',
      lostCourseCount: 3, trackedCourseCount: 5,
      expected: ['COURSES_MAJORITY_LOST'],
    },
  ]

  it.each(cases)('$name', ({ lostCourseCount, trackedCourseCount, expected }) => {
    expect(diagnoseCourseLossAggregate({ lostCourseCount, trackedCourseCount })).toEqual(expected)
  })
})

describe('diagnoseActivityPage', () => {
  const cases: Array<{
    name: string
    pageAuthState: PageAuthState
    keywordFound: boolean
    dateParsed: boolean
    statusResolved: boolean
    moduleType: string | null
    moduleSupported: boolean
    expected: DiagnosticCode[]
  }> = [
    {
      name: 'ログアウト状態は LOGGED_OUT のみ',
      pageAuthState: 'logged_out',
      keywordFound: false, dateParsed: false, statusResolved: false,
      moduleType: 'assign', moduleSupported: true,
      expected: ['LOGGED_OUT'],
    },
    {
      name: '認証状態不明なら何も発火しない（迷ったら鳴らさない）',
      pageAuthState: 'unknown',
      keywordFound: true, dateParsed: false, statusResolved: false,
      moduleType: 'assign', moduleSupported: true,
      expected: [],
    },
    {
      name: 'assign正常系（キーワード・日付・状態すべて取れた）',
      pageAuthState: 'logged_in',
      keywordFound: true, dateParsed: true, statusResolved: true,
      moduleType: 'assign', moduleSupported: true,
      expected: [],
    },
    {
      name: 'キーワードあり日付null → DEADLINE_KEYWORD_NO_DATE（相対日付/書式変更の兆候）',
      pageAuthState: 'logged_in',
      keywordFound: true, dateParsed: false, statusResolved: true,
      moduleType: 'assign', moduleSupported: true,
      expected: ['DEADLINE_KEYWORD_NO_DATE'],
    },
    {
      name: 'キーワード無し日付無しは正当（締切のない活動）＝発火しない',
      pageAuthState: 'logged_in',
      keywordFound: false, dateParsed: false, statusResolved: false,
      moduleType: 'assign', moduleSupported: true,
      expected: [],
    },
    {
      name: '対応型（assign）の状態unknownは発火しない（グループ課題等の正当variantがある＝迷ったら鳴らさない）',
      pageAuthState: 'logged_in',
      keywordFound: true, dateParsed: true, statusResolved: false,
      moduleType: 'assign', moduleSupported: true,
      expected: [],
    },
    {
      name: '未対応型（feedback）で締切は取れたが状態不明 → UNSUPPORTED_MODULE（正直表示）',
      pageAuthState: 'logged_in',
      keywordFound: true, dateParsed: true, statusResolved: false,
      moduleType: 'feedback', moduleSupported: false,
      expected: ['UNSUPPORTED_MODULE'],
    },
    {
      name: '未対応型でキーワードあり日付nullは両方発火（重畳可）',
      pageAuthState: 'logged_in',
      keywordFound: true, dateParsed: false, statusResolved: false,
      moduleType: 'feedback', moduleSupported: false,
      expected: ['DEADLINE_KEYWORD_NO_DATE', 'UNSUPPORTED_MODULE'],
    },
    {
      name: '未対応型でも締切の証拠が無ければ発火しない（締切なし活動への未対応警告はノイズ）',
      pageAuthState: 'logged_in',
      keywordFound: false, dateParsed: false, statusResolved: false,
      moduleType: 'lti', moduleSupported: false,
      expected: [],
    },
    {
      name: '未対応型・タイトル由来の日付のみ（キーワード無し）でも UNSUPPORTED_MODULE',
      pageAuthState: 'logged_in',
      keywordFound: false, dateParsed: true, statusResolved: false,
      moduleType: 'choice', moduleSupported: false,
      expected: ['UNSUPPORTED_MODULE'],
    },
    {
      name: '未対応型でも状態が解決できていれば発火しない（汎用テキスト判定が効いた場合）',
      pageAuthState: 'logged_in',
      keywordFound: true, dateParsed: true, statusResolved: true,
      moduleType: 'workshop', moduleSupported: false,
      expected: [],
    },
    {
      name: '型不明（moduleType null）でも判定はフラグのみで決まる',
      pageAuthState: 'logged_in',
      keywordFound: true, dateParsed: true, statusResolved: false,
      moduleType: null, moduleSupported: false,
      expected: ['UNSUPPORTED_MODULE'],
    },
  ]

  it.each(cases)('$name', ({ pageAuthState, keywordFound, dateParsed, statusResolved, moduleType, moduleSupported, expected }) => {
    expect(
      diagnoseActivityPage({ pageAuthState, keywordFound, dateParsed, statusResolved, moduleType, moduleSupported }),
    ).toEqual(expected)
  })
})

describe('diagnoseAuthProbe', () => {
  const cases: Array<{
    name: string
    fetchOk: boolean
    hasMcfg: boolean
    hasLoginMarker: boolean
    expected: DiagnosticCode[]
  }> = [
    {
      name: 'fetch失敗はネットワーク問題＝レイアウト診断は発火しない',
      fetchOk: false, hasMcfg: false, hasLoginMarker: false,
      expected: [],
    },
    {
      name: 'ログインマーカーあり（M.cfgあり）→ LOGGED_OUT（Moodleのログインページ）',
      fetchOk: true, hasMcfg: true, hasLoginMarker: true,
      expected: ['LOGGED_OUT'],
    },
    {
      name: 'ログインマーカーあり（M.cfg無し）でも LOGGED_OUT が優先（学外SSO/IdPページはMoodleでない）',
      fetchOk: true, hasMcfg: false, hasLoginMarker: true,
      expected: ['LOGGED_OUT'],
    },
    {
      name: 'ログインマーカー無し・M.cfg欠落 → NOT_A_MOODLE_PAGE',
      fetchOk: true, hasMcfg: false, hasLoginMarker: false,
      expected: ['NOT_A_MOODLE_PAGE'],
    },
    {
      name: 'M.cfgあり・ログインマーカー無しは正常',
      fetchOk: true, hasMcfg: true, hasLoginMarker: false,
      expected: [],
    },
  ]

  it.each(cases)('$name', ({ fetchOk, hasMcfg, hasLoginMarker, expected }) => {
    expect(diagnoseAuthProbe({ fetchOk, hasMcfg, hasLoginMarker })).toEqual(expected)
  })
})
