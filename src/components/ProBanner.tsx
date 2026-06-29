import { useEffect, useState } from 'react'
import { getAuthToken } from '../core/auth'
import { LoginModal } from './LoginModal'

type Props = {
  apiBaseUrl: string
  onLogin: () => void
}

const FEATURES = [
  '課題にメモ・優先度を設定',
  'ダークテーマ',
  '複数デバイスでデータ同期',
  '限定Discordサーバー招待',
]

export function ProBanner({ apiBaseUrl, onLogin }: Props) {
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState<'subscribe' | 'login'>('subscribe')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')

  useEffect(() => {
    void getAuthToken().then((token) => setIsLoggedIn(!!token))
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
          <span className="proCardTitle">LETUS Task Watcher Pro</span>
          <span className="proBadge">PRO</span>
        </div>

        <ul className="proFeatureList">
          {FEATURES.map((f) => (
            <li key={f} className="proFeatureItem">{f}</li>
          ))}
        </ul>

        {isLoggedIn ? (
          <>
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
            onLogin()
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
