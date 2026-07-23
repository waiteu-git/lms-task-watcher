import { createContext } from 'react'

/** ダッシュボードでシラバスモーダルを開くコールバック。ポップアップでは null（新規タブ動作にフォールバック）。 */
export type OpenSyllabus = (year: number, code: string, courseName: string) => void
export const SyllabusContext = createContext<OpenSyllabus | null>(null)
