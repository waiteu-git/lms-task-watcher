import { describe, it, expect } from 'vitest'
import { computeBadgeState, isSameBadgeState, normalizeAssignmentUrl } from './badgeState'
import type { Assignment } from './types'
import type { ManualAssignment } from './manualAssignment'

const URL = 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=123'

function assignment(over: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a', courseId: 'c', courseName: '', title: '', url: URL,
    deadline: '2026-07-12T14:00:00.000Z', deadlineText: '', deadlineSource: null, sourceText: '',
    submissionStatus: 'not_submitted', lifecycleStatus: 'active',
    detectedAt: '', firstSeenAt: '', lastSeenAt: '', lastCheckedAt: '',
    ...over,
  }
}

function manual(over: Partial<ManualAssignment> = {}): ManualAssignment {
  return {
    id: 'm', courseId: 'c', courseName: '', title: '', letusUrl: URL,
    deadline: '2026-07-12T14:00:00.000Z', memo: '', submitted: false, createdAt: '',
    ...over,
  }
}

describe('normalizeAssignmentUrl', () => {
  it('フラグメントを落とす', () => {
    expect(normalizeAssignmentUrl(`${URL}#section-1`)).toBe(URL)
  })
})

describe('isSameBadgeState', () => {
  it('提出状態が変われば別状態と判定する', () => {
    const before = computeBadgeState(URL, [assignment()], [])
    const after = computeBadgeState(URL, [assignment({ submissionStatus: 'submitted' })], [])
    expect(isSameBadgeState(before, after)).toBe(false)
    expect(isSameBadgeState(before, before)).toBe(true)
  })
})

describe('computeBadgeState', () => {
  it('スキャン済み・未提出は scanned/submitted:false', () => {
    const s = computeBadgeState(URL, [assignment()], [])
    expect(s).toEqual({ kind: 'scanned', submitted: false, deadline: '2026-07-12T14:00:00.000Z' })
  })

  it('submissionStatus が submitted なら submitted:true', () => {
    const s = computeBadgeState(URL, [assignment({ submissionStatus: 'submitted' })], [])
    expect(s).toMatchObject({ kind: 'scanned', submitted: true })
  })

  it('submissionStatus が completed なら submitted:true', () => {
    const s = computeBadgeState(URL, [assignment({ submissionStatus: 'completed' })], [])
    expect(s).toMatchObject({ kind: 'scanned', submitted: true })
  })

  it('lifecycleStatus が submitted なら submitted:true', () => {
    const s = computeBadgeState(URL, [assignment({ lifecycleStatus: 'submitted' })], [])
    expect(s).toMatchObject({ kind: 'scanned', submitted: true })
  })

  it('フラグメント違いのURLでも突合する', () => {
    const s = computeBadgeState(`${URL}#top`, [assignment()], [])
    expect(s).toMatchObject({ kind: 'scanned' })
  })

  it('スキャン済みが無ければ手動課題を見る', () => {
    const s = computeBadgeState(URL, [], [manual({ submitted: true })])
    expect(s).toEqual({ kind: 'manual', id: 'm', submitted: true, deadline: '2026-07-12T14:00:00.000Z' })
  })

  it('スキャン済みは手動課題より優先する', () => {
    const s = computeBadgeState(URL, [assignment()], [manual()])
    expect(s.kind).toBe('scanned')
  })

  it('どちらにも無ければ unadded', () => {
    expect(computeBadgeState(URL, [], [])).toEqual({ kind: 'unadded' })
  })

  it('URLの無いレコードは突合対象にしない', () => {
    expect(computeBadgeState(URL, [assignment({ url: '' })], [manual({ letusUrl: null })])).toEqual({
      kind: 'unadded',
    })
  })
})
