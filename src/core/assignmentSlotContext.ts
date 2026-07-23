import { createContext } from 'react'
import type { AssignmentSlotInfo } from './timetableLink'

/**
 * 課題ID → 時間割コマ情報（教室・時限・科目コード）の突合マップ。
 * App.tsx が算出して Provider で供給し、AssignmentCard が自分の課題分を引く。
 * 各課題カードにチップJSXを重複挿入せず、描画を一箇所に集約するための context。
 */
export const AssignmentSlotContext = createContext<Record<string, AssignmentSlotInfo>>({})
