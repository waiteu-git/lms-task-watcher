export interface ScanStartResponse {
  ok: boolean
  reason?: string
}

/**
 * START_ASSIGNMENT_SCAN の応答を「次にどうするか」に分類する。
 *
 * - proceed: スキャンが始まったので通常フローを続行
 * - abort:   失敗だが利用者に案内すれば十分な想定内の状態。例外化せず
 *            メッセージだけ出して静かに終える（偽のエラー通知・console.error を出さない）
 * - error:   想定外の失敗。呼び出し側で throw し、エラー通知＋console.error に回す
 *
 * `already_running` は「別の画面/実行が既にスキャン中」という無害なレース状態で、
 * 以前は error 扱い（throw）だったため chrome://extensions のエラー欄を汚し、
 * かつ「更新中にエラーが発生しました」の偽通知を出していた。abort に分類して解消する。
 */
export type ScanStartOutcome =
  | { kind: 'proceed' }
  | { kind: 'abort'; message: string }
  | { kind: 'error'; reason: string }

export function classifyScanStartResponse(response: ScanStartResponse): ScanStartOutcome {
  if (response.ok) {
    return { kind: 'proceed' }
  }

  switch (response.reason) {
    case 'not_logged_in':
      return {
        kind: 'abort',
        message: 'LETUSにログインしてからもう一度試してください。',
      }
    case 'network_error':
      return {
        kind: 'abort',
        message: 'LETUSへの通信に失敗しました。ネットワーク接続を確認してください。',
      }
    case 'already_running':
      return {
        kind: 'abort',
        message: 'すでに更新処理が実行中です。少し待ってから再度試してください。',
      }
    default:
      return { kind: 'error', reason: response.reason ?? 'unknown' }
  }
}
