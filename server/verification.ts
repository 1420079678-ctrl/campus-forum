import { randomInt } from 'node:crypto'
import { db } from './db.js'
import { hashPassword, verifyPassword, type SessionUser } from './auth.js'
import { HttpError } from './store.js'

const campusName = process.env.CAMPUS_NAME?.trim() || '嘉兴大学'

function allowedDomains() {
  return (process.env.CAMPUS_EMAIL_DOMAINS ?? 'zjxu.edu.cn')
    .split(',')
    .map((item) => item.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
}

function normalizeCampusEmail(value: string) {
  const email = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, '请输入有效的校园邮箱')
  const domain = email.split('@')[1]
  const allowed = allowedDomains().some((item) => domain === item || domain.endsWith(`.${item}`))
  if (!allowed) throw new HttpError(400, `请使用学校邮箱验证（允许域名：${allowedDomains().join('、')}）`)
  return email
}

async function deliverCode(email: string, code: string) {
  const webhook = process.env.VERIFICATION_WEBHOOK_URL?.trim()
  if (!webhook) return
  const response = await fetch(webhook, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.VERIFICATION_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.VERIFICATION_WEBHOOK_TOKEN}` } : {}),
    },
    body: JSON.stringify({ email, code, campus: campusName, purpose: 'campus-forum-verification' }),
  })
  if (!response.ok) throw new Error(`verification webhook HTTP ${response.status}`)
}

export async function requestCampusVerification(viewer: SessionUser, rawEmail: string) {
  if (viewer.verified) throw new HttpError(400, '校园身份已经验证')
  const email = normalizeCampusEmail(rawEmail)
  const code = String(randomInt(100000, 1000000))
  db.prepare(`
    INSERT INTO verification_codes (user_id, email, code_hash, attempts, expires_at)
    VALUES (?, ?, ?, 0, datetime('now', '+10 minutes'))
    ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, code_hash = excluded.code_hash,
      attempts = 0, expires_at = excluded.expires_at, created_at = CURRENT_TIMESTAMP
  `).run(viewer.id, email, hashPassword(code))
  db.prepare("UPDATE users SET email = ?, verification_status = 'pending' WHERE id = ?").run(email, viewer.id)
  try {
    await deliverCode(email, code)
  } catch (error) {
    console.error('Failed to deliver campus verification code:', error)
    throw new HttpError(502, '验证码发送失败，请稍后再试')
  }
  return {
    email,
    expiresIn: 600,
    ...(process.env.NODE_ENV !== 'production' && !process.env.VERIFICATION_WEBHOOK_URL ? { devCode: code } : {}),
  }
}

export function confirmCampusVerification(viewer: SessionUser, code: string) {
  const row = db.prepare(`
    SELECT email, code_hash as codeHash, attempts FROM verification_codes
    WHERE user_id = ? AND expires_at > datetime('now')
  `).get(viewer.id) as { email: string; codeHash: string; attempts: number } | undefined
  if (!row) throw new HttpError(400, '验证码不存在或已过期，请重新获取')
  if (row.attempts >= 5) throw new HttpError(429, '验证码尝试次数过多，请重新获取')
  if (!verifyPassword(code, row.codeHash)) {
    db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE user_id = ?').run(viewer.id)
    throw new HttpError(400, '验证码不正确')
  }
  db.transaction(() => {
    db.prepare("UPDATE users SET verified = 1, verification_status = 'verified', email = ?, campus = ? WHERE id = ?")
      .run(row.email, campusName, viewer.id)
    db.prepare('DELETE FROM verification_codes WHERE user_id = ?').run(viewer.id)
  })()
  return { verified: true, email: row.email, campus: campusName }
}

export function campusVerificationMeta() {
  return { campusName, emailDomains: allowedDomains() }
}
