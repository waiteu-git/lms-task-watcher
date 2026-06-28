import type { Course } from '../core/types'

type Props = {
  courses: Course[]
  lastRefreshAt: string | null
}

type Step = 1 | 2 | 3

function resolveStep(courses: Course[], _lastRefreshAt: string | null): Step {
  if (courses.length === 0) return 1
  if (courses.filter((c) => c.enabled).length === 0) return 2
  return 3
}

export function OnboardingBanner({ courses, lastRefreshAt: _lastRefreshAt }: Props) {
  if (_lastRefreshAt !== null) return null

  const step = resolveStep(courses, _lastRefreshAt)

  function openLetus() {
    void chrome.tabs.create({ url: 'https://letus.ed.tus.ac.jp' })
  }

  function openDashboard() {
    void chrome.tabs.create({ url: chrome.runtime.getURL('index.html#dashboard') })
  }

  return (
    <div className="onboardingBanner">
      <div className="onboardingStep">
        {step === 1 && (
          <>
            <p className="onboardingStepLabel">ステップ 1 / 3</p>
            <p className="onboardingText">
              まず LETUS にアクセスしてください。コースページを開くと自動で登録されます。
            </p>
            <button type="button" className="onboardingBtn" onClick={openLetus}>
              LETUS を開く →
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <p className="onboardingStepLabel">ステップ 2 / 3</p>
            <p className="onboardingText">
              ダッシュボードを開いて、追跡したいコースにチェックを入れてください。
            </p>
            <button type="button" className="onboardingBtn" onClick={openDashboard}>
              ダッシュボードを開く →
            </button>
          </>
        )}
        {step === 3 && (
          <>
            <p className="onboardingStepLabel">ステップ 3 / 3</p>
            <p className="onboardingText">
              準備完了！「今すぐ更新」を押して課題を取得してください。
            </p>
          </>
        )}
      </div>
    </div>
  )
}
