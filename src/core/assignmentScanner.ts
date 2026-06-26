import type { AssignmentCandidate, Course } from './types'

function createAssignmentCandidateId(courseId: string, url: string): string {
  return btoa(unescape(encodeURIComponent(`${courseId}:${url}`)))
    .replaceAll('=', '')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function isTargetActivityUrl(url: string): boolean {
  const normalizedUrl = url.toLowerCase()

  const targetModulePaths = [
    // 課題提出BOXの本命
    '/mod/assign/view.php',

    // 小テスト・確認テスト
    '/mod/quiz/view.php',

    // Turnitin系課題
    '/mod/turnitintool/view.php',
    '/mod/turnitintooltwo/view.php',

    // 相互評価・ワークショップ
    '/mod/workshop/view.php',

    // 掲示板投稿型の課題がある場合に備える
    '/mod/forum/view.php',

    // アンケート・フィードバック・選択
    '/mod/feedback/view.php',
    '/mod/choice/view.php',
    '/mod/questionnaire/view.php',
    '/mod/survey/view.php',

    // レッスン・外部ツール
    '/mod/lesson/view.php',
    '/mod/lti/view.php',
  ]

  return targetModulePaths.some((path) => normalizedUrl.includes(path))
}

function isClearlyNonAssignmentUrl(url: string): boolean {
  const normalizedUrl = url.toLowerCase()

  const excludedPaths = [
    // 成績・レポート・ユーザー系
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

    // 教材・資料系
    '/mod/resource/',
    '/mod/folder/',
    '/mod/page/',
    '/mod/url/',
    '/mod/book/',
    '/mod/label/',
    '/mod/glossary/',
    '/mod/wiki/',
  ]

  return excludedPaths.some((path) => normalizedUrl.includes(path))
}

function hasAssignmentKeyword(text: string, url: string): boolean {
  const normalizedText = normalizeText(text).toLowerCase()
  const normalizedUrl = url.toLowerCase()

  const keywords = [
    '課題',
    '提出',
    'レポート',
    '小テスト',
    '確認テスト',
    'テスト',
    'アンケート',
    '回答',
    '投稿',
    'assignment',
    'assign',
    'report',
    'quiz',
    'test',
    'questionnaire',
    'feedback',
    'workshop',
    'turnitin',
  ]

  return keywords.some((keyword) => {
    const lowerKeyword = keyword.toLowerCase()
    return normalizedText.includes(lowerKeyword) || normalizedUrl.includes(lowerKeyword)
  })
}

function isAssignmentLikeLink(text: string, url: string): boolean {
  const normalizedText = normalizeText(text)

  if (normalizedText.length < 2) {
    return false
  }

  if (normalizedText.length > 220) {
    return false
  }

  if (isClearlyNonAssignmentUrl(url)) {
    return false
  }

  if (isTargetActivityUrl(url)) {
    return true
  }

  return hasAssignmentKeyword(normalizedText, url)
}

export async function scanAssignmentCandidatesFromCourses(
  courses: Course[],
): Promise<AssignmentCandidate[]> {
  const enabledCourses = courses.filter((course) => course.enabled)
  const detectedAt = new Date().toISOString()
  const assignmentMap = new Map<string, AssignmentCandidate>()

  for (const course of enabledCourses) {
    const response = await fetch(course.url, {
      credentials: 'include',
    })

    if (!response.ok) {
      continue
    }

    const html = await response.text()
    const parser = new DOMParser()
    const document = parser.parseFromString(html, 'text/html')
    const links = Array.from(document.querySelectorAll('a'))

    for (const link of links) {
      const title = normalizeText(link.textContent ?? '')
      const href = link.getAttribute('href') ?? ''

      if (!href) {
        continue
      }

      const url = new URL(href, course.url).toString().split('#')[0]

      if (!isAssignmentLikeLink(title, url)) {
        continue
      }

      const id = createAssignmentCandidateId(course.id, url)

      if (!assignmentMap.has(id)) {
        assignmentMap.set(id, {
          id,
          courseId: course.id,
          courseName: course.name,
          title,
          url,
          sourceText: title,
          detectedAt,
        })
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1200))
  }

  return Array.from(assignmentMap.values())
}
