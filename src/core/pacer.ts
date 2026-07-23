/**
 * LETUS へのリクエストを一定間隔に均すためのゲート。
 *
 * 設計: docs/superpowers/specs/2026-07-10-letus-request-pacing-design.md
 *
 * 1サイクルのスキャンは「ログイン確認1 + コースページN + 課題ページM」で、
 * 10コース×10課題なら約112リクエストになる。同時実行3/5でリクエスト間の待ちが
 * 無いため、瞬間密度が人間の巡回から逸脱する。総量ではなく密度が問題であり、
 * レートリミッタやWAFが見るのも req/s である。
 *
 * 並列数を絞る方式やワーカー内 sleep 方式では、実効レートがサーバーの応答速度に
 * 依存してしまう（速いサーバーほど強く叩く）。制御したい量を直接制御するため、
 * 発射間隔そのものを共有ゲートで固定する。
 */

/** 発射の最小間隔。180ms = 約5.5 req/s。112リクエストで約20秒。 */
export const LETUS_MIN_REQUEST_GAP_MS = 180

export type Pacer = {
  /** 次の発射が許可されるまで待つ。 */
  acquire(): Promise<void>
}

export type PacerDeps = {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const defaultDeps: PacerDeps = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export function createPacer(minIntervalMs: number, deps: PacerDeps = defaultDeps): Pacer {
  let nextAt = 0

  return {
    async acquire(): Promise<void> {
      const now = deps.now()
      const at = Math.max(now, nextAt)
      // await より前に同期的に確定させるのが要点。JavaScript は各コールバックを
      // 最後まで実行してから次へ移るため、同時に呼ばれても順番に枠が割り当てられ、
      // ロックもキューも要らずに 0/180/360/... と整列する。
      nextAt = at + minIntervalMs
      const wait = at - now
      if (wait > 0) await deps.sleep(wait)
    },
  }
}
