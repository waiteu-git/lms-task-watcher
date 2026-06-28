import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStorage: Record<string, unknown> = {}

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: mockStorage[key] })),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(mockStorage, obj)
      }),
    },
  },
})

beforeEach(() => {
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  vi.clearAllMocks()
})

import {
  getManualAssignments,
  addManualAssignment,
  deleteManualAssignment,
  type ManualAssignment,
} from './manualAssignment'

function makeAssignment(overrides?: Partial<ManualAssignment>): ManualAssignment {
  return {
    id: 'test-id-1',
    courseId: 'course-abc',
    courseName: '数理統計学',
    title: 'レポート第5回',
    letusUrl: 'https://letus.ed.tus.ac.jp/mod/forum/discuss.php?d=123',
    deadline: '2026-07-05T23:59:00.000Z',
    memo: '',
    submitted: false,
    createdAt: '2026-06-28T00:00:00.000Z',
    ...overrides,
  }
}

describe('getManualAssignments', () => {
  it('ストレージが空の場合は空配列を返す', async () => {
    const result = await getManualAssignments()
    expect(result).toEqual([])
  })
})

describe('addManualAssignment', () => {
  it('課題を追加できる', async () => {
    const a = makeAssignment()
    await addManualAssignment(a)
    const result = await getManualAssignments()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('test-id-1')
  })

  it('複数追加できる', async () => {
    await addManualAssignment(makeAssignment({ id: 'id-1', title: 'A' }))
    await addManualAssignment(makeAssignment({ id: 'id-2', title: 'B' }))
    const result = await getManualAssignments()
    expect(result).toHaveLength(2)
  })
})

describe('deleteManualAssignment', () => {
  it('指定IDの課題を削除できる', async () => {
    await addManualAssignment(makeAssignment({ id: 'keep' }))
    await addManualAssignment(makeAssignment({ id: 'delete-me' }))
    await deleteManualAssignment('delete-me')
    const result = await getManualAssignments()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('keep')
  })

  it('存在しないIDを削除しても壊れない', async () => {
    await addManualAssignment(makeAssignment())
    await deleteManualAssignment('non-existent')
    const result = await getManualAssignments()
    expect(result).toHaveLength(1)
  })
})
