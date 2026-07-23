import { describe, it, expect } from 'vitest'
import { classifyScanStartResponse } from './scanResponse'

describe('classifyScanStartResponse', () => {
  it('ok のときは proceed を返す', () => {
    expect(classifyScanStartResponse({ ok: true })).toEqual({ kind: 'proceed' })
  })

  it('not_logged_in は例外化せず abort（案内メッセージ）にする', () => {
    const outcome = classifyScanStartResponse({ ok: false, reason: 'not_logged_in' })
    expect(outcome.kind).toBe('abort')
    expect(outcome).toEqual({
      kind: 'abort',
      message: 'LETUSにログインしてからもう一度試してください。',
    })
  })

  it('network_error は例外化せず abort（案内メッセージ）にする', () => {
    const outcome = classifyScanStartResponse({ ok: false, reason: 'network_error' })
    expect(outcome).toEqual({
      kind: 'abort',
      message: 'LETUSへの通信に失敗しました。ネットワーク接続を確認してください。',
    })
  })

  it('already_running は「エラー」ではなく無害な abort として扱う（偽エラー通知・console.error を出さないため）', () => {
    const outcome = classifyScanStartResponse({ ok: false, reason: 'already_running' })
    expect(outcome.kind).toBe('abort')
    expect(outcome).toEqual({
      kind: 'abort',
      message: 'すでに更新処理が実行中です。少し待ってから再度試してください。',
    })
  })

  it('未知の reason は error（throw して通知する経路）にフォールバックする', () => {
    expect(classifyScanStartResponse({ ok: false, reason: 'boom' })).toEqual({
      kind: 'error',
      reason: 'boom',
    })
  })

  it('reason 欠落時も error に落とし、reason は unknown で埋める', () => {
    expect(classifyScanStartResponse({ ok: false })).toEqual({
      kind: 'error',
      reason: 'unknown',
    })
  })
})
