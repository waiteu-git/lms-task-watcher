import type { ReactNode } from 'react'

export function Section({
  title,
  count,
  children,
  emptyText,
  id,
}: {
  title: string
  count: number
  children: ReactNode
  emptyText: string
  /** サマリータイル等からのジャンプ先アンカー */
  id?: string
}) {
  return (
    <section className="section" id={id}>
      <div className="sectionHeader">
        <h2>{title}</h2>
        <span className="sectionCount">{count}件</span>
      </div>

      {count === 0 ? (
        <p className="emptyText">{emptyText}</p>
      ) : (
        <div className="sectionBody">{children}</div>
      )}
    </section>
  )
}

export function CollapsibleSection({
  title,
  count,
  children,
  emptyText,
  defaultOpen = false,
  id,
}: {
  title: string
  count: number
  children: ReactNode
  emptyText: string
  defaultOpen?: boolean
  /** サマリータイル等からのジャンプ先アンカー */
  id?: string
}) {
  return (
    <details className="collapsibleSection" open={defaultOpen} id={id}>
      <summary>
        <span>{title}</span>
        <span>{count}件</span>
      </summary>

      {count === 0 ? (
        <p className="emptyText">{emptyText}</p>
      ) : (
        <div className="sectionBody">{children}</div>
      )}
    </details>
  )
}
