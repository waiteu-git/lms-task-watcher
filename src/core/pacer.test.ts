import { describe, it, expect } from 'vitest'
import { createPacer, LETUS_MIN_REQUEST_GAP_MS } from './pacer'

/**
 * 偽の時計。sleep が呼ばれた分だけ時刻を進める（実時間は使わない）。
 *
 * 時刻の更新は `await Promise.resolve()` を挟んだ後に行う。実際の sleep は
 * 呼び出された瞬間には時計を進めない（時間経過は後から起きる）ため、これを
 * 模倣する必要がある。もし同期的に t を進めてしまうと、Promise.all で複数の
 * acquire() を同時に呼んだ際、各呼び出しの同期処理（now() の読み取り〜
 * nextAt の更新まで）が一続きの同期区間で実行される前提が崩れる。後続の
 * 呼び出しがすでに進んだ時計を読んでしまい、5本同時呼び出しの待ち時間が
 * 本来の 0/180/360/540/720 ではなく 0/180/180/180/180 に潰れてしまう。
 */
function fakeDeps(start = 1000) {
  let t = start
  const sleeps: number[] = []
  return {
    sleeps,
    advance: (ms: number) => {
      t += ms
    },
    deps: {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        await Promise.resolve()
        t += ms
      },
    },
  }
}

describe('createPacer', () => {
  it('初回の acquire は待たない', async () => {
    const f = fakeDeps()
    const pacer = createPacer(180, f.deps)
    await pacer.acquire()
    expect(f.sleeps).toEqual([])
  })

  it('逐次に呼ぶと2回目以降は毎回 minIntervalMs だけ待つ', async () => {
    const f = fakeDeps()
    const pacer = createPacer(180, f.deps)
    for (let i = 0; i < 5; i++) await pacer.acquire()
    expect(f.sleeps).toEqual([180, 180, 180, 180])
  })

  it('同時に5本呼ぶと 0/180/360/540/720 に整列する', async () => {
    const f = fakeDeps()
    const pacer = createPacer(180, f.deps)
    await Promise.all([
      pacer.acquire(),
      pacer.acquire(),
      pacer.acquire(),
      pacer.acquire(),
      pacer.acquire(),
    ])
    // 待ち 0 のぶんは sleep を呼ばない
    expect(f.sleeps).toEqual([180, 360, 540, 720])
  })

  it('前回の発射から minIntervalMs 以上経っていれば待たない', async () => {
    const f = fakeDeps()
    const pacer = createPacer(180, f.deps)
    await pacer.acquire()
    f.advance(500)
    await pacer.acquire()
    expect(f.sleeps).toEqual([])
  })

  it('長く間隔が空いても nextAt は過去に留まらない（次は即時、その次は180待つ）', async () => {
    const f = fakeDeps()
    const pacer = createPacer(180, f.deps)
    await pacer.acquire()
    f.advance(10_000)
    await pacer.acquire()
    await pacer.acquire()
    expect(f.sleeps).toEqual([180])
  })

  it('LETUS_MIN_REQUEST_GAP_MS は 180', () => {
    expect(LETUS_MIN_REQUEST_GAP_MS).toBe(180)
  })
})
