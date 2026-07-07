import { useEffect, useState } from 'react'
import { getCachedSyllabus, fetchAndCacheSyllabus, type SyllabusCache } from '../core/syllabusStore'
import { buildSyllabusUrlByYear } from '../core/syllabus'

export function SyllabusModal({
  year,
  code,
  courseName,
  onClose,
}: {
  year: number
  code: string
  courseName: string
  onClose: () => void
}) {
  const [state, setState] = useState<'loading' | 'error' | 'loaded'>('loading')
  const [cache, setCache] = useState<SyllabusCache | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const c = (await getCachedSyllabus(year, code)) ?? (await fetchAndCacheSyllabus(year, code))
        if (cancelled) return
        setCache(c)
        setState('loaded')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => { cancelled = true }
  }, [year, code])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function refresh() {
    setState('loading')
    try {
      setCache(await fetchAndCacheSyllabus(year, code))
      setState('loaded')
    } catch {
      setState('error')
    }
  }

  const url = buildSyllabusUrlByYear(code, year)

  return (
    <div className="syllabusOverlay" onClick={onClose}>
      <div className="syllabusModal" onClick={(e) => e.stopPropagation()}>
        <div className="syllabusModalHead">
          <div>
            <div className="syllabusModalTitle">{cache?.doc.titleJa || courseName}</div>
            {cache?.doc.titleEn && <div className="syllabusModalSub">{cache.doc.titleEn}</div>}
            <div className="syllabusModalCode">{code}</div>
          </div>
          <div className="syllabusModalActions">
            <button type="button" onClick={() => void refresh()} title="再取得">↻</button>
            <button type="button" onClick={onClose} title="閉じる">✕</button>
          </div>
        </div>

        {state === 'loading' && <p className="syllabusMsg">読み込み中…</p>}

        {state === 'error' && (
          <p className="syllabusMsg">
            シラバスを取得できませんでした。{' '}
            <button type="button" className="syllabusRetry" onClick={() => void refresh()}>再試行</button>{' '}
            <a href={url} target="_blank" rel="noreferrer">CLASSで開く</a>
          </p>
        )}

        {state === 'loaded' && cache && (
          cache.doc.sections.length === 0 ? (
            <p className="syllabusMsg">
              内容を読み取れませんでした。 <a href={url} target="_blank" rel="noreferrer">CLASSで開く</a>
            </p>
          ) : (
            <div className="syllabusBody">
              {cache.doc.sections.map((s, i) => (
                <section key={i} className="syllabusSection">
                  {s.label && <h3 className="syllabusLabel">{s.label}</h3>}
                  {s.value && <div className="syllabusValue">{s.value}</div>}
                </section>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
