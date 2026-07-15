/**
 * MV3 の service worker は 30 秒アイドルで終了する（Chrome 公式仕様）。長時間スキャン中は
 * 定期的に軽い拡張 API を呼んでアイドルタイマをリセットし、ポップアップ/ダッシュボードを
 * 閉じても最後まで走らせる必要がある。
 *
 * この純ロジックは「延命が必要な区間」を参照カウントで管理する。0→1 の遷移でだけ start、
 * 1→0 の遷移でだけ stop を呼ぶので、課題スキャンと締切スキャンが入れ子/連続しても
 * タイマは1本に集約される。タイマ実体（setInterval と拡張 API 呼び出し）は副作用なので
 * 呼び出し側が deps として注入する（ここは純粋に保ちユニットテスト可能にする）。
 */
export type KeepAliveController = {
  /** 延命区間に入る。最初の1回で start が呼ばれる。 */
  acquire: () => void
  /** 延命区間を抜ける。最後の1回で stop が呼ばれる。 */
  release: () => void
  /** 現在延命中か（depth > 0）。 */
  readonly active: boolean
}

export function createKeepAlive(deps: { start: () => void; stop: () => void }): KeepAliveController {
  let depth = 0
  return {
    acquire() {
      depth += 1
      if (depth === 1) deps.start()
    },
    release() {
      if (depth === 0) return
      depth -= 1
      if (depth === 0) deps.stop()
    },
    get active() {
      return depth > 0
    },
  }
}
