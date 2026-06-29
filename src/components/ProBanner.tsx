import { useState } from 'react'
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

  function openModal(mode: 'subscribe' | 'login') {
    setModalMode(mode)
    setShowModal(true)
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
      </div>

      {showModal && (
        <LoginModal
          apiBaseUrl={apiBaseUrl}
          initialMode={modalMode}
          onSuccess={() => { setShowModal(false); onLogin() }}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
