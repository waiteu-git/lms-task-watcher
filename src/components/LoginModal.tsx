import { useState } from 'react'
import { saveAuthSession } from '../core/auth'

type Props = {
  apiBaseUrl: string
  onSuccess: () => void
  onClose: () => void
}

type Mode = 'login' | 'register'

export function LoginModal({ apiBaseUrl, onSuccess, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const res = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json() as { token?: string; expiresAt?: string; error?: string }

      if (!res.ok) {
        setError(data.error ?? 'エラーが発生しました')
        return
      }

      if (data.token && data.expiresAt) {
        await saveAuthSession(data.token, data.expiresAt)
        onSuccess()
      }
    } catch {
      setError('サーバーに接続できませんでした')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modalOverlay">
      <div className="modalCard">
        <button type="button" className="modalClose" onClick={onClose}>×</button>
        <h2>{mode === 'login' ? 'ログイン' : '新規登録'}</h2>

        <form onSubmit={handleSubmit}>
          <label>
            メールアドレス
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label>
            パスワード
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>

          {error && <p className="modalError">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading ? '処理中...' : mode === 'login' ? 'ログイン' : '登録する'}
          </button>
        </form>

        <button
          type="button"
          className="modeSwitchBtn"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? '新規登録はこちら' : 'ログインはこちら'}
        </button>
      </div>
    </div>
  )
}
