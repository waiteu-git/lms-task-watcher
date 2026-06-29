import { useState } from 'react'
import { saveAuthSession } from '../core/auth'

type Props = {
  apiBaseUrl: string
  initialMode?: 'subscribe' | 'login'
  onSuccess: () => void
  onClose: () => void
}

type Mode = 'subscribe' | 'login'

export function LoginModal({ apiBaseUrl, initialMode = 'subscribe', onSuccess, onClose }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkoutOpened, setCheckoutOpened] = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (mode === 'subscribe') {
        const regRes = await fetch(`${apiBaseUrl}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        const regData = await regRes.json() as { token?: string; expiresAt?: string; error?: string }

        if (!regRes.ok) {
          if (regData.error?.includes('already')) {
            setError('このメールアドレスは登録済みです。ログインしてください。')
          } else {
            setError(regData.error ?? 'エラーが発生しました')
          }
          return
        }

        if (!regData.token || !regData.expiresAt) return
        await saveAuthSession(regData.token, regData.expiresAt, email)

        const checkRes = await fetch(`${apiBaseUrl}/api/subscription/checkout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${regData.token}` },
        })
        const checkData = await checkRes.json() as { url?: string; error?: string }

        if (!checkRes.ok || !checkData.url) {
          setError(checkData.error ?? 'チェックアウトの開始に失敗しました（登録は完了しています）')
          return
        }

        chrome.tabs.create({ url: checkData.url })
        setCheckoutOpened(true)
      } else {
        const res = await fetch(`${apiBaseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        const data = await res.json() as { token?: string; expiresAt?: string; error?: string }

        if (!res.ok) {
          setError(data.error ?? 'メールアドレスまたはパスワードが正しくありません')
          return
        }

        if (data.token && data.expiresAt) {
          await saveAuthSession(data.token, data.expiresAt, email)
          onSuccess()
        }
      }
    } catch {
      setError('サーバーに接続できませんでした')
    } finally {
      setLoading(false)
    }
  }

  if (checkoutOpened) {
    return (
      <div className="proModal">
        <div className="proModalCard">
          <p className="proModalTitle">決済ページを開きました</p>
          <p className="proModalSubtitle">
            Stripeで決済が完了すると、自動的にサブスクが有効になります。
          </p>
          <div className="proModalNote">
            決済完了後、拡張機能を再度開くとプレミアム機能が使えるようになります。
          </div>
          <button type="button" className="proModalSubmitBtn" style={{ marginTop: '16px' }} onClick={onSuccess}>
            閉じる
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="proModal">
      <div className="proModalCard">
        <button type="button" className="proModalClose" onClick={onClose}>×</button>

        <p className="proModalTitle">
          {mode === 'subscribe' ? 'LETUS Premium に登録' : 'ログイン'}
        </p>
        <p className="proModalSubtitle">
          {mode === 'subscribe'
            ? '登録後、Stripeの決済ページへ移動します。'
            : 'アカウントにログインしてください。'}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="proModalField">
            <label className="proModalLabel">メールアドレス</label>
            <input
              className="proModalInput"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              required
              autoFocus
            />
          </div>

          <div className="proModalField">
            <label className="proModalLabel">パスワード（8文字以上）</label>
            <input
              className="proModalInput"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>

          {error && <p className="proModalError">{error}</p>}

          <button type="submit" className="proModalSubmitBtn" disabled={loading}>
            {loading
              ? '処理中...'
              : mode === 'subscribe'
                ? '登録してStripeへ進む →'
                : 'ログイン'}
          </button>
        </form>

        <p className="proModalSwitch">
          {mode === 'subscribe' ? (
            <>
              既にアカウントをお持ちの方は{' '}
              <button type="button" onClick={() => switchMode('login')}>ログイン</button>
            </>
          ) : (
            <>
              アカウントをお持ちでない方は{' '}
              <button type="button" onClick={() => switchMode('subscribe')}>新規登録</button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
