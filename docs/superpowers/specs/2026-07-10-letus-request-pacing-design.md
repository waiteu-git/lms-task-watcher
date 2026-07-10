# LETUSリクエストのペーシング 設計

対象: `src/background/index.ts` の fetch 3箇所（`:509` コースページ / `:660` 課題ページ / `:878` ログイン確認）

## 背景

大学サーバーへの負荷監査で、拡張のスキャンが**瞬間密度**の点で人間の巡回から逸脱していることが判明した。

1サイクルの構成は「ログイン確認1 + コースページ N + 課題ページ M」。10コース×10課題なら約112リクエストになる。これを `mapWithConcurrency` が同時実行3（コース）・5（課題）で回し、**リクエスト間の待ちが一切ない**。ワーカーは1件終えると `while` ループの先頭に戻って即座に次を取る。

```ts
const result = await handler(item, currentIndex)
...
completed += 1
await onProgress?.(completed, item, results)
```

キャッシュも条件付きGET（ETag / If-Modified-Since）もないため、毎回フル取得になる。

総量は問題ではない。自動スキャンは24時間に1回（`ALARM_PERIOD_MINUTES = 1440`）で、1日のリクエスト数は真面目な学生の手動巡回と同じオーダーに収まる。危ういのは瞬間密度である。レートリミッタやWAFが見るのは「1日100リクエスト」ではなく「10秒で50リクエスト」であり、現状はその軸で人間離れしている。

リトライは存在しない。fetch 失敗時は `catch { return null }`、`!response.ok` でも `return null` でそのページを捨てる。したがってリトライストームの懸念はなく、本specはバースト密度のみを扱う。

## 目標

popup の「今すぐ更新」でユーザーが待つ時間を **20〜30秒**に収める。112リクエストなら **4〜6 req/s**。

**実測（2026-07-11、実機）**: 128リクエストで33秒、実効3.9 req/s。service worker は殺されず完走した。ペーサーの下限は 128 × 180ms = 23秒で、差の10秒は fetch のレイテンシと、コースページ側が同時実行3で律速される区間から来ている。**`180ms` は下限を決めるだけで、実測はそれより長くなる。** 33秒は許容範囲をわずかに超えるが、間隔を詰めて3秒短縮するために瞬間レートを7割増しにするのは本specの目的に反するため、180ms を据え置くと判断した（2026-07-11）。

## 方針: 共有ペーサー

「前回の発射から最低 N ms 空ける」というゲートを1つ置き、すべての fetch がその手前で `await pacer.acquire()` する。

この方式を選ぶ理由は、**制御したい量を直接制御できる**ことにある。WAFやレートリミッタが見るのは req/s であって並列数ではない。

検討した代替案はいずれもレートがサーバー応答速度に依存する。

- **ワーカー内 sleep**（`mapWithConcurrency` に `minGapMs` を追加）: 実効レートは `並列数 ÷ (fetch時間 + gap)`。LETUSが速い日は速く叩く
- **同時実行数を下げるだけ**（3/5 → 1）: 実効レートは `1 ÷ fetch時間`。LETUSが50msで返せば20 req/s になる

どちらも「速いサーバーほど強く叩く」という、負荷対策として逆向きの性質を持つ。

## モジュール

`src/core/pacer.ts`（新規）。`src/core/` には既にテストが揃っており、純ロジックの置き場という既存の役割に合致する。

```ts
export const LETUS_MIN_REQUEST_GAP_MS = 180

export type Pacer = { acquire(): Promise<void> }

export type PacerDeps = { now: () => number; sleep: (ms: number) => Promise<void> }

export function createPacer(minIntervalMs: number, deps?: PacerDeps): Pacer
```

`180ms` は約5.5 req/s。112リクエストで約20秒となり、目標の下限に収まる。

`acquire()` の実装は共有の `nextAt` を進めるだけである。

```ts
const now = deps.now()
const at = Math.max(now, nextAt)
nextAt = at + minIntervalMs     // await の前に同期的に確定させる
const wait = at - now
if (wait > 0) await deps.sleep(wait)
```

`nextAt` を `await` の**前に**更新するのが要点。JavaScriptは各コールバックを最後まで実行してから次へ移るため、5本のワーカーが同時に `acquire()` を呼んでも、それぞれ 0ms, 180ms, 360ms, 540ms, 720ms 待つ形に自然に整列する。ロックもキューも要らない。

`now` と `sleep` を注入することで、実時間に依存せず決定的にテストできる。既定値は `Date.now` と `setTimeout` ベースの `sleep`。

## 適用

`src/background/index.ts` にモジュールレベルのペーサーを1つ置き、3箇所の fetch の直前で `await pacer.acquire()` する。

ペーサーを共有することで、課題スキャンと締切スキャンが連続して走るときも境目でバーストしない。

`mapWithConcurrency` は変更しない。同時実行3/5はソケット数の上限としてそのまま残る。レートはペーサーが決めるため、並列数はもう負荷を左右しない。

## 適用しないもの

- `src/core/syllabusStore.ts` の fetch: シラバスモーダルを開いたときに1回だけで、`chrome.storage` にキャッシュされる。バーストしない
- `src/background/index.ts:316` と `src/core/premium.ts` の fetch: `API_BASE_URL` が空文字（`VITE_API_BASE_URL` 未定義）のため到達しない。`host_permissions` にも `api.waiteu.dev` はない
- `src/content/classTimetable.ts`: DOM読み取りと `MutationObserver` のみで fetch を発行しない
- 条件付きGET（ETag / If-Modified-Since）: 帯域は減るがリクエスト数は減らず、本specの目的（瞬間密度）とは軸が違う。URLごとの検証子の保存が必要になるため、別specで扱う

## テスト

`src/core/pacer.test.ts`（vitest）。偽の `now` / `sleep` を注入する。

偽の `sleep` は、時刻の更新を `await Promise.resolve()` の後ろに置くこと。現実の `sleep` は呼んだ瞬間に時計を進めないためである。同期的に進めると `Promise.all` の同期スイープの途中で時計が動き、同時実行の待ちが 0/180/360/540/720 ではなく 0/180/180/180/180 になって実挙動を検証できない。実時間タイマーは使わない。

- 初回の `acquire()` は待たない
- 連続して5回呼ぶと、待ち時間が 0, 180, 360, 540, 720 ms になる
- 前回の発射から `minIntervalMs` 以上経過していれば待たない
- 途中で時間が飛んでも `nextAt` が過去に留まらない（`Math.max(now, nextAt)` の検証）
- `sleep` が呼ばれた回数と引数を検証する（待ち0のときは呼ばない）

`background/index.ts` 自体はテストしない。`chrome.*` と `fetch` に依存するため、既存方針どおり純ロジック層のみをテスト対象とする。

## 懸念: MV3 service worker の生存

拡張はMV3の service worker で動く。スキャンが約20秒に延びることで、途中で終了させられるリスクがある。MV3のSWは無操作で30秒後に停止し、`setTimeout` 単体では生存時間が延びない。

大丈夫だと見ている。`mapWithConcurrency` の `onProgress` が1件ごとに `chrome.storage` へ書いており、拡張API呼び出しは無操作タイマーをリセットするためである。20秒はSWの5分ハード上限にも遠く及ばない。

**実測で確認済み（2026-07-11）**: 128リクエスト・33秒のスキャンが最後まで完走した。service worker は停止しなかった。`chrome.alarms` による分割実行は不要。

根拠もコード上で裏付けられている。`mapWithConcurrency` は `onProgress` を全項目で無条件に呼び（fetch失敗で `null` を返したときも）、そこで `chrome.storage` に書く。ペーサーが180ms間隔で発射するため、拡張API呼び出しが30秒以上途切れる窓は存在しない。

なお仮に service worker が殺されると、メモリ上の `isAssignmentScanning` は消える一方、永続化されたスキャン状態は `running` のまま残り、popup が180秒／240秒のウォッチドッグまでポーリングし続けてエラーになる。これが回避すべき失敗の姿だった。

## スコープ外

- litus 側の `LetusSyncEngine.tsx` への同種のディレイ導入（別リポジトリ・別spec）
- 条件付きGETとキャッシュ
