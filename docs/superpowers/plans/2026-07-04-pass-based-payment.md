# パス型決済 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **実装ゲート:** このプランの着手前に「実装前の外部準備」（Stripe JP で PayPay 有効化・一回払い対応の確認 ＋ 半期/年パスの Stripe Price 作成 ＋ ラズパイ `.env` に `STRIPE_PRICE_HALFYEAR`/`STRIPE_PRICE_YEAR` 追加）が完了していること。未完了なら着手しない。

**Goal:** 現行の月額サブスクに加え、半期パス（¥720）・年パス（¥1,200）の一回払い（PayPay＋カード）を導入し、一回払いを期限付きエンタイトルメントとして扱う。

**Architecture:** 一回払いは `checkout mode:'payment'` で行い、`checkout.session.completed` webhook で `subscriptions.current_period_end` を `max(既存, now)+期間` にスタック加算する。パスは `stripe_subscription_id` を NULL のまま残して月額と区別。失効は「`current_period_end > now`」判定に統一（サーバー `/status`＋クライアント `isSubscriptionActive` 両方）で cron 不要。

**Tech Stack:** Node.js/Express + better-sqlite3 + Stripe（`cd api && npx jest`）、TypeScript/Vite/Vitest（`pnpm exec vitest run src`）、素の HTML/JS（landing）。

## Global Constraints

- 対象worktree/branch: 隔離worktree（`~/dev/wt-pass-payment` 等の専用ブランチ）で作業し、共有ツリー/`main`/ポートを他セッションと共有しない（デスクトップ運用方針）。単一ツリーで進める場合は develop 上で作業しつつ push は必ず確認を挟む
- バックエンド: `api/` のテストは `cd api && npx jest`。拡張: `pnpm exec vitest run src`・`pnpm exec tsc -b`・`pnpm build`
- パス期間: 半期パス=6ヶ月、年パス=12ヶ月。日付加算は `Date.setMonth(getMonth()+months)` を使う（テストは固定時刻でpin）
- パスと月額の区別は `stripe_subscription_id` の NULL 有無。パス処理では `stripe_subscription_id` を変更しない
- 金額のUI表示は購入導線内のみ許容（[[feedback_pricing_display]] は一般UI向け方針）
- env: 月額は既存 `STRIPE_PRICE_ID` を流用（キー名は維持）。パスは `STRIPE_PRICE_HALFYEAR`（本番値 `price_1TphAPFFvmJkAgmIb2lyXFal`）・`STRIPE_PRICE_YEAR`（本番値 `price_1TphCPFFvmJkAgmIaWubZsUk`）。これらはデプロイ時にラズパイ `.env` へ設定（テストはモックのため不要）
- **決済手段はカード先行**。PayPay は Stripe で有効化申請中（審査最大2週間・特商法表記ページURL要）のため即時使用不可。`payment_method_types` は env `STRIPE_PASS_METHODS`（デフォルト `card`）から取得し、PayPay 承認後に `STRIPE_PASS_METHODS=card,paypay` に更新するだけで有効化できる形にする（コード変更不要）
- 不可逆操作（push・ラズパイデプロイ）は自走禁止・確認必須。コミットはローカルのみ
- コミットのフッタは `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## File Structure

- Modify: `api/routes/subscription.js` — `/checkout` の plan 分岐、`/status` の失効正規化＋`hasActiveRecurring`
- Modify: `api/routes/webhook.js` — `checkout.session.completed` の `mode:'payment'`（パス）処理
- Modify: `api/tests/subscription.test.js` — checkout/status のテスト
- Modify: `api/tests/webhook.test.js` — パス webhook のテスト
- Modify: `src/core/auth.ts` — `isSubscriptionActive` の `current_period_end > now` 判定
- Modify: `src/core/auth.test.ts` — 上記テスト
- Modify: `api/.env.example` — パス Price env の記載
- Modify: `landing/register.html`・`landing/mypage.html` — プラン選択 UI ＋二重課金警告

---

### Task 1: checkout の plan 分岐

**Files:**
- Modify: `api/routes/subscription.js`
- Modify: `api/.env.example`
- Test: `api/tests/subscription.test.js`

**Interfaces:**
- Produces: `POST /api/subscription/checkout` が body `{ plan?: 'monthly'|'halfyear'|'year' }` を受ける。パスは `mode:'payment'`＋`metadata.pass_months`

- [ ] **Step 1: 失敗するテストを書く**

`api/tests/subscription.test.js` に追加（Stripe はモック。既存のモック方式に合わせる。無ければ `jest.mock('stripe', ...)` で `checkout.sessions.create` を制御）:

```js
describe('POST /api/subscription/checkout plan分岐', () => {
  it('plan=halfyear で mode:payment と pass_months=6 でセッション作成', async () => {
    mockCreate.mockResolvedValue({ url: 'https://stripe/pay' })
    const res = await request(app)
      .post('/api/subscription/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'halfyear' })
    expect(res.status).toBe(200)
    const arg = mockCreate.mock.calls.at(-1)[0]
    expect(arg.mode).toBe('payment')
    expect(arg.metadata.pass_months).toBe(6)
    // デフォルトはカードのみ（PayPay承認後にenvで追加）
    expect(arg.payment_method_types).toEqual(['card'])
  })

  it('plan=year で pass_months=12', async () => {
    mockCreate.mockResolvedValue({ url: 'u' })
    await request(app).post('/api/subscription/checkout')
      .set('Authorization', `Bearer ${token}`).send({ plan: 'year' })
    expect(mockCreate.mock.calls.at(-1)[0].metadata.pass_months).toBe(12)
  })

  it('plan未指定は mode:subscription（後方互換）', async () => {
    mockCreate.mockResolvedValue({ url: 'u' })
    await request(app).post('/api/subscription/checkout')
      .set('Authorization', `Bearer ${token}`).send({})
    expect(mockCreate.mock.calls.at(-1)[0].mode).toBe('subscription')
  })

  it('不正な plan は 400', async () => {
    const res = await request(app).post('/api/subscription/checkout')
      .set('Authorization', `Bearer ${token}`).send({ plan: 'bogus' })
    expect(res.status).toBe(400)
  })
})
```

（既存 `subscription.test.js` に Stripe モックや `token` セットアップが無ければ、`api/tests/webhook.test.js` のモック方式を参照し、テスト冒頭で `process.env.STRIPE_PRICE_HALFYEAR='price_h'`・`STRIPE_PRICE_YEAR='price_y'`・`STRIPE_PRICE_ID='price_m'` を設定する。`mockCreate` は `stripe().checkout.sessions.create` のモック。）

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd api && npx jest tests/subscription.test.js -t "plan分岐"`
Expected: FAIL

- [ ] **Step 3: `/checkout` を実装する**

`api/routes/subscription.js` の `router.post('/checkout', ...)` を次に置き換える:

```js
const PASS_PLANS = {
  halfyear: { price: () => process.env.STRIPE_PRICE_HALFYEAR, months: 6 },
  year: { price: () => process.env.STRIPE_PRICE_YEAR, months: 12 },
}

// 決済手段はカード先行。PayPay承認後に env STRIPE_PASS_METHODS=card,paypay で追加
function passMethods() {
  return (process.env.STRIPE_PASS_METHODS || 'card').split(',').map((s) => s.trim())
}

router.post('/checkout', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.userId)
  if (!user) {
    return res.status(404).json({ error: 'ユーザーが見つかりません' })
  }

  const plan = req.body?.plan ?? 'monthly'
  if (plan !== 'monthly' && !PASS_PLANS[plan]) {
    return res.status(400).json({ error: '不正なプランです' })
  }

  try {
    let session
    if (plan === 'monthly') {
      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: user.email,
        line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
        success_url: `${process.env.API_BASE_URL}/checkout-success`,
        cancel_url: `${process.env.API_BASE_URL}/checkout-cancel`,
      })
    } else {
      const p = PASS_PLANS[plan]
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: passMethods(),
        customer_email: user.email,
        line_items: [{ price: p.price(), quantity: 1 }],
        metadata: { pass_months: p.months },
        success_url: `${process.env.API_BASE_URL}/checkout-success`,
        cancel_url: `${process.env.API_BASE_URL}/checkout-cancel`,
      })
    }
    return res.json({ url: session.url })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'チェックアウトセッションの作成に失敗しました' })
  }
})
```

（注: `metadata` の値は Stripe が文字列化するが、テストはモックのため数値 `6`/`12` で渡す。実運用では webhook 側で `Number(metadata.pass_months)` する。）

- [ ] **Step 4: `.env.example` にパス Price を追記**

`api/.env.example` の `STRIPE_PRICE_ID=price_...` の後に追加:

```
STRIPE_PRICE_HALFYEAR=price_...
STRIPE_PRICE_YEAR=price_...
# パス決済手段（カンマ区切り）。デフォルトcard。PayPay承認後に card,paypay へ
STRIPE_PASS_METHODS=card
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd api && npx jest tests/subscription.test.js`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add api/routes/subscription.js api/.env.example api/tests/subscription.test.js
git commit -m "feat(api): checkout plan routing for one-time passes (halfyear/year)"
```

---

### Task 2: webhook でパス決済を期限スタック

**Files:**
- Modify: `api/routes/webhook.js`
- Test: `api/tests/webhook.test.js`

**Interfaces:**
- Consumes: Task 1 が `metadata.pass_months` を付与した `checkout.session.completed`（`mode:'payment'`）

- [ ] **Step 1: 失敗するテストを追加**

`api/tests/webhook.test.js` の `describe('POST /api/webhook/stripe', ...)` 内に追加:

```js
  it('mode:payment のパス決済で current_period_end が max(既存,now)+月数 にスタックされる', async () => {
    // 既存の current_period_end を now+10日 に設定
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
    db.prepare('UPDATE subscriptions SET current_period_end = ?, status = ? WHERE user_id = ?')
      .run(future, 'active', userId)

    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: {
        mode: 'payment',
        payment_status: 'paid',
        customer: 'cus_pass',
        customer_email: 'hook@example.com',
        metadata: { pass_months: '6' },
      } },
    })

    const res = await request(app).post('/api/webhook/stripe')
      .set('stripe-signature', 'sig').send(Buffer.from('{}'))
    expect(res.status).toBe(200)

    const sub = db.prepare('SELECT current_period_end, status, stripe_subscription_id FROM subscriptions WHERE user_id = ?').get(userId)
    // 既存 future(+10日) を基点に +6ヶ月されている（now基点でなく既存基点）
    const expected = new Date(future)
    expected.setMonth(expected.getMonth() + 6)
    expect(sub.current_period_end).toBe(expected.toISOString())
    expect(sub.status).toBe('active')
    // パスは subscription_id を作らない
    expect(sub.stripe_subscription_id ?? null).toBe(null)
  })
```

（`userId` と `hook@example.com` は既存 `webhook.test.js` の `beforeAll` で作られたユーザー。`stripe_customer_id` の引き当ては email 経由。基点は固定値 `future`（既存の current_period_end）なので `setMonth(+6)` の結果は決定的に一致比較できる。時刻依存が心配なら `beforeEach` で `jest.useFakeTimers().setSystemTime(...)` を追加してもよい。）

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd api && npx jest tests/webhook.test.js -t "パス決済"`
Expected: FAIL

- [ ] **Step 3: webhook にパス処理を追加する**

`api/routes/webhook.js` の `case 'checkout.session.completed':` ブロックを次に置き換える（既存の subscription 経路は保持し、payment 経路を追加）:

```js
    case 'checkout.session.completed': {
      if (obj.mode === 'subscription') {
        db.prepare(`
          UPDATE subscriptions
          SET stripe_customer_id = ?, stripe_subscription_id = ?, status = 'active', updated_at = datetime('now')
          WHERE user_id = (SELECT id FROM users WHERE email = ?)
        `).run(obj.customer, obj.subscription, obj.customer_email)

        try {
          const sub = await stripe.subscriptions.retrieve(obj.subscription)
          const periodEnd = getPeriodEndIso(sub)
          db.prepare(`
            UPDATE subscriptions
            SET current_period_end = ?, updated_at = datetime('now')
            WHERE stripe_customer_id = ?
          `).run(periodEnd, obj.customer)
        } catch (e) {
          console.error('Failed to fetch subscription period_end:', e.message)
        }
      } else if (obj.mode === 'payment' && obj.payment_status === 'paid') {
        // 一回払いパス: current_period_end を max(既存, now) + pass_months にスタック
        const months = Number(obj.metadata?.pass_months)
        if (months > 0) {
          const email = obj.customer_email ?? obj.customer_details?.email
          const row = db.prepare(
            'SELECT current_period_end FROM subscriptions WHERE user_id = (SELECT id FROM users WHERE email = ?)'
          ).get(email)

          const now = new Date()
          const existing = row?.current_period_end ? new Date(row.current_period_end) : null
          const base = existing && existing > now ? existing : now
          const end = new Date(base)
          end.setMonth(end.getMonth() + months)

          db.prepare(`
            UPDATE subscriptions
            SET stripe_customer_id = ?, status = 'active', current_period_end = ?, updated_at = datetime('now')
            WHERE user_id = (SELECT id FROM users WHERE email = ?)
          `).run(obj.customer, end.toISOString(), email)
        }
      }
      break
    }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd api && npx jest tests/webhook.test.js`
Expected: PASS（既存 webhook テスト含む全件）

- [ ] **Step 5: コミット**

```bash
git add api/routes/webhook.js api/tests/webhook.test.js
git commit -m "feat(api): stack current_period_end on one-time pass payment webhook"
```

---

### Task 3: `/status` の失効正規化＋`hasActiveRecurring`

**Files:**
- Modify: `api/routes/subscription.js`
- Test: `api/tests/subscription.test.js`

**Interfaces:**
- Produces: `/status` が `current_period_end <= now` のとき `status:'inactive'` に正規化。`hasActiveRecurring`（boolean）を返す

- [ ] **Step 1: 失敗するテストを追加**

`api/tests/subscription.test.js` に追加:

```js
describe('GET /api/subscription/status 失効正規化', () => {
  it('current_period_end が過去なら status=inactive に正規化', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    db.prepare('UPDATE subscriptions SET status=?, current_period_end=? WHERE user_id=?')
      .run('active', past, userId)
    const res = await request(app).get('/api/subscription/status')
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.status).toBe('inactive')
  })

  it('未来なら active のまま、hasActiveRecurring は subscription_id 有無で決まる', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    db.prepare('UPDATE subscriptions SET status=?, current_period_end=?, stripe_subscription_id=? WHERE user_id=?')
      .run('active', future, 'sub_x', userId)
    const res = await request(app).get('/api/subscription/status')
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.status).toBe('active')
    expect(res.body.hasActiveRecurring).toBe(true)
  })

  it('パス（subscription_id NULL）は hasActiveRecurring=false', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    db.prepare('UPDATE subscriptions SET status=?, current_period_end=?, stripe_subscription_id=NULL WHERE user_id=?')
      .run('active', future, userId)
    const res = await request(app).get('/api/subscription/status')
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.hasActiveRecurring).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd api && npx jest tests/subscription.test.js -t "失効正規化"`
Expected: FAIL

- [ ] **Step 3: `/status` を実装する**

`api/routes/subscription.js` の `router.get('/status', ...)` を次に置き換える:

```js
router.get('/status', requireAuth, (req, res) => {
  const sub = db.prepare(
    'SELECT status, current_period_end, stripe_customer_id, stripe_subscription_id FROM subscriptions WHERE user_id = ?'
  ).get(req.userId)

  if (!sub) {
    return res.status(404).json({ error: 'サブスクリプション情報が見つかりません' })
  }

  const notExpired = sub.current_period_end
    ? new Date(sub.current_period_end).getTime() > Date.now()
    : false
  const effectiveStatus = sub.status === 'active' && notExpired ? 'active' : 'inactive'
  const hasActiveRecurring = Boolean(sub.stripe_subscription_id) && effectiveStatus === 'active'

  return res.json({
    status: effectiveStatus,
    currentPeriodEnd: sub.current_period_end ?? null,
    hasStripeCustomer: Boolean(sub.stripe_customer_id),
    hasActiveRecurring,
  })
})
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd api && npx jest tests/subscription.test.js`
Expected: PASS

- [ ] **Step 5: 全APIスイート**

Run: `cd api && npx jest`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add api/routes/subscription.js api/tests/subscription.test.js
git commit -m "feat(api): normalize expired status and expose hasActiveRecurring"
```

---

### Task 4: クライアント失効判定（`isSubscriptionActive`）

**Files:**
- Modify: `src/core/auth.ts`
- Test: `src/core/auth.test.ts`

**Interfaces:**
- Consumes: 既存の `getSubscriptionState`・`getSubscriptionCurrentPeriodEnd`

- [ ] **Step 1: 失敗するテストを追加**

`src/core/auth.test.ts` の `describe('isSubscriptionActive', ...)` に追加（既存の chrome-stub パターンに合わせる）:

```ts
it('status active でも current_period_end が過去なら false', async () => {
  await chrome.storage.local.set({
    subscriptionStatus: 'active',
    subscriptionCheckedAt: new Date().toISOString(),
    subscriptionGraceUntil: new Date(Date.now() + 1e10).toISOString(),
    subscriptionCurrentPeriodEnd: new Date(Date.now() - 1000).toISOString(),
  })
  expect(await isSubscriptionActive()).toBe(false)
})

it('current_period_end が未来なら active', async () => {
  await chrome.storage.local.set({
    subscriptionStatus: 'active',
    subscriptionCheckedAt: new Date().toISOString(),
    subscriptionGraceUntil: new Date(Date.now() + 1e10).toISOString(),
    subscriptionCurrentPeriodEnd: new Date(Date.now() + 1e9).toISOString(),
  })
  expect(await isSubscriptionActive()).toBe(true)
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/core/auth.test.ts`
Expected: FAIL（1件目）

- [ ] **Step 3: `isSubscriptionActive` を実装する**

`src/core/auth.ts` の `isSubscriptionActive` を次に置き換える:

```ts
export async function isSubscriptionActive(): Promise<boolean> {
  const state = await getSubscriptionState()
  if (state !== 'active' && state !== 'grace') return false

  // パスの固定期限をクライアント側でも尊重する（期限切れは即時失効）
  const periodEnd = await getSubscriptionCurrentPeriodEnd()
  if (periodEnd && new Date(periodEnd).getTime() <= Date.now()) return false

  return true
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/core/auth.test.ts`
Expected: PASS

- [ ] **Step 5: 型チェック**

Run: `pnpm exec tsc -b`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/core/auth.ts src/core/auth.test.ts
git commit -m "feat(ext): expire entitlement client-side when current_period_end passed"
```

---

### Task 5: UI プラン選択＋二重課金警告

**Files:**
- Modify: `landing/register.html`
- Modify: `landing/mypage.html`

**Interfaces:**
- Consumes: `POST /api/subscription/checkout`（`plan`）、`GET /api/subscription/status`（`hasActiveRecurring`）

- [ ] **Step 1: `mypage.html` の非アクティブ分岐にプラン選択を追加する**

`landing/mypage.html` の `renderStatus` の非アクティブ（`else`）分岐で、単一の「サブスクライブする」ボタンを 3 プラン選択に置き換える。`contentEl.innerHTML` の非アクティブカード内を次の構造にする:

```html
<div class="card status-inactive">
  <p class="card-label">プランを選択</p>
  <div id="plan-warning" class="error" style="display:none;"></div>
  <button class="plan-btn" data-plan="halfyear" type="button">半期パス ¥720（6ヶ月・一回払い）</button>
  <button class="plan-btn" data-plan="year" type="button">年パス ¥1,200（12ヶ月・一回払い）</button>
  <button class="plan-btn secondary" data-plan="monthly" type="button">月額 ¥120</button>
</div>
```

各ボタンの `click` で `startCheckout(plan)` を呼ぶ。`startCheckout` は既存 `subscribeNow` を汎用化したもの:

```js
async function startCheckout(plan) {
  // 継続課金が有効な人がパスを選んだら二重課金警告（購入自体はブロックしない）
  if ((plan === 'halfyear' || plan === 'year') && window.__hasActiveRecurring) {
    const warn = document.getElementById('plan-warning')
    if (warn) {
      warn.textContent = '継続課金の月額が有効です。二重課金を避けるため、先に「支払い方法を管理」から月額を解約してください。'
      warn.style.display = 'block'
    }
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/subscription/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan }),
    })
    const data = await res.json()
    if (!res.ok || !data.url) {
      errorEl.textContent = data.error || 'チェックアウトの開始に失敗しました'
      errorEl.style.display = 'block'
      return
    }
    window.location.href = data.url
  } catch {
    errorEl.textContent = 'サーバーに接続できませんでした'
    errorEl.style.display = 'block'
  }
}
```

非アクティブ分岐のイベント配線を次にする（`subscribe-btn` の代わり）:

```js
document.querySelectorAll('.plan-btn').forEach((b) =>
  b.addEventListener('click', () => startCheckout(b.dataset.plan))
)
```

- [ ] **Step 2: `hasActiveRecurring` を保持する**

`renderStatus(data)` の冒頭で `window.__hasActiveRecurring = Boolean(data.hasActiveRecurring)` を設定する。アクティブ分岐（既に有効）でも、パス追加購入時に警告できるよう保持する。

（アクティブ分岐にもパス追加購入導線を出すかは任意。まずは非アクティブ分岐のみプラン選択を出す。アクティブ分岐は現行の「次回請求日＋支払い方法を管理」を維持。）

- [ ] **Step 3: `register.html` の申し込みボタンをプラン選択にする**

`landing/register.html` の登録後に出るサブスク導線（現状 monthly 固定）があれば、同じ 3 プランボタン＋`startCheckout` 相当に置き換える。register が checkout を直接呼ばずマイページへ誘導している場合はこの Step をスキップし、マイページ側（Step 1）に集約する。実ファイルを読んで現行の導線に合わせる。

- [ ] **Step 4: `.plan-btn` の CSS を追加する**

`mypage.html`（および必要なら `register.html`）の `<style>` に追加:

```css
.plan-btn { margin-bottom: 8px; }
.plan-btn.secondary { background: #fff; color: var(--accent); border: 1.5px solid var(--border); }
```

- [ ] **Step 5: 静的検証**

HTML タグ対応・JS 構文エラーが無いことを目視確認（landing は素の HTML、自動テストなし）。ブラウザで開いて 3 ボタン表示・警告表示ロジックを確認できればなお良い。

- [ ] **Step 6: コミット**

```bash
git add landing/mypage.html landing/register.html
git commit -m "feat(landing): plan selection (passes + monthly) with double-charge warning"
```

---

## 完了条件

- Task 1〜5 の全チェックボックス完了
- `cd api && npx jest` 全件 PASS、`pnpm exec vitest run src` 全件 PASS、`pnpm exec tsc -b`・`pnpm build` 成功
- 月額・半期パス・年パスがチェックアウトでき、パスは card/PayPay で一回払い、`current_period_end` がスタック加算される
- `current_period_end > now` の間だけエンタイトルメント有効（サーバー・クライアント両方）、超過で cron なしに失効
- 月額継続課金が有効なユーザーにパス購入時の二重課金警告が出る
- 既存の月額経路に回帰なし
- **push・ラズパイデプロイは行わず、完了報告時にユーザー確認を得てから実施**
- **前提**: 実装は「実装前の外部準備」（Stripe PayPay 確認＋パス Price 作成＋env 追加）完了後に着手
