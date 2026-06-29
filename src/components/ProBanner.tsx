import { useEffect, useState } from 'react'
import { getAuthToken, getAuthEmail } from '../core/auth'
import { LoginModal } from './LoginModal'

type Props = {
  apiBaseUrl: string
  onLogin: () => void
}

const FEATURES = [
  '課題へのメモ・優先度設定',
  'ダークテーマ',
  'クロスデバイス同期（PC・研究室・自宅）',
  '手動での課題追加',
  'LETUS上の登録済みインジケーター',
  '限定 Discord コミュニティ招待',
]

export function ProBanner({ apiBaseUrl, onLogin }: Props) {
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState<'subscribe' | 'login'>('subscribe')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [accountEmail, setAccountEmail] = useState<string | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')

  useEffect(() => {
    void getAuthToken().then((token) => {
      setIsLoggedIn(!!token)
      if (token) void getAuthEmail().then(setAccountEmail)
    })
  }, [])

  function openModal(mode: 'subscribe' | 'login') {
    setModalMode(mode)
    setShowModal(true)
  }

  async function handleDirectCheckout() {
    setCheckoutError('')
    setCheckoutLoading(true)
    try {
      const token = await getAuthToken()
      if (!token) { openModal('login'); return }

      const res = await fetch(`${apiBaseUrl}/api/subscription/checkout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json() as { url?: string; error?: string }

      if (!res.ok || !data.url) {
        setCheckoutError(data.error ?? 'チェックアウトの開始に失敗しました')
        return
      }

      chrome.tabs.create({ url: data.url })
    } catch {
      setCheckoutError('サーバーに接続できませんでした')
    } finally {
      setCheckoutLoading(false)
    }
  }

  return (
    <>
      <div className="proCard">
        <div className="proCardHeader">
          <span className="proCardTitle">LETUS Task Watcher Premium</span>
          <span className="proBadge">Premium</span>
        </div>

        <ul className="proFeatureList">
          {FEATURES.map((f) => (
            <li key={f} className="proFeatureItem">{f}</li>
          ))}
        </ul>

        {isLoggedIn ? (
          <>
            {accountEmail && (
              <p className="proAccountEmail">{accountEmail} でログイン中</p>
            )}
            <button
              type="button"
              className="proSubscribeBtn"
              disabled={checkoutLoading}
              onClick={() => void handleDirectCheckout()}
            >
              {checkoutLoading ? '処理中...' : 'サブスクを始める →'}
            </button>
            {checkoutError && <p className="proModalError" style={{ marginTop: '8px' }}>{checkoutError}</p>}
            <p className="proLoginLink">
              別のアカウントで続ける場合は{' '}
              <button type="button" onClick={() => openModal('login')}>ログイン</button>
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              className="proSubscribeBtn"
              onClick={() => openModal('subscribe')}
            >
              サブスクを始める →
            </button>
            <p className="proLoginLink">
              既にアカウントをお持ちの方は{' '}
              <button type="button" onClick={() => openModal('login')}>ログイン</button>
            </p>
          </>
        )}
      </div>

      {showModal && (
        <LoginModal
          apiBaseUrl={apiBaseUrl}
          initialMode={modalMode}
          onSuccess={() => {
            setShowModal(false)
            setIsLoggedIn(true)
            void getAuthEmail().then(setAccountEmail)
            onLogin()
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
