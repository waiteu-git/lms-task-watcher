import type { Course } from '../core/types'
import {
  resolveOnboardingStep,
  ONBOARDING_STEP_ORDER,
} from '../core/onboardingStep'

type Props = {
  courses: Course[]
  lastRefreshAt: string | null
  hasTimetable: boolean
}

const STEP_TOTAL = ONBOARDING_STEP_ORDER.length

export function OnboardingBanner({ courses, lastRefreshAt, hasTimetable }: Props) {
  if (lastRefreshAt !== null) return null

  const step = resolveOnboardingStep(hasTimetable, courses)
  const stepNumber = ONBOARDING_STEP_ORDER.indexOf(step) + 1

  function openClass() {
    void chrome.tabs.create({ url: 'https://class.admin.tus.ac.jp/' })
  }

  function openLetus() {
    void chrome.tabs.create({ url: 'https://letus.ed.tus.ac.jp' })
  }

  function openDashboard() {
    void chrome.tabs.create({ url: chrome.runtime.getURL('index.html#dashboard') })
  }

  return (
    <div className="onboardingBanner">
      <div className="onboardingStep">
        <p className="onboardingStepLabel">ステップ {stepNumber} / {STEP_TOTAL}</p>
        {step === 'timetable' && (
          <>
            <p className="onboardingText">
              まず CLASS を開き、上部メニューの「履修」→「学生時間割表」を表示してください。
              画面に時間割が出ると自動で取り込みます。
            </p>
            <button type="button" className="onboardingBtn" onClick={openClass}>
              CLASS を開く →
            </button>
          </>
        )}
        {step === 'letus' && (
          <>
            <p className="onboardingText">
              次に LETUS にアクセスしてください。コースページを開くと自動で登録されます。
            </p>
            <button type="button" className="onboardingBtn" onClick={openLetus}>
              LETUS を開く →
            </button>
          </>
        )}
        {step === 'dashboard' && (
          <>
            <p className="onboardingText">
              ダッシュボードを開いて、追跡したいコースにチェックを入れてください。
            </p>
            <button type="button" className="onboardingBtn" onClick={openDashboard}>
              ダッシュボードを開く →
            </button>
          </>
        )}
        {step === 'update' && (
          <p className="onboardingText">
            準備完了！「今すぐ更新」を押して課題を取得してください。
          </p>
        )}
      </div>
    </div>
  )
}
