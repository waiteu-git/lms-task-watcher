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

export function PremiumGate({ apiBaseUrl, children }: Props) {
  const [state, setState] = useState<GateState>('loading')
  const [showLogin, setShowLogin] = useState(false)

  async function checkAccess() {
    setState('loading')

    const token = await getAuthToken()
    if (!token) {
      setState('no-login')
      return
    }

    // キャッシュが有効なら即時判定
    const subState = await getSubscriptionState()
    if (subState === 'active') {
      setState('active')
      return
    }
    if (subState === 'grace') {
      setState('grace')
      return
    }

    // サーバーに問い合わせ
    try {
      const res = await fetch(`${apiBaseUrl}/api/subscription/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        setState('no-subscription')
        return
      }

      const data = await res.json() as { status: string; currentPeriodEnd: string | null }
      await saveSubscriptionCache(data.status, data.currentPeriodEnd)

      setState(data.status === 'active' ? 'active' : 'no-subscription')
    } catch {
      // ネットワークエラー: キャッシュベースで判断
      const active = await isSubscriptionActive()
      setState(active ? 'grace' : 'server-error')
    }
  }

  useEffect(() => {
    void checkAccess()
  }, [])

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
            onSuccess={() => { setShowLogin(false); void checkAccess() }}
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
