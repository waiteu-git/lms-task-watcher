const COURSES_KEY = 'courses'
const ASSIGNMENT_CANDIDATES_KEY = 'assignmentCandidates'
const ASSIGNMENTS_KEY = 'assignments'
const ASSIGNMENT_SCAN_STATUS_KEY = 'assignmentScanStatus'
const DEADLINE_SCAN_STATUS_KEY = 'deadlineScanStatus'

let isAssignmentScanning = false
let isDeadlineScanning = false

console.log('[LMS Task Watcher] background service worker loaded')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeText(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ')
}

function createId(value) {
  return btoa(unescape(encodeURIComponent(value)))
    .replaceAll('=', '')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}

function createAssignmentCandidateId(courseId, url) {
  return createId(`${courseId}:${url}`)
}

function stripTags(html) {
  return normalizeText(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' '),
  )
}

function decodeHtmlEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  }

  return String(text).replace(
    /&(amp|lt|gt|quot|#39|nbsp);/g,
    (match) => entities[match] ?? match,
  )
}

function htmlToPlainText(html) {
  return decodeHtmlEntities(
    stripTags(
      String(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<\/th>/gi, ' ')
        .replace(/<\/td>/gi, ' '),
    ),
  )
}

function extractLinksFromHtml(html, baseUrl) {
  const links = []

  const anchorRegex =
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi

  let match

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1]
    const innerHtml = match[2]

    if (!href) {
      continue
    }

    try {
      const url = new URL(href, baseUrl).toString().split('#')[0]
      const title = decodeHtmlEntities(stripTags(innerHtml))

      if (title.length > 0) {
        links.push({
          title,
          url,
        })
      }
    } catch (_) {
      // URL変換失敗は無視
    }
  }

  return links
}

async function mapWithConcurrency(items, concurrency, handler, onProgress) {
  const results = []
  let nextIndex = 0
  let completed = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1

      const item = items[currentIndex]
      const result = await handler(item, currentIndex)

      if (result !== undefined && result !== null) {
        if (Array.isArray(result)) {
          results.push(...result)
        } else {
          results.push(result)
        }
      }

      completed += 1

      if (onProgress) {
        await onProgress(completed, item, results)
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  const workers = Array.from({ length: workerCount }, () => worker())

  await Promise.all(workers)

  return results
}

function isTargetActivityUrl(url, scanLevel) {
  const normalizedUrl = url.toLowerCase()

  const strictModulePaths = [
    '/mod/assign/view.php',
    '/mod/quiz/view.php',
    '/mod/turnitintool/view.php',
    '/mod/turnitintooltwo/view.php',
  ]

  const standardModulePaths = [
    ...strictModulePaths,
    '/mod/workshop/view.php',
    '/mod/feedback/view.php',
    '/mod/choice/view.php',
    '/mod/questionnaire/view.php',
    '/mod/lti/view.php',
  ]

  const broadModulePaths = [
    ...standardModulePaths,
    '/mod/forum/view.php',
    '/mod/survey/view.php',
    '/mod/lesson/view.php',
  ]

  if (scanLevel === 'strict') {
    return strictModulePaths.some((path) => normalizedUrl.includes(path))
  }

  if (scanLevel === 'broad') {
    return broadModulePaths.some((path) => normalizedUrl.includes(path))
  }

  return standardModulePaths.some((path) => normalizedUrl.includes(path))
}

function isClearlyNonAssignmentUrl(url) {
  const normalizedUrl = url.toLowerCase()

  const excludedPaths = [
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
  ]

  return excludedPaths.some((path) => normalizedUrl.includes(path))
}

function hasAssignmentKeyword(text, url) {
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

    return (
      normalizedText.includes(lowerKeyword) ||
      normalizedUrl.includes(lowerKeyword)
    )
  })
}

function isAssignmentLikeLink(text, url, scanLevel) {
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

  if (isTargetActivityUrl(url, scanLevel)) {
    return true
  }

  if (scanLevel === 'broad') {
    return hasAssignmentKeyword(normalizedText, url)
  }

  return false
}

function toIsoStringFromParts(year, month, day, hour, minute) {
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? 23),
    Number(minute ?? 59),
    0,
    0,
  )

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toISOString()
}

function extractDeadlineText(plainText) {
  const text = normalizeText(plainText)

  const deadlineKeywords = [
    '提出期限',
    '提出締切',
    '締切日時',
    '締切',
    '期限',
    '終了予定',
    '終了日時',
    '利用終了日時',
    '受験終了',
    '回答終了',
    'Due date',
    'Closing date',
    'Close date',
    'Closes',
    'Due',
    'Close',
  ]

  const startKeywords = [
    '開始予定',
    '開始日時',
    '開始',
    '利用開始日時',
    '受験開始',
    '公開日時',
    '公開',
    'Open date',
    'Opened',
    'Available from',
  ]

  const lowerText = text.toLowerCase()
  let bestIndex = -1

  for (const keyword of deadlineKeywords) {
    const index = lowerText.indexOf(keyword.toLowerCase())

    if (index >= 0 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index
    }
  }

  if (bestIndex >= 0) {
    const end = Math.min(text.length, bestIndex + 320)
    return text.slice(bestIndex, end)
  }

  const hasStartOnlyKeyword = startKeywords.some((keyword) =>
    lowerText.includes(keyword.toLowerCase()),
  )

  if (hasStartOnlyKeyword) {
    return ''
  }

  return ''
}

function parseDeadline(deadlineText) {
  const text = normalizeText(deadlineText)

  const japaneseDateMatch = text.match(
    /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[\(（][^)）]*[\)）])?\s*(?:(\d{1,2})\s*(?:時|:|：)\s*(\d{1,2})?\s*分?)?/,
  )

  if (japaneseDateMatch) {
    const year = japaneseDateMatch[1]
    const month = japaneseDateMatch[2]
    const day = japaneseDateMatch[3]
    const hasHour = japaneseDateMatch[4] !== undefined
    const hour = hasHour ? japaneseDateMatch[4] : '23'
    const minute = hasHour ? japaneseDateMatch[5] ?? '00' : '59'

    return toIsoStringFromParts(year, month, day, hour, minute)
  }

  const separatedDateMatch = text.match(
    /(20\d{2})\d{1,2}\d{1,2}(?:\s+(\d{1,2})\d{2})?/,
  )

  if (separatedDateMatch) {
    const year = separatedDateMatch[1]
    const month = separatedDateMatch[2]
    const day = separatedDateMatch[3]
    const hasHour = separatedDateMatch[4] !== undefined
    const hour = hasHour ? separatedDateMatch[4] : '23'
    const minute = hasHour ? separatedDateMatch[5] ?? '00' : '59'

    return toIsoStringFromParts(year, month, day, hour, minute)
  }

  const noYearJapaneseDateMatch = text.match(
    /(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[\(（][^)）]*[\)）])?\s*(?:(\d{1,2})\s*(?:時|:|：)\s*(\d{1,2})?\s*分?)?/,
  )

  if (noYearJapaneseDateMatch) {
    const currentYear = new Date().getFullYear()
    const month = noYearJapaneseDateMatch[1]
    const day = noYearJapaneseDateMatch[2]
    const hasHour = noYearJapaneseDateMatch[3] !== undefined
    const hour = hasHour ? noYearJapaneseDateMatch[3] : '23'
    const minute = hasHour ? noYearJapaneseDateMatch[4] ?? '00' : '59'

    return toIsoStringFromParts(currentYear, month, day, hour, minute)
  }

  const noYearSeparatedDateMatch = text.match(
    /(\d{1,2})\d{1,2}(?:\s+(\d{1,2})\d{2})?/,
  )

  if (noYearSeparatedDateMatch) {
    const currentYear = new Date().getFullYear()
    const month = noYearSeparatedDateMatch[1]
    const day = noYearSeparatedDateMatch[2]
    const hasHour = noYearSeparatedDateMatch[3] !== undefined
    const hour = hasHour ? noYearSeparatedDateMatch[3] : '23'
    const minute = hasHour ? noYearSeparatedDateMatch[4] ?? '00' : '59'

    return toIsoStringFromParts(currentYear, month, day, hour, minute)
  }

  return null
}

function extractSubmissionStatus(plainText, url) {
  const text = normalizeText(plainText).toLowerCase()
  const isQuiz = url.toLowerCase().includes('/mod/quiz/')

  if (isQuiz) {
    // ✅ 最も信頼できる：受験履歴
    if (
      text.includes('ステータス 終了') ||
      text.includes('status finished')
    ) {
      return 'completed'
    }

    // ✅ 完了系
    if (
      text.includes('受験済み') ||
      text.includes('attempt finished')
    ) {
      return 'completed'
    }

    // ✅ 未受験
    if (
      text.includes('利用できません') ||
      text.includes('not available') ||
      text.includes('未受験') ||
      text.includes('not attempted')
    ) {
      return 'not_submitted'
    }

    return 'unknown'
  }

  // ✅ 課題
  if (
    text.includes('提出済み') ||
    text.includes('submitted')
  ) {
    return 'submitted'
  }

  if (
    text.includes('未提出') ||
    text.includes('not submitted')
  ) {
    return 'not_submitted'
  }

  return 'unknown'
}

function isBeforeStart(plainText) {
  const text = normalizeText(plainText)
  return text.includes('開始予定') && text.includes('利用できません')
}

function isDeadlinePassed(deadline) {
  if (!deadline) {
    return false
  }

  const date = new Date(deadline)

  if (Number.isNaN(date.getTime())) {
    return false
  }

  return date.getTime() < Date.now()
}

async function getCourses() {
  const result = await chrome.storage.local.get(COURSES_KEY)
  return result[COURSES_KEY] ?? []
}

async function getAssignmentCandidates() {
  const result = await chrome.storage.local.get(ASSIGNMENT_CANDIDATES_KEY)
  return result[ASSIGNMENT_CANDIDATES_KEY] ?? []
}

async function saveAssignmentCandidates(assignmentCandidates) {
  await chrome.storage.local.set({
    assignmentCandidates,
  })
}

async function saveAssignments(assignments) {
  await chrome.storage.local.set({
    assignments,
  })
}

async function saveAssignmentScanStatus(status) {
  await chrome.storage.local.set({
    assignmentScanStatus: status,
  })
}

async function saveDeadlineScanStatus(status) {
  await chrome.storage.local.set({
    deadlineScanStatus: status,
  })
}

const NOTIFICATION_TARGETS_KEY = 'notificationTargets'

async function getNotificationTargets() {
  const result = await chrome.storage.local.get(NOTIFICATION_TARGETS_KEY)
  return result[NOTIFICATION_TARGETS_KEY] ?? {}
}

async function saveNotificationTarget(notificationId, url) {
  const targets = await getNotificationTargets()

  await chrome.storage.local.set({
    [NOTIFICATION_TARGETS_KEY]: {
      ...targets,
      [notificationId]: url,
    },
  })
}

async function removeNotificationTarget(notificationId) {
  const targets = await getNotificationTargets()
  delete targets[notificationId]

  await chrome.storage.local.set({
    [NOTIFICATION_TARGETS_KEY]: targets,
  })
}

async function createNotification({ id, title, message, url }) {
  await saveNotificationTarget(id, url)

  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title,
    message,
    priority: 2,
  })
}

function isWithin24HoursForNotification(deadline) {
  if (!deadline) {
    return false
  }

  const diff = new Date(deadline).getTime() - Date.now()
  return diff > 0 && diff <= 24 * 60 * 60 * 1000
}

function isSubmittedForNotification(assignment) {
  return (
    assignment.lifecycleStatus === 'submitted' ||
    assignment.submissionStatus === 'submitted' ||
    assignment.submissionStatus === 'completed'
  )
}

async function notifyDeadlineSummary(assignments) {
  const urgentAssignments = assignments.filter((assignment) => {
    return (
      isWithin24HoursForNotification(assignment.deadline) &&
      !isSubmittedForNotification(assignment) &&
      assignment.lifecycleStatus !== 'passed'
    )
  })

  if (urgentAssignments.length === 0) {
    chrome.notifications.create('task-watcher-refresh-completed', {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'LMS Task Watcher',
      message: '更新が完了しました。24時間以内の未提出課題はありません。',
      priority: 1,
    })

    return
  }

  const firstAssignment = urgentAssignments[0]

  await createNotification({
    id: `task-watcher-urgent-${firstAssignment.id}`,
    title: `24時間以内の課題: ${urgentAssignments.length}件`,
    message: `${firstAssignment.title}\n${firstAssignment.courseName}`,
    url: firstAssignment.url,
  })
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const targets = await getNotificationTargets()
  const url = targets[notificationId]

  if (url) {
    chrome.tabs.create({ url })
  }

  await removeNotificationTarget(notificationId)
  chrome.notifications.clear(notificationId)
})

chrome.notifications.onClosed.addListener(async (notificationId) => {
  await removeNotificationTarget(notificationId)
})

async function scanAssignmentCandidatesInBackground(scanLevel = 'standard') {
  if (isAssignmentScanning) {
    return {
      ok: false,
      reason: 'already_running',
    }
  }

  isAssignmentScanning = true

  const startedAt = new Date().toISOString()
  const courses = await getCourses()
  const enabledCourses = courses.filter((course) => course.enabled)
  const assignmentMap = new Map()

  await saveAssignmentCandidates([])

  await saveAssignmentScanStatus({
    state: 'running',
    startedAt,
    finishedAt: null,
    totalCourses: enabledCourses.length,
    completedCourses: 0,
    currentCourseName: '開始準備中...',
    detectedCount: 0,
    errorMessage: null,
  })

  try {
    await mapWithConcurrency(
      enabledCourses,
      3,
      async (course) => {
        const response = await fetch(course.url, {
          credentials: 'include',
        })

        if (!response.ok) {
          return []
        }

        const html = await response.text()
        const links = extractLinksFromHtml(html, course.url)
        const detected = []

        for (const link of links) {
          const title = normalizeText(link.title)
          const url = link.url

          if (!isAssignmentLikeLink(title, url, scanLevel)) {
            continue
          }

          const id = createAssignmentCandidateId(course.id, url)

          detected.push({
            id,
            courseId: course.id,
            courseName: course.name,
            title,
            url,
            sourceText: title,
            detectedAt: startedAt,
          })
        }

        return detected
      },
      async (completed, course, results) => {
        for (const candidate of results) {
          assignmentMap.set(candidate.id, candidate)
        }

        await saveAssignmentCandidates(Array.from(assignmentMap.values()))

        await saveAssignmentScanStatus({
          state: 'running',
          startedAt,
          finishedAt: null,
          totalCourses: enabledCourses.length,
          completedCourses: completed,
          currentCourseName: course.name,
          detectedCount: assignmentMap.size,
          errorMessage: null,
        })
      },
    )

    const finishedAt = new Date().toISOString()
    const assignmentCandidates = Array.from(assignmentMap.values())

    await saveAssignmentCandidates(assignmentCandidates)

    await saveAssignmentScanStatus({
      state: 'completed',
      startedAt,
      finishedAt,
      totalCourses: enabledCourses.length,
      completedCourses: enabledCourses.length,
      currentCourseName: '',
      detectedCount: assignmentCandidates.length,
      errorMessage: null,
    })

    return {
      ok: true,
      detectedCount: assignmentCandidates.length,
    }
  } catch (error) {
    await saveAssignmentScanStatus({
      state: 'error',
      startedAt,
      finishedAt: new Date().toISOString(),
      totalCourses: enabledCourses.length,
      completedCourses: 0,
      currentCourseName: '',
      detectedCount: assignmentMap.size,
      errorMessage: String(error),
    })

    return {
      ok: false,
      reason: 'error',
      errorMessage: String(error),
    }
  } finally {
    isAssignmentScanning = false
  }
}

async function scanDeadlinesInBackground() {
  if (isDeadlineScanning) {
    return {
      ok: false,
      reason: 'already_running',
    }
  }

  isDeadlineScanning = true

  const startedAt = new Date().toISOString()
  const candidates = await getAssignmentCandidates()
  const assignments = []

  await saveAssignments([])

  await saveDeadlineScanStatus({
    state: 'running',
    startedAt,
    finishedAt: null,
    totalItems: candidates.length,
    completedItems: 0,
    currentItemTitle: '開始準備中...',
    detectedCount: 0,
    errorMessage: null,
  })

  try {
    await mapWithConcurrency(
      candidates,
      5,
      async (candidate) => {
        const response = await fetch(candidate.url, {
          credentials: 'include',
        })

        if (!response.ok) {
          return null
        }

        const html = await response.text()
        const plainText = htmlToPlainText(html)
        const deadlineText = extractDeadlineText(plainText)
        const deadline = deadlineText ? parseDeadline(deadlineText) : null
        const submissionStatus = extractSubmissionStatus(plainText, candidate.url)
        const now = new Date().toISOString()

        let lifecycleStatus = 'active'

if (isBeforeStart(plainText)) {
  lifecycleStatus = 'before_start'
} else if (
  submissionStatus === 'submitted' ||
  submissionStatus === 'completed'
) {
  lifecycleStatus = 'submitted'
} else if (isDeadlinePassed(deadline)) {
  lifecycleStatus = 'passed'
}


        if (submissionStatus === 'submitted' || submissionStatus === 'completed') {
          lifecycleStatus = 'submitted'
        } else if (isDeadlinePassed(deadline)) {
          lifecycleStatus = 'passed'
        }

        return {
          id: candidate.id,
          courseId: candidate.courseId,
          courseName: candidate.courseName,
          title: candidate.title,
          url: candidate.url,
          deadline,
          deadlineText,
          sourceText: plainText.slice(0, 1200),
          submissionStatus,
          lifecycleStatus,
          detectedAt: candidate.detectedAt,
          firstSeenAt: now,
          lastSeenAt: now,
          lastCheckedAt: now,
        }
      },
      async (completed, candidate, results) => {
        assignments.length = 0
        assignments.push(...results)

        await saveAssignments(assignments)

        await notifyDeadlineSummary(assignments)

        await saveDeadlineScanStatus({
        state: 'completed',
        })
      },
    )

    const finishedAt = new Date().toISOString()
    const detectedCount = assignments.filter(
      (assignment) => assignment.deadline,
    ).length

    await saveAssignments(assignments)

    await saveDeadlineScanStatus({
      state: 'completed',
      startedAt,
      finishedAt,
      totalItems: candidates.length,
      completedItems: candidates.length,
      currentItemTitle: '',
      detectedCount,
      errorMessage: null,
    })

    return {
      ok: true,
      detectedCount,
    }
  } catch (error) {
    await saveDeadlineScanStatus({
      state: 'error',
      startedAt,
      finishedAt: new Date().toISOString(),
      totalItems: candidates.length,
      completedItems: 0,
      currentItemTitle: '',
      detectedCount: assignments.filter((assignment) => assignment.deadline)
        .length,
      errorMessage: String(error),
    })

    return {
      ok: false,
      reason: 'error',
      errorMessage: String(error),
    }
  } finally {
    isDeadlineScanning = false
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[LMS Task Watcher] received message', message)

  if (message?.type === 'START_ASSIGNMENT_SCAN') {
    if (isAssignmentScanning) {
      sendResponse({
        ok: false,
        reason: 'already_running',
      })

      return false
    }

    sendResponse({
      ok: true,
      reason: 'started',
    })

    const scanLevel = message.scanLevel ?? 'standard'

    scanAssignmentCandidatesInBackground(scanLevel).catch((error) => {
      console.error('[LMS Task Watcher] background assignment scan failed', error)
    })

    return false
  }

  if (message?.type === 'START_DEADLINE_SCAN') {
    if (isDeadlineScanning) {
      sendResponse({
        ok: false,
        reason: 'already_running',
      })

      return false
    }

    sendResponse({
      ok: true,
      reason: 'started',
    })

    scanDeadlinesInBackground().catch((error) => {
      console.error('[LMS Task Watcher] background deadline scan failed', error)
    })

    return false
  }

  return false
})