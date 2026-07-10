import { useState } from 'react'
import { TERMS_BODY } from '../legal/termsBody'

type Props = {
  onAccept: () => Promise<void>
}

/**
 * 規約の同意画面。スキップ・閉じる導線を持たない。
 * 同意するまで収集は行われない（実効的な停止は background 側のガードが担う）。
 */
export function TermsConsentScreen({ onAccept }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAccept() {
    setIsSubmitting(true)
    setError(null)

    try {
      await onAccept()
      // 成功時は親側で consentState が 'ok' に切り替わり本画面はアンマウントされるため、
      // ここで isSubmitting を戻す必要はない。
    } catch (err) {
      console.error(err)
      setError('保存に失敗しました。もう一度お試しください。')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="termsConsent">
      <h1 className="termsConsentTitle">ご利用の前に</h1>
      <p className="termsConsentLead">
        LETUS Task Watcher をご利用いただくには、利用規約への同意が必要です。
        同意いただくまで、課題の収集と通知は行いません。
      </p>
      <pre className="termsConsentBody">{TERMS_BODY}</pre>
      {error && <p className="termsConsentError">{error}</p>}
      <button
        type="button"
        className="termsConsentAccept"
        onClick={() => void handleAccept()}
        disabled={isSubmitting}
      >
        {isSubmitting ? '保存中…' : '同意して始める'}
      </button>
    </div>
  )
}
