import { useState } from 'react'
import { saveAuthSession } from '../core/auth'

type Props = {
  apiBaseUrl: string
  initialMode?: 'subscribe' | 'login'
  onSuccess: () => void
  onClose: () => void
}

type Mode = 'subscribe' | 'login' | 'forgot'

export function LoginModal({ apiBaseUrl, initialMode = 'subscribe', onSuccess, onClose }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkoutOpened, setCheckoutOpened] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)

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
      } else if (mode === 'login') {
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
      } else {
        const res = await fetch(`${apiBaseUrl}/api/auth/request-password-reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        // request-password-resetは常に200を返す仕様（メール列挙対策）なのでres.okのチェックのみ
        if (res.ok) {
          setForgotSent(true)
        } else {
          setError('サーバーに接続できませんでした')
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

  if (forgotSent) {
    return (
      <div className="proModal">
        <div className="proModalCard">
          <p className="proModalTitle">メールを送信しました</p>
          <p className="proModalSubtitle">
            該当するアカウントが存在する場合、パスワード再設定用のリンクをお送りしました。メールをご確認ください。
          </p>
          <button type="button" className="proModalSubmitBtn" style={{ marginTop: '16px' }} onClick={onClose}>
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
          {mode === 'subscribe' ? 'LETUS Premium に登録' : mode === 'login' ? 'ログイン' : 'パスワード再設定'}
        </p>
        <p className="proModalSubtitle">
          {mode === 'subscribe'
            ? '登録後、Stripeの決済ページへ移動します。'
            : mode === 'login'
              ? 'アカウントにログインしてください。'
              : '登録済みのメールアドレスを入力してください。再設定用のリンクをお送りします。'}
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

          {mode !== 'forgot' && (
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
          )}

          {error && <p className="proModalError">{error}</p>}

          <button type="submit" className="proModalSubmitBtn" disabled={loading}>
            {loading
              ? '処理中...'
              : mode === 'subscribe'
                ? '登録してStripeへ進む →'
                : mode === 'login'
                  ? 'ログイン'
                  : '再設定メールを送る'}
          </button>
        </form>

        <p className="proModalSwitch">
          {mode === 'subscribe' ? (
            <>
              既にアカウントをお持ちの方は{' '}
              <button type="button" onClick={() => switchMode('login')}>ログイン</button>
            </>
          ) : mode === 'login' ? (
            <>
              アカウントをお持ちでない方は{' '}
              <button type="button" onClick={() => switchMode('subscribe')}>新規登録</button>
              <br />
              <button type="button" onClick={() => switchMode('forgot')}>パスワードをお忘れですか？</button>
            </>
          ) : (
            <button type="button" onClick={() => switchMode('login')}>ログイン画面に戻る</button>
          )}
        </p>
      </div>
    </div>
  )
}
