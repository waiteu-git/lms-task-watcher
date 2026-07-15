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

import { rearmDeadlineNotificationsForId, getNotifiedDeadlineKeys, saveNotifiedDeadlineKeys } from './scanStatus'

describe('rearmDeadlineNotificationsForId', () => {
  it('指定idに紐づく通知済みキーだけを取り除く', async () => {
    await saveNotifiedDeadlineKeys(['a:1h', 'a:24h', 'b:24h'])
    await rearmDeadlineNotificationsForId('a')
    expect(await getNotifiedDeadlineKeys()).toEqual(['b:24h'])
  })

  it('区切り文字込みの前方一致のため、部分一致するidを誤って削除しない（m1 と m10）', async () => {
    await saveNotifiedDeadlineKeys(['m1:24h', 'm10:24h'])
    await rearmDeadlineNotificationsForId('m1')
    expect(await getNotifiedDeadlineKeys()).toEqual(['m10:24h'])
  })

  it('該当キーが無ければストレージへの書き込みをしない', async () => {
    await saveNotifiedDeadlineKeys(['b:24h'])
    vi.clearAllMocks()
    await rearmDeadlineNotificationsForId('a')
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
    expect(await getNotifiedDeadlineKeys()).toEqual(['b:24h'])
  })

  it('通知済みキーが未設定でも例外を投げない', async () => {
    await expect(rearmDeadlineNotificationsForId('a')).resolves.toBeUndefined()
  })
})
