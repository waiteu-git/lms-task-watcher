import { describe, it, expect } from 'vitest'
import type { Course } from './types'
import {
  resolveOnboardingStep,
  ONBOARDING_STEP_ORDER,
} from './onboardingStep'

function course(over: Partial<Course> = {}): Course {
  return {
    id: 'c',
    name: '',
    url: '',
    enabled: false,
    lmsType: 'letus',
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

describe('resolveOnboardingStep', () => {
  it('時間割未取込なら、コースの有無に関わらず timetable を最優先で返す', () => {
    expect(resolveOnboardingStep(false, [])).toBe('timetable')
    // コース登録済み・有効化済みでも、時間割が無い間は timetable が先頭に来る
    expect(resolveOnboardingStep(false, [course({ enabled: true })])).toBe('timetable')
  })

  it('時間割取込済み × コース0 なら letus', () => {
    expect(resolveOnboardingStep(true, [])).toBe('letus')
  })

  it('時間割取込済み × コースはあるが有効0 なら dashboard', () => {
    expect(resolveOnboardingStep(true, [course({ enabled: false })])).toBe('dashboard')
  })

  it('時間割取込済み × 有効コストあり なら update', () => {
    expect(resolveOnboardingStep(true, [course({ enabled: true })])).toBe('update')
  })
})

describe('ONBOARDING_STEP_ORDER', () => {
  it('timetable を先頭にした4ステップである', () => {
    expect(ONBOARDING_STEP_ORDER).toEqual(['timetable', 'letus', 'dashboard', 'update'])
  })
})
