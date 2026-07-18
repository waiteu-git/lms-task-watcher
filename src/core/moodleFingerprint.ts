/**
 * passive版/レイアウトフィンガープリント（spec§5）: fetch済みHTML文字列から
 * Moodleの版とbodyクラスを読む純粋関数群。
 *
 * 設計原則:
 * - このモジュール自身は fetch しない（追加リクエスト0）。入力は既存fetchレスポンス
 *   またはユーザーが既に開いたページのHTML文字列のみ（piggyback専用）。
 * - chrome.* / DOM に触れない純関数。結果の保存は配線側（chrome.storage.local）の責務。
 * - 版判定はあくまで補助信号。判定不能（null）は矛盾検知（diagnose.ts）に委ねる。
 * - theme/js asset-rev や M.cfg を版の情報源にしない（spec§5の禁止事項:
 *   rev はキャッシュpurge時刻・M.cfg に版情報は無い）。
 */

export interface MoodleVersion {
  major: number
  minor: number
}

export interface MoodleFingerprint {
  /** docs.moodle.org ヘルプリンクから読めた版。読めなければ null */
  version: MoodleVersion | null
  /** body開始タグのclass一覧。bodyやclass属性が無ければ [] */
  bodyClasses: string[]
  /** BS5世代（Moodle 5.0以降）か。版不明なら false（＝現行想定で扱う） */
  bs5: boolean
}

/**
 * docs.moodle.org ヘルプリンクの版セグメント。
 * - ホストは docs.moodle.org 完全一致（mydocs.moodle.org 等のサブドメイン風は除外）。
 * - セグメントは3〜4桁の数字＋直後のスラッシュ（/405/・/501/・/1001/）。
 *   2桁（/39/=3.9旧形式）はLTW対象範囲（4.5以降）に現れないため対象外。
 */
const DOCS_VERSION_RE = /(?<![\w.-])docs\.moodle\.org\/(\d{3,4})\//gi

/**
 * docs.moodle.org ヘルプリンクの版セグメントを抽出して版へ変換する。
 * 例: https://docs.moodle.org/405/ja/... → {major: 4, minor: 5}
 *
 * 変換規則: 末尾2桁がminor・残り先頭がmajor（405→4.5・500→5.0・501→5.1・311→3.11・1001→10.1）。
 *
 * 複数リンク混在時の仕様: **最頻値を採用し、同数なら先頭出現を優先**。
 * ページchrome（フッタ/ヘルプポップオーバー）のリンクは全て稼働版を指す一方、
 * 教員がコース内容へ貼った別版のdocsリンクは少数派になるため、最頻値が最も頑健。
 *
 * 見つからなければ null。
 */
export function extractDocsVersionSegment(html: string): MoodleVersion | null {
  const counts = new Map<string, number>()
  for (const match of String(html).matchAll(DOCS_VERSION_RE)) {
    const segment = match[1]
    counts.set(segment, (counts.get(segment) ?? 0) + 1)
  }

  // Mapは挿入順を保持するため、厳密な「>」比較で同数時は先頭出現が勝つ
  let best: string | null = null
  let bestCount = 0
  for (const [segment, count] of counts) {
    if (count > bestCount) {
      best = segment
      bestCount = count
    }
  }
  if (best === null) return null

  return {
    major: Number.parseInt(best.slice(0, -2), 10),
    minor: Number.parseInt(best.slice(-2), 10),
  }
}

/**
 * body開始タグのclass一覧を抽出する。
 * - 最初の <body ...> タグのみを見る（複数行タグ・シングル/ダブル/無クォート対応）。
 * - body タグや class 属性が無ければ []（メンテページ・非HTML応答等）。
 * - data-class 等の別属性を class と誤認しない。
 */
export function extractBodyClasses(html: string): string[] {
  const bodyTag = /<body\b[^>]*>/i.exec(String(html))
  if (!bodyTag) return []
  const classAttr = /(?<![\w-])class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(bodyTag[0])
  if (!classAttr) return []
  const value = classAttr[1] ?? classAttr[2] ?? classAttr[3] ?? ''
  return value.split(/\s+/).filter((cls) => cls.length > 0)
}

/**
 * BS5世代（Bootstrap5＋再設計Dashboard/My coursesのMoodle 5.0以降）かの判定。
 * 版不明（null）は false = 現行（4.x）想定のまま扱い、破損検知は矛盾検知（diagnose.ts）に委ねる。
 */
export function isBs5Generation(version: MoodleVersion | null): boolean {
  return version !== null && version.major >= 5
}

/**
 * ページHTMLのpassiveフィンガープリントを束ねて返す。
 * 版とbodyクラスは独立に抽出する（片方が読めなくても他方は返る）。
 */
export function fingerprintPage(html: string): MoodleFingerprint {
  const version = extractDocsVersionSegment(html)
  return {
    version,
    bodyClasses: extractBodyClasses(html),
    bs5: isBs5Generation(version),
  }
}
