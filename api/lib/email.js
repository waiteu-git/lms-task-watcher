const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)

async function sendPasswordResetEmail(to, resetUrl) {
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to,
    subject: 'パスワード再設定 - LETUS Task Watcher',
    html: `<p>以下のリンクから新しいパスワードを設定してください（1時間有効）。</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>心当たりがない場合はこのメールを無視してください。</p>`,
  })

  if (error) {
    throw new Error(error.message)
  }
}

module.exports = { sendPasswordResetEmail }
