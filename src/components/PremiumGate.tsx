import { useEffect, useState, type ReactNode } from 'react'
import {
  getAuthToken,
  isSubscriptionActive,
  getSubscriptionState,
  saveSubscriptionCache,
} from '../core/auth'
import { LoginModal } from './LoginModal'

type Props = {
  apiBaseUrl: string
  children: ReactNode
}

type GateState = 'loading' | 'no-login' | 'no-subscription' | 'grace' | 'active' | 'server-error'

async function computeAccess(apiBaseUrl: string): Promise<GateState> {
  const token = await getAuthToken()
  if (!token) return 'no-login'

  const subState = await getSubscriptionState()
  if (subState === 'active') return 'active'
  if (subState === 'grace') return 'grace'

  try {
    const res = await fetch(`${apiBaseUrl}/api/subscription/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) return 'no-subscription'

    const data = await res.json() as { status: string; currentPeriodEnd: string | null }
    await saveSubscriptionCache(data.status, data.currentPeriodEnd)
    return data.status === 'active' ? 'active' : 'no-subscription'
  } catch {
    const active = await isSubscriptionActive()
    return active ? 'grace' : 'server-error'
  }
}

export function PremiumGate({ apiBaseUrl, children }: Props) {
  const [state, setState] = useState<GateState>('loading')
  const [showLogin, setShowLogin] = useState(false)

  useEffect(() => {
    void computeAccess(apiBaseUrl).then(setState)
  }, [apiBaseUrl])

  async function handleCheckout() {
    const token = await getAuthToken()
    if (!token) {
      setShowLogin(true)
      return
    }

    try {
      const res = await fetch(`${apiBaseUrl}/api/subscription/checkout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json() as { url?: string }
      if (data.url) {
        chrome.tabs.create({ url: data.url })
      }
    } catch {
      // サーバーエラー時は案内のみ
    }
  }

  if (state === 'loading') {
    return <div className="premiumLoading">確認中...</div>
  }

  if (state === 'no-login') {
    return (
      <div className="premiumGate">
        <p>この機能はサブスクライバー限定です。</p>
        <button type="button" onClick={() => setShowLogin(true)}>ログイン</button>
        {showLogin && (
          <LoginModal
            apiBaseUrl={apiBaseUrl}
            onSuccess={() => { setShowLogin(false); setState('loading'); void computeAccess(apiBaseUrl).then(setState) }}
            onClose={() => setShowLogin(false)}
          />
        )}
      </div>
    )
  }

  if (state === 'no-subscription') {
    return (
      <div className="premiumGate">
        <p>この機能はサブスクライバー限定です。</p>
        <button type="button" onClick={handleCheckout}>サブスクを始める</button>
      </div>
    )
  }

  if (state === 'server-error') {
    return (
      <div className="premiumGate premiumGraceError">
        <p className="premiumGraceNote">サーバーに接続できません（キャッシュで動作中）</p>
      </div>
    )
  }

  return (
    <>
      {state === 'grace' && (
        <p className="premiumGraceNote">サーバーに接続できませんでした。データはキャッシュから表示しています。</p>
      )}
      {children}
    </>
  )
}
