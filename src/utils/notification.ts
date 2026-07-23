import { NOTIFICATION_TARGETS_KEY } from '../background/storageKeys'

async function saveNotificationTarget(notificationId: string, url: string): Promise<void> {
  const result = await chrome.storage.local.get(NOTIFICATION_TARGETS_KEY)
  const targets = (result[NOTIFICATION_TARGETS_KEY] as Record<string, string> | undefined) ?? {}
  await chrome.storage.local.set({
    [NOTIFICATION_TARGETS_KEY]: { ...targets, [notificationId]: url },
  })
}

export function createNotification(
  id: string,
  title: string,
  message: string,
  url?: string,
): void {
  void (async () => {
    if (url) {
      await saveNotificationTarget(id, url)
    }

    chrome.notifications.create(
      id,
      {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title,
        message,
        priority: 2,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn(
            '[LETUS Task Watcher] notification failed:',
            chrome.runtime.lastError.message,
          )
        }
      },
    )
  })()
}

export function normalizeUpdateError(error: unknown): string {
  const rawMessage = String(error)

  if (rawMessage.includes('already_running')) {
    return 'すでに更新処理が実行中です。少し待ってから再度試してください。'
  }

  if (rawMessage.includes('timeout') || rawMessage.includes('タイムアウト')) {
    return '更新が時間内に完了しませんでした。LETUSにログインしているか、通信状態を確認してください。'
  }

  if (rawMessage.includes('Failed to fetch') || rawMessage.includes('NetworkError')) {
    return 'LETUSへの通信に失敗しました。ネットワーク接続またはLETUSのログイン状態を確認してください。'
  }

  if (rawMessage.includes('課題候補検索')) {
    return '課題候補の検索中に問題が発生しました。対象コースやLETUSのログイン状態を確認してください。'
  }

  if (rawMessage.includes('締切読み取り')) {
    return '締切情報の読み取り中に問題が発生しました。LETUSのページ構成が変わっている可能性があります。'
  }

  return rawMessage
}
