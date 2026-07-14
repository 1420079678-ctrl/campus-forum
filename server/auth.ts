import { randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { db } from './db.js'

export { hashPassword, verifyPassword } from './password.js'

export type Role = 'student' | 'teacher' | 'staff' | 'moderator' | 'admin'

export type SessionUser = {
  id: number
  username: string
  nickname: string
  avatar: string
  role: Role
  dept: string
  grade: string
  bio: string
  verified: boolean
  campus: string
  email: string
  verificationStatus: 'unverified' | 'pending' | 'verified'
  createdAt: string
}

const SESSION_DAYS = 30

export function createSession(userId: number) {
  const token = randomBytes(32).toString('hex')
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).run(token, userId)
  return token
}

export function destroySession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function userFromToken(token: string | undefined): SessionUser | null {
  if (!token) return null
  const row = db.prepare(`
    SELECT u.id, u.username, u.nickname, u.avatar, u.role, u.dept, u.grade, u.bio, u.verified,
      u.campus, u.email, u.verification_status as verificationStatus, u.created_at as createdAt
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now') AND u.status = 'active'
  `).get(token) as (Omit<SessionUser, 'verified'> & { verified: number }) | undefined
  if (!row) return null
  return { ...row, verified: Boolean(row.verified) }
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser | null
    }
  }
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  req.user = userFromToken(token)
  next()
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: '请先登录' })
  next()
}

export function requireVerified(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: '请先登录' })
  if (!req.user.verified) return res.status(403).json({ error: '完成校园邮箱验证后即可参与社区互动' })
  next()
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' })
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: '没有权限执行此操作' })
    next()
  }
}

export function canModerate(role: Role) {
  return role === 'moderator' || role === 'admin'
}

export function canHandleNeeds(role: Role) {
  return role === 'staff' || role === 'admin'
}
