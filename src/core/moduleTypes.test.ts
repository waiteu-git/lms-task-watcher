import { describe, it, expect } from 'vitest'
import {
  STRICT_MODULE_TYPES,
  STANDARD_MODULE_TYPES,
  BROAD_MODULE_TYPES,
  NON_ASSIGNMENT_MODULE_TYPES,
  STRICT_MODULE_PATHS,
  STANDARD_MODULE_PATHS,
  BROAD_MODULE_PATHS,
  NON_ASSIGNMENT_PATHS,
  collectUnknownModuleTypes,
} from './moduleTypes'

const BASE = 'https://letus.ed.tus.ac.jp'

describe('モジュール型定数（単一情報源）', () => {
  it('strict ⊂ standard ⊂ broad の包含関係を保つ', () => {
    for (const t of STRICT_MODULE_TYPES) {
      expect(STANDARD_MODULE_TYPES).toContain(t)
    }
    for (const t of STANDARD_MODULE_TYPES) {
      expect(BROAD_MODULE_TYPES).toContain(t)
    }
  })

  it('従来 index.ts に直書きされていた許可パスを欠落なく含む（リファクタ回帰ガード）', () => {
    expect(STRICT_MODULE_PATHS).toEqual([
      '/mod/assign/view.php',
      '/mod/quiz/view.php',
      '/mod/turnitintool/view.php',
      '/mod/turnitintooltwo/view.php',
    ])
    expect(STANDARD_MODULE_PATHS).toEqual([
      ...STRICT_MODULE_PATHS,
      '/mod/workshop/view.php',
      '/mod/feedback/view.php',
      '/mod/choice/view.php',
      '/mod/questionnaire/view.php',
      '/mod/lti/view.php',
    ])
    expect(BROAD_MODULE_PATHS).toEqual([
      ...STANDARD_MODULE_PATHS,
      '/mod/forum/view.php',
      '/mod/survey/view.php',
      '/mod/lesson/view.php',
    ])
  })

  it('従来 index.ts に直書きされていた除外パスを欠落なく含む（リファクタ回帰ガード）', () => {
    expect(NON_ASSIGNMENT_PATHS).toEqual([
      '/grade/',
      '/grade/report/',
      '/reportbuilder/',
      '/user/',
      '/calendar/',
      '/message/',
      '/blog/',
      '/badges/',
      '/competency/',
      '/course/report/',
      '/course/view.php',
      '/mod/resource/',
      '/mod/folder/',
      '/mod/page/',
      '/mod/url/',
      '/mod/book/',
      '/mod/label/',
      '/mod/glossary/',
      '/mod/wiki/',
    ])
  })
})

describe('collectUnknownModuleTypes', () => {
  it('broad許可リストにも除外リストにも無い /mod/<type>/view.php の型を返す', () => {
    const result = collectUnknownModuleTypes([
      `${BASE}/mod/hvp/view.php?id=9`,
    ])
    expect(result).toEqual(['hvp'])
  })

  it('複数の未知型を重複排除して昇順で返す', () => {
    const result = collectUnknownModuleTypes([
      `${BASE}/mod/hvp/view.php?id=1`,
      `${BASE}/mod/customcert/view.php?id=2`,
      `${BASE}/mod/hvp/view.php?id=3`,
      `${BASE}/mod/h5pactivity/view.php?id=4`,
    ])
    expect(result).toEqual(['customcert', 'h5pactivity', 'hvp'])
  })

  it('broad許可リストの全型は未知として返さない', () => {
    const urls = BROAD_MODULE_TYPES.map((t) => `${BASE}/mod/${t}/view.php?id=1`)
    expect(collectUnknownModuleTypes(urls)).toEqual([])
  })

  it('除外リストの全モジュール型は未知として返さない', () => {
    const urls = NON_ASSIGNMENT_MODULE_TYPES.map((t) => `${BASE}/mod/${t}/view.php?id=1`)
    expect(collectUnknownModuleTypes(urls)).toEqual([])
  })

  it('/mod/<type>/view.php に一致しないURLは無視する', () => {
    const result = collectUnknownModuleTypes([
      `${BASE}/course/view.php?id=1`,
      `${BASE}/mod/hvp/index.php?id=2`,
      `${BASE}/grade/report/user/index.php`,
      `${BASE}/mod/hvp/`,
      'https://example.com/unrelated',
    ])
    expect(result).toEqual([])
  })

  it('大文字混じりURLも小文字化して判定する（既存 isTargetActivityUrl と同じ正規化）', () => {
    const result = collectUnknownModuleTypes([
      `${BASE}/MOD/Hvp/VIEW.PHP?id=9`,
      `${BASE}/mod/ASSIGN/view.php?id=1`,
    ])
    expect(result).toEqual(['hvp'])
  })

  it('英字始まり以外の型名（不正セグメント）は無視する', () => {
    expect(collectUnknownModuleTypes([`${BASE}/mod/1abc/view.php?id=1`])).toEqual([])
  })

  it('数字・アンダースコアを含む型名を受理する', () => {
    expect(collectUnknownModuleTypes([`${BASE}/mod/my_mod2/view.php?id=1`])).toEqual(['my_mod2'])
  })

  it('空配列には空配列を返す', () => {
    expect(collectUnknownModuleTypes([])).toEqual([])
  })
})
