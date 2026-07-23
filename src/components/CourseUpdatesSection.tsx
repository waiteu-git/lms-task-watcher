import { useEffect, useState } from 'react'
import type { Course } from '../core/types'
import type { UnreadUpdate } from '../core/courseUpdates'
import { getUnreadUpdates, markUpdateRead, clearCourseUpdates } from '../background/courseUpdatesStore'

type CourseUnread = { course: Course; items: UnreadUpdate[] }

export function CourseUpdatesSection({ courses }: { courses: Course[] }) {
  const [groups, setGroups] = useState<CourseUnread[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const out: CourseUnread[] = []
      for (const course of courses) {
        const items = await getUnreadUpdates(course.id)
        if (items.length > 0) out.push({ course, items })
      }
      if (!cancelled) setGroups(out)
    })()
    return () => { cancelled = true }
  }, [courses, refreshKey])

  const total = groups.reduce((n, g) => n + g.items.length, 0)
  if (total === 0) return null

  async function openItem(courseId: string, item: UnreadUpdate) {
    chrome.tabs.create({ url: item.url })
    await markUpdateRead(courseId, item.url)
    setRefreshKey((k) => k + 1)
  }

  async function clearCourse(courseId: string) {
    await clearCourseUpdates(courseId)
    setRefreshKey((k) => k + 1)
  }

  return (
    <section className="courseUpdatesSection">
      <div className="courseUpdatesHeader">
        <span className="courseUpdatesTitle">コース更新</span>
        <span className="courseUpdatesBadge">{total}</span>
      </div>
      {groups.map((g) => (
        <div key={g.course.id} className="courseUpdatesGroup">
          <div className="courseUpdatesGroupHead">
            <span className="courseUpdatesCourse">{g.course.name}</span>
            <button type="button" className="courseUpdatesClear" onClick={() => void clearCourse(g.course.id)}>
              全既読
            </button>
          </div>
          <ul className="courseUpdatesList">
            {g.items.map((it) => (
              <li key={it.url}>
                <button type="button" className="courseUpdatesItem" onClick={() => void openItem(g.course.id, it)}>
                  <span className="courseUpdatesItemTitle">{it.title}</span>
                  <span className="courseUpdatesItemDate">{new Date(it.detectedAt).toLocaleDateString('ja-JP')}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
