import express from 'express'
import cors from 'cors'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { db } from './db.js'
import {
  attachUser, createSession, destroySession, hashPassword, requireAuth, requireRole, requireVerified,
  verifyPassword, type SessionUser,
} from './auth.js'
import {
  DEPARTMENTS, HttpError, REPORT_REASONS, addNeedUpdate, adminListUsers, adminSaveBoard, adminUpdateUser,
  communityPulse, communityStats, createComment, createNeed, createPost, createReport, deleteComment, deletePost, getPost,
  directUnreadCount, getDirectThread, handleReport, listAuditLogs, listBoards, listComments, listDirectConversations, listNeeds, listNotifications, listPosts,
  markNotificationsRead, moderatePost, moderationOverview, myStats, publicProfile, roleLabel, setFeatured,
  sendDirectMessage, toggleFavorite, toggleFollowNeed, toggleLike, toggleUserFollow, updatePost, updateProfile,
} from './store.js'
import { campusVerificationMeta, confirmCampusVerification, requestCampusVerification } from './verification.js'
import { savePostImage, uploadsDir, validPostImageUrl } from './uploads.js'

const app = express()
const port = Number(process.env.API_PORT ?? 8787)
const host = process.env.HOST ?? '127.0.0.1'
const isProduction = process.env.NODE_ENV === 'production'
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean)

if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (isProduction) {
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'")
  }
  next()
})
app.use((req, res, next) => {
  const origin = req.headers.origin
  const protocol = String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0].trim()
  const ownOrigin = `${protocol}://${req.headers.host}`
  if (origin && isProduction && origin !== ownOrigin && !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: '不允许的跨站请求来源' })
    return
  }
  cors({ origin: true })(req, res, next)
})
app.use(express.json({ limit: '5mb' }))
app.use(attachUser)

// ---------- rate limiting (in-memory sliding window) ----------

const rateBuckets = new Map<string, number[]>()
setInterval(() => {
  const now = Date.now()
  for (const [key, hits] of rateBuckets) {
    const alive = hits.filter((t) => now - t < 10 * 60_000)
    if (alive.length === 0) rateBuckets.delete(key)
    else rateBuckets.set(key, alive)
  }
}, 10 * 60_000).unref()

const rateLimit = (name: string, limit: number, windowMs: number, message: string) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = `${name}:${req.user ? `u${req.user.id}` : req.ip}`
    const now = Date.now()
    const hits = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs)
    if (hits.length >= limit) {
      res.status(429).json({ error: message })
      return
    }
    hits.push(now)
    rateBuckets.set(key, hits)
    next()
  }

const authLimiter = rateLimit('auth', 10, 60_000, '尝试次数过多，请一分钟后再试')
const writeLimiter = rateLimit('write', 6, 60_000, '发布太频繁了，休息一下再发')
const commentLimiter = rateLimit('comment', 15, 60_000, '评论太频繁了，休息一下再发')

// ---------- expired session cleanup ----------

const cleanSessions = () => db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run()
cleanSessions()
setInterval(cleanSessions, 60 * 60_000).unref()

if (isProduction) {
  if (process.env.ALLOW_DEMO_CREDENTIALS !== 'true') {
    const demoCredentials = [
      ['admin', 'admin123456'],
      ['mod', 'demo123456'],
      ['demo', 'demo123456'],
    ] as const
    for (const [username, password] of demoCredentials) {
      const account = db.prepare("SELECT password_hash as passwordHash FROM users WHERE username = ? AND status = 'active'").get(username) as { passwordHash: string } | undefined
      if (account && verifyPassword(password, account.passwordHash)) {
        throw new Error(`Refusing production start: change or disable the default ${username} account first`)
      }
    }
  }
}

type Handler = (req: express.Request, res: express.Response) => void | Promise<void>
const wrap = (handler: Handler): Handler => async (req, res) => {
  try {
    await handler(req, res)
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message })
    } else {
      console.error(error)
      res.status(500).json({ error: '服务器开小差了，请稍后再试' })
    }
  }
}

const intParam = (value: string) => {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '无效的 ID')
  return id
}

function publicUser(user: SessionUser) {
  return { ...user, verified: Boolean(user.verified), roleLabel: roleLabel(user), avatar: user.nickname.slice(0, 1) }
}

// ---------- health ----------

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'campus-forum-api', time: new Date().toISOString() }))

// ---------- auth ----------

app.post('/api/auth/register', authLimiter, wrap((req, res) => {
  const { username, password, nickname, dept, grade } = req.body ?? {}
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) throw new HttpError(400, '用户名需要是 3-20 位字母、数字或下划线')
  if (typeof password !== 'string' || password.length < 8 || password.length > 64) throw new HttpError(400, '密码长度需要在 8-64 位之间')
  if (typeof nickname !== 'string' || nickname.trim().length < 2 || nickname.trim().length > 16) throw new HttpError(400, '昵称长度需要在 2-16 个字符之间')
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)
  if (exists) throw new HttpError(409, '这个用户名已经被注册了')
  const result = db.prepare("INSERT INTO users (username, password_hash, nickname, role, dept, grade, verified, campus, verification_status) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'unverified')")
    .run(username, hashPassword(password), nickname.trim(), 'student', typeof dept === 'string' ? dept.trim() : '', typeof grade === 'string' ? grade.trim() : '', campusVerificationMeta().campusName)
  const token = createSession(Number(result.lastInsertRowid))
  const user = db.prepare('SELECT id, username, nickname, role, dept, grade, bio, verified, campus, email, verification_status as verificationStatus, created_at as createdAt FROM users WHERE id = ?').get(result.lastInsertRowid) as SessionUser
  res.status(201).json({ token, user: publicUser(user) })
}))

app.post('/api/auth/login', authLimiter, wrap((req, res) => {
  const { username, password } = req.body ?? {}
  if (typeof username !== 'string' || typeof password !== 'string') throw new HttpError(400, '请输入用户名和密码')
  const row = db.prepare("SELECT id, password_hash FROM users WHERE username = ? AND status = 'active'").get(username) as { id: number; password_hash: string } | undefined
  if (!row || !verifyPassword(password, row.password_hash)) throw new HttpError(401, '用户名或密码不正确')
  const token = createSession(row.id)
  const user = db.prepare('SELECT id, username, nickname, role, dept, grade, bio, verified, campus, email, verification_status as verificationStatus, created_at as createdAt FROM users WHERE id = ?').get(row.id) as SessionUser
  res.json({ token, user: publicUser(user) })
}))

app.post('/api/auth/logout', requireAuth, wrap((req, res) => {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) destroySession(header.slice(7))
  res.json({ ok: true })
}))

app.get('/api/me', requireAuth, wrap((req, res) => {
  res.json({ user: publicUser(req.user!), stats: myStats(req.user!) })
}))

app.patch('/api/me', requireAuth, wrap((req, res) => {
  const { nickname, bio, dept, grade } = req.body ?? {}
  const user = updateProfile(req.user!, { nickname, bio, dept, grade }) as SessionUser
  res.json({ user: publicUser({ ...req.user!, ...user }) })
}))

app.post('/api/me/password', requireAuth, authLimiter, wrap((req, res) => {
  const { oldPassword, newPassword } = req.body ?? {}
  if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') throw new HttpError(400, '请输入原密码和新密码')
  if (newPassword.length < 8 || newPassword.length > 64) throw new HttpError(400, '新密码长度需要在 8-64 位之间')
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string }
  if (!verifyPassword(oldPassword, row.password_hash)) throw new HttpError(401, '原密码不正确')
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user!.id)
  const header = req.headers.authorization
  const currentToken = header?.startsWith('Bearer ') ? header.slice(7) : ''
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user!.id, currentToken)
  res.json({ ok: true })
}))

app.post('/api/verification/request', requireAuth, authLimiter, wrap(async (req, res) => {
  const { email } = req.body ?? {}
  if (typeof email !== 'string') throw new HttpError(400, '请输入校园邮箱')
  res.json({ data: await requestCampusVerification(req.user!, email) })
}))

app.post('/api/verification/confirm', requireAuth, authLimiter, wrap((req, res) => {
  const { code } = req.body ?? {}
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new HttpError(400, '请输入 6 位验证码')
  res.json({ data: confirmCampusVerification(req.user!, code) })
}))

// ---------- public user profiles ----------

app.get('/api/users/:id', wrap((req, res) => {
  res.json({ data: publicProfile(intParam(req.params.id), req.user ?? null) })
}))

app.post('/api/users/:id/follow', requireAuth, requireVerified, wrap((req, res) => {
  res.json({ data: toggleUserFollow(req.user!, intParam(req.params.id)) })
}))

// ---------- boards & stats ----------

app.get('/api/boards', wrap((_req, res) => res.json({ data: listBoards() })))
app.get('/api/stats', wrap((_req, res) => res.json({ data: communityStats() })))
app.get('/api/pulse', wrap((_req, res) => res.json({ data: communityPulse() })))
app.get('/api/meta', wrap((_req, res) => res.json({ departments: DEPARTMENTS, reportReasons: REPORT_REASONS, ...campusVerificationMeta() })))

// ---------- posts ----------

app.get('/api/posts', wrap((req, res) => {
  const { board, q, sort, page, pageSize, mine, favorites, user, following } = req.query
  const query = {
    board: typeof board === 'string' ? board : undefined,
    q: typeof q === 'string' && q.trim() ? q.trim() : undefined,
    sort: typeof sort === 'string' ? sort : 'recommend',
    page: typeof page === 'string' ? Number(page) || 1 : 1,
    pageSize: typeof pageSize === 'string' ? Number(pageSize) || 10 : 10,
    authorId: mine === '1' && req.user ? req.user.id : undefined,
    favoritedBy: favorites === '1' && req.user ? req.user.id : undefined,
    profileId: typeof user === 'string' && Number(user) > 0 ? Number(user) : undefined,
    followingBy: following === '1' && req.user ? req.user.id : undefined,
  }
  res.json(listPosts(query, req.user ?? null))
}))

app.get('/api/posts/:id', wrap((req, res) => {
  res.json({ data: getPost(intParam(req.params.id), req.user ?? null, { countView: true }) })
}))

const validatePostInput = (body: any) => {
  const { board, title, body: text, tags, images, anonymous } = body ?? {}
  if (typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 60) throw new HttpError(400, '标题需要在 5-60 个字符之间')
  if (typeof text !== 'string' || text.trim().length < 10 || text.trim().length > 5000) throw new HttpError(400, '正文需要在 10-5000 个字符之间')
  if (typeof board !== 'string') throw new HttpError(400, '请选择板块')
  const tagList = Array.isArray(tags)
    ? tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).map((tag) => tag.trim().slice(0, 12)).slice(0, 4)
    : []
  const imageList = Array.isArray(images) ? images.filter(validPostImageUrl).slice(0, 4) : []
  if (Array.isArray(images) && imageList.length !== images.length) throw new HttpError(400, '帖子图片地址无效')
  return { board, title, body: text, tags: tagList, images: imageList, anonymous: Boolean(anonymous) }
}

app.post('/api/posts', requireAuth, requireVerified, writeLimiter, wrap(async (req, res) => {
  res.status(201).json(await createPost(req.user!, validatePostInput(req.body)))
}))

app.patch('/api/posts/:id', requireAuth, requireVerified, writeLimiter, wrap(async (req, res) => {
  res.json(await updatePost(req.user!, intParam(req.params.id), validatePostInput(req.body)))
}))

app.delete('/api/posts/:id', requireAuth, wrap((req, res) => {
  deletePost(req.user!, intParam(req.params.id))
  res.json({ ok: true })
}))

app.post('/api/posts/:id/like', requireAuth, wrap((req, res) => {
  res.json({ data: toggleLike(req.user!, 'post', intParam(req.params.id)) })
}))

app.post('/api/posts/:id/favorite', requireAuth, wrap((req, res) => {
  res.json({ data: toggleFavorite(req.user!, intParam(req.params.id)) })
}))

app.post('/api/uploads', requireAuth, requireVerified, writeLimiter, wrap((req, res) => {
  const { type, data } = req.body ?? {}
  if (typeof type !== 'string' || typeof data !== 'string') throw new HttpError(400, '请选择要上传的图片')
  res.status(201).json({ data: { url: savePostImage(type, data) } })
}))

// ---------- comments ----------

app.get('/api/posts/:id/comments', wrap((req, res) => {
  res.json({ data: listComments(intParam(req.params.id), req.user ?? null) })
}))

app.post('/api/posts/:id/comments', requireAuth, requireVerified, commentLimiter, wrap((req, res) => {
  const { body, parentId, anonymous } = req.body ?? {}
  if (typeof body !== 'string' || body.trim().length < 1 || body.trim().length > 1000) throw new HttpError(400, '评论内容需要在 1-1000 个字符之间')
  const comment = createComment(req.user!, intParam(req.params.id), {
    body,
    parentId: Number.isInteger(parentId) ? Number(parentId) : undefined,
    anonymous: Boolean(anonymous),
  })
  res.status(201).json({ data: comment })
}))

app.delete('/api/comments/:id', requireAuth, wrap((req, res) => {
  deleteComment(req.user!, intParam(req.params.id))
  res.json({ ok: true })
}))

app.post('/api/comments/:id/like', requireAuth, wrap((req, res) => {
  res.json({ data: toggleLike(req.user!, 'comment', intParam(req.params.id)) })
}))

// ---------- needs ----------

app.get('/api/needs', wrap((req, res) => {
  res.json({ data: listNeeds(req.user ?? null, { mine: req.query.mine === '1' && Boolean(req.user) }) })
}))

app.post('/api/needs', requireAuth, requireVerified, writeLimiter, wrap((req, res) => {
  const { title, body, dept, anonymous } = req.body ?? {}
  if (typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 60) throw new HttpError(400, '诉求标题需要在 5-60 个字符之间')
  if (typeof body !== 'string' || body.trim().length < 10 || body.trim().length > 2000) throw new HttpError(400, '诉求描述需要在 10-2000 个字符之间')
  if (typeof dept !== 'string') throw new HttpError(400, '请选择职能部门')
  res.status(201).json({ data: createNeed(req.user!, { title, body, dept, anonymous: Boolean(anonymous) }) })
}))

app.post('/api/needs/:id/follow', requireAuth, wrap((req, res) => {
  res.json({ data: toggleFollowNeed(req.user!, intParam(req.params.id)) })
}))

app.post('/api/needs/:id/updates', requireAuth, wrap((req, res) => {
  const { status, content } = req.body ?? {}
  if (typeof status !== 'string') throw new HttpError(400, '请选择状态')
  if (typeof content !== 'string' || content.trim().length < 5 || content.trim().length > 500) throw new HttpError(400, '进展说明需要在 5-500 个字符之间')
  res.status(201).json({ data: addNeedUpdate(req.user!, intParam(req.params.id), { status, content }) })
}))

// ---------- reports & moderation ----------

app.post('/api/reports', requireAuth, commentLimiter, wrap((req, res) => {
  const { targetType, targetId, reason, detail } = req.body ?? {}
  if (targetType !== 'post' && targetType !== 'comment') throw new HttpError(400, '无效的举报对象')
  if (!Number.isInteger(targetId)) throw new HttpError(400, '无效的举报对象')
  if (typeof reason !== 'string' || !reason.trim()) throw new HttpError(400, '请选择举报理由')
  createReport(req.user!, { targetType, targetId: Number(targetId), reason: reason.trim(), detail: typeof detail === 'string' ? detail : undefined })
  res.status(201).json({ ok: true })
}))

app.get('/api/moderation/overview', requireRole('moderator', 'admin'), wrap((req, res) => {
  res.json({ data: moderationOverview(req.user!) })
}))

app.post('/api/moderation/posts/:id', requireRole('moderator', 'admin'), wrap((req, res) => {
  const { action, reason } = req.body ?? {}
  if (action === 'feature' || action === 'unfeature') {
    setFeatured(req.user!, intParam(req.params.id), action === 'feature')
    res.json({ ok: true })
    return
  }
  if (action !== 'approve' && action !== 'hide') throw new HttpError(400, '无效的操作')
  moderatePost(req.user!, intParam(req.params.id), action, typeof reason === 'string' ? reason : undefined)
  res.json({ ok: true })
}))

app.post('/api/moderation/reports/:id', requireRole('moderator', 'admin'), wrap((req, res) => {
  const { action, reason } = req.body ?? {}
  if (action !== 'dismiss' && action !== 'hide') throw new HttpError(400, '无效的操作')
  handleReport(req.user!, intParam(req.params.id), action, typeof reason === 'string' ? reason : undefined)
  res.json({ ok: true })
}))

app.get('/api/moderation/audit', requireRole('moderator', 'admin'), wrap((_req, res) => {
  res.json({ data: listAuditLogs() })
}))

// ---------- admin ----------

app.get('/api/admin/users', requireRole('admin'), wrap((req, res) => {
  const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined
  res.json({ data: adminListUsers(q) })
}))

app.patch('/api/admin/users/:id', requireRole('admin'), wrap((req, res) => {
  const { role, status } = req.body ?? {}
  res.json({
    data: adminUpdateUser(req.user!, intParam(req.params.id), {
      role: typeof role === 'string' ? role : undefined,
      status: typeof status === 'string' ? status : undefined,
    }),
  })
}))

app.post('/api/admin/boards', requireRole('admin'), wrap((req, res) => {
  const { name, description, icon, color } = req.body ?? {}
  if (typeof name !== 'string' || typeof description !== 'string') throw new HttpError(400, '请填写板块名称和描述')
  res.status(201).json({ data: adminSaveBoard(req.user!, { name, description, icon, color }) })
}))

app.patch('/api/admin/boards/:id', requireRole('admin'), wrap((req, res) => {
  const { name, description, icon, color } = req.body ?? {}
  if (typeof name !== 'string' || typeof description !== 'string') throw new HttpError(400, '请填写板块名称和描述')
  res.json({ data: adminSaveBoard(req.user!, { id: intParam(req.params.id), name, description, icon, color }) })
}))

// ---------- notifications ----------

app.get('/api/notifications', requireAuth, wrap((req, res) => {
  res.json({ data: listNotifications(req.user!) })
}))

app.post('/api/notifications/read', requireAuth, wrap((req, res) => {
  const { ids } = req.body ?? {}
  markNotificationsRead(req.user!, Array.isArray(ids) ? ids.filter((id) => Number.isInteger(id)) : undefined)
  res.json({ ok: true })
}))

// ---------- direct messages ----------

app.get('/api/messages', requireAuth, requireVerified, wrap((req, res) => {
  res.json({ data: { items: listDirectConversations(req.user!), unread: directUnreadCount(req.user!) } })
}))

app.get('/api/messages/:userId', requireAuth, requireVerified, wrap((req, res) => {
  res.json({ data: getDirectThread(req.user!, intParam(req.params.userId)) })
}))

app.post('/api/messages/:userId', requireAuth, requireVerified, commentLimiter, wrap((req, res) => {
  const { body } = req.body ?? {}
  if (typeof body !== 'string' || body.trim().length < 1 || body.trim().length > 1000) throw new HttpError(400, '私信内容需要在 1-1000 个字符之间')
  res.status(201).json({ data: sendDirectMessage(req.user!, intParam(req.params.userId), body) })
}))

// ---------- static frontend (production) ----------

const distDir = resolve(import.meta.dirname, '../dist')
app.use('/uploads', express.static(uploadsDir, { fallthrough: false, maxAge: isProduction ? '7d' : 0 }))
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.sendFile(join(distDir, 'index.html'))
    } else {
      next()
    }
  })
}

app.listen(port, host, () => console.log(`Campus Forum API running at http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port} (bound to ${host})`))
