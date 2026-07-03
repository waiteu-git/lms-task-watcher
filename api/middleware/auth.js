const jwt = require('jsonwebtoken')

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: '認証が必要です' })
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)

    // purposeクレーム付きのトークン（例: discord-oauth用の短命JWT）は
    // 特定用途専用の使い捨て資格情報であり、通常のセッション認証には使えない。
    // ここで弾かないと、5分間有効なoauth用トークンをBearerとして
    // 他の認証必須エンドポイントに再利用できてしまう（トークン種別混同）。
    if (payload.purpose) {
      return res.status(401).json({ error: 'トークンが無効または期限切れです' })
    }

    req.userId = payload.userId
    next()
  } catch {
    return res.status(401).json({ error: 'トークンが無効または期限切れです' })
  }
}

module.exports = { requireAuth }
