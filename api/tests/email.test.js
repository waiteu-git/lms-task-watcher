process.env.RESEND_API_KEY = 'test-api-key'
process.env.RESEND_FROM_EMAIL = 'noreply@waiteu.dev'

const mockSend = jest.fn()

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}))

const { sendPasswordResetEmail } = require('../lib/email')

describe('sendPasswordResetEmail', () => {
  afterEach(() => {
    mockSend.mockReset()
  })

  it('Resendのemails.sendを正しい引数で呼ぶ', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email_123' }, error: null })

    await sendPasswordResetEmail('user@example.com', 'https://lms.waiteu.dev/reset-password.html?token=abc123')

    expect(mockSend).toHaveBeenCalledWith({
      from: 'noreply@waiteu.dev',
      to: 'user@example.com',
      subject: 'パスワード再設定 - LETUS Task Watcher',
      html: expect.stringContaining('https://lms.waiteu.dev/reset-password.html?token=abc123'),
    })
  })

  it('Resendがerrorを返したら例外を投げる', async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: 'invalid domain' } })

    await expect(
      sendPasswordResetEmail('user@example.com', 'https://lms.waiteu.dev/reset-password.html?token=abc123')
    ).rejects.toThrow('invalid domain')
  })
})
