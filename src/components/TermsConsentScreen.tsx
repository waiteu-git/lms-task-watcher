import { TERMS_BODY } from '../legal/termsBody'

type Props = {
  onAccept: () => void
}

/**
 * 規約の同意画面。スキップ・閉じる導線を持たない。
 * 同意するまで収集は行われない（実効的な停止は background 側のガードが担う）。
 */
export function TermsConsentScreen({ onAccept }: Props) {
  return (
    <div className="termsConsent">
      <h1 className="termsConsentTitle">ご利用の前に</h1>
      <p className="termsConsentLead">
        LETUS Task Watcher をご利用いただくには、利用規約への同意が必要です。
        同意いただくまで、課題の収集と通知は行いません。
      </p>
      <pre className="termsConsentBody">{TERMS_BODY}</pre>
      <button type="button" className="termsConsentAccept" onClick={onAccept}>
        同意して始める
      </button>
    </div>
  )
}
