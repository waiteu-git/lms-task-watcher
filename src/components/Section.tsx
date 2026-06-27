import type { ReactNode } from 'react'

export function Section({
  title,
  count,
  children,
  emptyText,
}: {
  title: string
  count: number
  children: ReactNode
  emptyText: string
}) {
  return (
    <section className="section">
      <div className="sectionHeader">
        <h2>{title}</h2>
        <span className="sectionCount">{count}件</span>
      </div>

      {count === 0 ? <p className="emptyText">{emptyText}</p> : children}
    </section>
  )
}

export function CollapsibleSection({
  title,
  count,
  children,
  emptyText,
  defaultOpen = false,
}: {
  title: string
  count: number
  children: ReactNode
  emptyText: string
  defaultOpen?: boolean
}) {
  return (
    <details className="collapsibleSection" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        <span>{count}件</span>
      </summary>

      {count === 0 ? <p className="emptyText">{emptyText}</p> : children}
    </details>
  )
}
