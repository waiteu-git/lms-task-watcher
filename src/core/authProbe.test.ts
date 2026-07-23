import { describe, it, expect } from 'vitest'
import {
  classifyFetchedPage,
  emptyAuthProbeSummary,
  addToAuthProbeSummary,
  LETUS_HOSTNAME,
} from './authProbe'
import { SESSKEY_HTML_SNIPPET } from './letusApi.fixtures'

const COURSE_URL = 'https://letus.ed.tus.ac.jp/course/view.php?id=1'

describe('classifyFetchedPage', () => {
  describe('logged_out（/login/ 着地）', () => {
    it('finalUrlに/login/を含めばlogged_out', () => {
      const result = classifyFetchedPage({
        finalUrl: 'https://letus.ed.tus.ac.jp/login/index.php',
        bodyText: '<html><body>ログインページ</body></html>',
      })
      expect(result).toBe('logged_out')
    })

    it('/login/着地は本文にM.cfgがあってもlogged_out（ログインページ自身もMoodleページ）', () => {
      const result = classifyFetchedPage({
        finalUrl: 'https://letus.ed.tus.ac.jp/login/index.php',
        bodyText: SESSKEY_HTML_SNIPPET,
      })
      expect(result).toBe('logged_out')
    })
  })

  describe('logged_out（SSO/クロスオリジン・TUS実機2026-07-19実測）', () => {
    // TUS実機のログアウト時チェーン: course/view.php → 303 同一オリジン
    // /auth/shibboleth/index.php → 302 idp.admin.tus.ac.jp（SAML）→
    // login.microsoftonline.com。redirect:'follow' でどの段に着地しても
    // logged_out に分類できることを固定する。

    it('同一オリジンの /auth/shibboleth/ 入口に着地すれば logged_out（本文マーカー不要）', () => {
      const result = classifyFetchedPage({
        finalUrl: 'https://letus.ed.tus.ac.jp/auth/shibboleth/index.php',
        bodyText: '<html><body>Redirecting to identity provider...</body></html>',
      })
      expect(result).toBe('logged_out')
    })

    it('IdP実URL（idp.admin.tus.ac.jp のSAMLエンドポイント）に着地すれば logged_out', () => {
      const result = classifyFetchedPage({
        finalUrl:
          'https://idp.admin.tus.ac.jp/idp/profile/SAML2/Redirect/SSO?execution=e1s1',
        bodyText: '<html><body><form>Sign in</form></body></html>',
      })
      expect(result).toBe('logged_out')
    })

    it('login.microsoftonline.com に着地すれば logged_out', () => {
      const result = classifyFetchedPage({
        finalUrl:
          'https://login.microsoftonline.com/common/oauth2/authorize?client_id=x',
        bodyText: '<html><body>Sign in to your account</body></html>',
      })
      expect(result).toBe('logged_out')
    })

    it('その他の学外オリジン着地（マーカー無し）も logged_out（LETUSはログイン済みで学外へ飛ばさない）', () => {
      const result = classifyFetchedPage({
        finalUrl: 'https://www.tus.ac.jp/portal/',
        bodyText: '<html><body>学内ポータル</body></html>',
      })
      expect(result).toBe('logged_out')
    })

    it('非LETUSホストでも Moodleマーカー（M.cfg）が在れば logged_in（マーカー優先＝demo fixture経路の回帰防止）', () => {
      // moodle52Fixtures.test.ts は school.moodledemo.net のURLで実配線
      //（scanDeadlinesInBackground 等）を通す。クロスオリジン規則をマーカー判定より
      // 後段に置くことで、この経路を壊さない。実SSO面（IdP/Microsoft）は
      // Moodleマーカーを持たないため検知力は変わらない。
      const result = classifyFetchedPage({
        finalUrl: 'https://school.moodledemo.net/my/',
        bodyText: SESSKEY_HTML_SNIPPET,
      })
      expect(result).toBe('logged_in')
    })

    it('LETUS_HOSTNAME は実機ホスト名の単一情報源', () => {
      expect(LETUS_HOSTNAME).toBe('letus.ed.tus.ac.jp')
    })
  })

  describe('logged_out（未ログイン本文マーカー）', () => {
    it('「あなたはログインしていません」を含めばlogged_out', () => {
      const result = classifyFetchedPage({
        finalUrl: COURSE_URL,
        bodyText: '<span>あなたはログインしていません。(<a href="/login/index.php">ログイン</a>)</span>',
      })
      expect(result).toBe('logged_out')
    })

    it('英語UI「You are not logged in」でもlogged_out', () => {
      const result = classifyFetchedPage({
        finalUrl: COURSE_URL,
        bodyText: '<div class="logininfo">You are not logged in. (<a href="/login/index.php">Log in</a>)</div>',
      })
      expect(result).toBe('logged_out')
    })

    it('未ログインマーカーはM.cfgより優先（ゲスト閲覧ページはゲストsesskey入りM.cfgを持つ）', () => {
      // 実Moodleの未ログイン/ゲストページは M.cfg（ゲストsesskey）を載せたまま
      // 「あなたはログインしていません」を表示する。M.cfg先行判定だと logged_in に
      // 誤分類するため、ログアウト証拠を先に見る。
      const guestPage = SESSKEY_HTML_SNIPPET.replace(
        '<body>dashboard</body>',
        '<body>あなたはログインしていません。</body>',
      )
      const result = classifyFetchedPage({ finalUrl: COURSE_URL, bodyText: guestPage })
      expect(result).toBe('logged_out')
    })
  })

  describe('logged_in（M.cfg / sesskeyマーカー）', () => {
    it('M.cfgインラインJSON（実測形状fixture）を含めばlogged_in', () => {
      const result = classifyFetchedPage({ finalUrl: COURSE_URL, bodyText: SESSKEY_HTML_SNIPPET })
      expect(result).toBe('logged_in')
    })

    it('sesskeyマーカーのみ（M.cfg代入形が崩れた場合の保険）でもlogged_in', () => {
      const result = classifyFetchedPage({
        finalUrl: COURSE_URL,
        bodyText: '<script>window.__cfg={"sesskey":"Zz00Aa11Bb"}</script>',
      })
      expect(result).toBe('logged_in')
    })

    it('M.cfg代入形（sesskey欠落）でもlogged_in', () => {
      const result = classifyFetchedPage({
        finalUrl: COURSE_URL,
        bodyText: '<script>M.cfg = {"wwwroot":"https:\\/\\/letus.ed.tus.ac.jp"};</script>',
      })
      expect(result).toBe('logged_in')
    })

    it('finalUrlが空（opaque応答等でURL不明）でも本文マーカーで分類できる', () => {
      const result = classifyFetchedPage({ finalUrl: '', bodyText: SESSKEY_HTML_SNIPPET })
      expect(result).toBe('logged_in')
    })
  })

  describe('not_moodle_page', () => {
    it('どのマーカーも無いHTML（メンテページ等）はnot_moodle_page', () => {
      const result = classifyFetchedPage({
        finalUrl: COURSE_URL,
        bodyText: '<html><body><h1>ただいまメンテナンス中です</h1></body></html>',
      })
      expect(result).toBe('not_moodle_page')
    })

    it('空文字の本文はnot_moodle_page', () => {
      expect(classifyFetchedPage({ finalUrl: COURSE_URL, bodyText: '' })).toBe('not_moodle_page')
    })

    it('散文中の「M.cfg」言及（代入形でない）はマーカー扱いしない', () => {
      const result = classifyFetchedPage({
        finalUrl: COURSE_URL,
        bodyText: '<p>この資料では M.cfg について説明します</p>',
      })
      expect(result).toBe('not_moodle_page')
    })

    it('letus内の非MoodleページはクロスオリジンでないのでLOGGED_OUTに誤倒れしない', () => {
      // クロスオリジン規則の境界: 同一ホスト（letus.ed.tus.ac.jp）でマーカー皆無なら
      // 従来どおり not_moodle_page（メンテページ等が応答している状態）。
      const result = classifyFetchedPage({
        finalUrl: 'https://letus.ed.tus.ac.jp/maintenance.html',
        bodyText: '<html><body><h1>システム更新のお知らせ</h1></body></html>',
      })
      expect(result).toBe('not_moodle_page')
    })

    it('finalUrl空（opaque応答等）＋マーカー無しはホスト不明としてnot_moodle_page（クロスオリジン規則を適用しない）', () => {
      expect(classifyFetchedPage({ finalUrl: '', bodyText: '<html><body>?</body></html>' })).toBe(
        'not_moodle_page',
      )
    })

    it('finalUrlがURLとして解釈不能でもクロスオリジン規則を誤発火しない', () => {
      expect(
        classifyFetchedPage({ finalUrl: '/course/view.php?id=1', bodyText: '<html></html>' }),
      ).toBe('not_moodle_page')
    })
  })
})

describe('AuthProbeSummary', () => {
  it('emptyAuthProbeSummaryは全カウント0', () => {
    expect(emptyAuthProbeSummary()).toEqual({
      probedCount: 0,
      loggedInCount: 0,
      loggedOutCount: 0,
      notMoodleCount: 0,
    })
  })

  it('addToAuthProbeSummaryは分類ごとのカウントとprobedCountを加算する', () => {
    let summary = emptyAuthProbeSummary()
    summary = addToAuthProbeSummary(summary, 'logged_in')
    summary = addToAuthProbeSummary(summary, 'logged_in')
    summary = addToAuthProbeSummary(summary, 'logged_out')
    summary = addToAuthProbeSummary(summary, 'not_moodle_page')
    expect(summary).toEqual({
      probedCount: 4,
      loggedInCount: 2,
      loggedOutCount: 1,
      notMoodleCount: 1,
    })
  })

  it('addToAuthProbeSummaryは入力を破壊しない（純関数）', () => {
    const before = emptyAuthProbeSummary()
    const after = addToAuthProbeSummary(before, 'logged_in')
    expect(before).toEqual(emptyAuthProbeSummary())
    expect(after).not.toBe(before)
  })
})
