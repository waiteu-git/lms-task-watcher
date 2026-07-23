import { describe, it, expect, vi } from 'vitest'
import { createKeepAlive } from './keepAlive'

describe('createKeepAlive', () => {
  it('最初の acquire で start を1回だけ呼ぶ（多重取得では再起動しない）', () => {
    const start = vi.fn()
    const stop = vi.fn()
    const k = createKeepAlive({ start, stop })
    k.acquire()
    k.acquire()
    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).not.toHaveBeenCalled()
    expect(k.active).toBe(true)
  })

  it('最後の release で初めて stop を呼ぶ（途中の release では止めない）', () => {
    const start = vi.fn()
    const stop = vi.fn()
    const k = createKeepAlive({ start, stop })
    k.acquire()
    k.acquire()
    k.release()
    expect(stop).not.toHaveBeenCalled()
    expect(k.active).toBe(true)
    k.release()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(k.active).toBe(false)
  })

  it('0→1 の遷移ごとに start が呼ばれる（再取得で再起動）', () => {
    const start = vi.fn()
    const stop = vi.fn()
    const k = createKeepAlive({ start, stop })
    k.acquire()
    k.release()
    k.acquire()
    expect(start).toHaveBeenCalledTimes(2)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('余分な release は無害（カウントは負にならず stop も呼ばれない）', () => {
    const start = vi.fn()
    const stop = vi.fn()
    const k = createKeepAlive({ start, stop })
    k.release()
    expect(stop).not.toHaveBeenCalled()
    expect(k.active).toBe(false)
    k.acquire()
    expect(start).toHaveBeenCalledTimes(1)
  })
})
