import { db } from './db.js'
import type { SessionUser } from './auth.js'
import { canModerate } from './auth.js'
import { moderateTextWithAI, riskLabel, type ModerationResult } from './moderate.js'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const DEPARTMENTS = ['后勤服务中心', '教务处', '图书馆', '学生工作部', '信息网络中心', '团委', '保卫处']

type Viewer = SessionUser | null

const ISO = (column: string) => `strftime('%Y-%m-%dT%H:%M:%SZ', ${column})`

export function roleLabel(user: { role: string; dept: string; grade: string }) {
  if (user.role === 'admin') return '社区管理员'
  if (user.role === 'moderator') return '社区审核'
  if (user.role === 'staff') return user.dept || '职能部门'
  if (user.role === 'teacher') return `教师 · ${user.dept}`
  return [user.grade, user.dept].filter(Boolean).join(' · ') || '在校学生'
}

type AuthorRow = { user_id: number; nickname: string; role: string; dept: string; grade: string; anonymous: number }

function authorFor(row: AuthorRow, viewer: Viewer) {
  const isOwn = viewer?.id === row.user_id
  const anonymous = Boolean(row.anonymous)
  const real = { id: row.user_id, nickname: row.nickname, avatar: row.nickname.slice(0, 1), roleLabel: roleLabel(row), anonymous }
  if (!anonymous) return { author: real, isOwn }
  const masked = { nickname: isOwn ? `匿名（${row.nickname}）` : '匿名同学', avatar: '匿', roleLabel: '身份已隐藏', anonymous }
  if (viewer && canModerate(viewer.role)) return { author: masked, realAuthor: real, isOwn }
  return { author: masked, isOwn }
}

// ---------- boards & stats ----------

export function listBoards() {
  return db.prepare(`
    SELECT b.id, b.name, b.description, b.icon, b.color,
      (SELECT COUNT(*) FROM posts p WHERE p.board_id = b.id AND p.status = 'visible') as postCount
    FROM boards b ORDER BY b.sort
  `).all()
}

export function communityStats() {
  const members = (db.prepare("SELECT COUNT(*) as c FROM users WHERE status = 'active'").get() as { c: number }).c
  const weekPosts = (db.prepare("SELECT COUNT(*) as c FROM posts WHERE created_at >= datetime('now', '-7 days') AND status != 'deleted'").get() as { c: number }).c
  const weekComments = (db.prepare("SELECT COUNT(*) as c FROM comments WHERE created_at >= datetime('now', '-7 days') AND status = 'visible'").get() as { c: number }).c
  const needsTotal = (db.prepare('SELECT COUNT(*) as c FROM needs').get() as { c: number }).c
  const needsAnswered = (db.prepare('SELECT COUNT(DISTINCT need_id) as c FROM need_updates').get() as { c: number }).c
  const knowledge = (db.prepare(`
    SELECT COUNT(*) as c FROM posts p JOIN boards b ON b.id = p.board_id
    WHERE p.status = 'visible' AND (p.featured = 1 OR b.name IN ('升学就业', '学长学姐'))
  `).get() as { c: number }).c
  return {
    members,
    weekDiscussions: weekPosts + weekComments,
    needResponseRate: needsTotal === 0 ? 100 : Math.round((needsAnswered / needsTotal) * 100),
    knowledgeCount: knowledge,
  }
}

// ---------- posts ----------

const POST_FIELDS = `
  p.id, p.user_id, p.board_id, p.title, p.body, p.tags, p.images, p.anonymous, p.status, p.featured, p.edited,
  p.view_count as viewCount, p.like_count as likeCount, p.comment_count as commentCount,
  p.risk_level as riskLevel, p.risk_reasons as riskReasons,
  ${ISO('p.created_at')} as createdAt,
  b.name as boardName, u.nickname, u.role, u.dept, u.grade,
  (SELECT COUNT(*) FROM likes l WHERE l.user_id = @viewerId AND l.target_type = 'post' AND l.target_id = p.id) as liked,
  (SELECT COUNT(*) FROM favorites f WHERE f.user_id = @viewerId AND f.post_id = p.id) as favorited
`
const POST_FROM = 'FROM posts p JOIN boards b ON b.id = p.board_id JOIN users u ON u.id = p.user_id'

function mapPost(row: any, viewer: Viewer) {
  const isMod = viewer ? canModerate(viewer.role) : false
  const { author, realAuthor, isOwn } = authorFor(row, viewer)
  return {
    id: row.id,
    board: row.boardName,
    boardId: row.board_id,
    title: row.title,
    body: row.body,
    tags: JSON.parse(row.tags) as string[],
    images: JSON.parse(row.images || '[]') as string[],
    status: row.status,
    featured: Boolean(row.featured),
    edited: Boolean(row.edited),
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    createdAt: row.createdAt,
    liked: Boolean(row.liked),
    favorited: Boolean(row.favorited),
    author,
    isOwn,
    ...(realAuthor ? { realAuthor } : {}),
    ...(isMod || isOwn ? { riskLevel: row.riskLevel, riskReasons: JSON.parse(row.riskReasons) as string[] } : {}),
  }
}

export type PostQuery = {
  board?: string
  q?: string
  sort?: string
  page?: number
  pageSize?: number
  authorId?: number
  favoritedBy?: number
  profileId?: number
  followingBy?: number
}

export function listPosts(query: PostQuery, viewer: Viewer) {
  const where: string[] = []
  const params: Record<string, unknown> = { viewerId: viewer?.id ?? 0 }
  if (query.authorId) {
    where.push("p.user_id = @authorId AND p.status != 'deleted'")
    params.authorId = query.authorId
  } else if (query.favoritedBy) {
    where.push("p.status = 'visible' AND EXISTS (SELECT 1 FROM favorites f2 WHERE f2.user_id = @favoritedBy AND f2.post_id = p.id)")
    params.favoritedBy = query.favoritedBy
  } else if (query.profileId) {
    where.push("p.user_id = @profileId AND p.status = 'visible' AND p.anonymous = 0")
    params.profileId = query.profileId
  } else if (query.followingBy) {
    where.push("p.status = 'visible' AND p.anonymous = 0 AND EXISTS (SELECT 1 FROM user_follows uf WHERE uf.follower_id = @followingBy AND uf.following_id = p.user_id)")
    params.followingBy = query.followingBy
  } else {
    where.push("p.status = 'visible'")
  }
  if (query.board && query.board !== '全部') {
    where.push('b.name = @board')
    params.board = query.board
  }
  if (query.q) {
    where.push("(p.title LIKE @q ESCAPE '\\' OR p.body LIKE @q ESCAPE '\\' OR p.tags LIKE @q ESCAPE '\\')")
    params.q = `%${query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
  }
  const order = query.sort === 'latest'
    ? 'p.id DESC'
    : query.sort === 'hot'
      ? '(p.like_count * 3 + p.comment_count * 2) DESC, p.id DESC'
      : 'p.featured DESC, (p.like_count * 3 + p.comment_count * 2 + p.view_count / 10.0) DESC, p.id DESC'
  const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 50)
  const page = Math.max(query.page ?? 1, 1)
  const whereSql = `WHERE ${where.join(' AND ')}`
  const total = (db.prepare(`SELECT COUNT(*) as c ${POST_FROM} ${whereSql}`).get(params) as { c: number }).c
  const rows = db.prepare(`SELECT ${POST_FIELDS} ${POST_FROM} ${whereSql} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize })
  return { items: rows.map((row) => mapPost(row, viewer)), total, page, pageSize }
}

export function getPost(id: number, viewer: Viewer, { countView = false } = {}) {
  const row = db.prepare(`SELECT ${POST_FIELDS} ${POST_FROM} WHERE p.id = @id`).get({ id, viewerId: viewer?.id ?? 0 }) as any
  if (!row || row.status === 'deleted') throw new HttpError(404, '帖子不存在或已被删除')
  const isMod = viewer ? canModerate(viewer.role) : false
  const isOwn = viewer?.id === row.user_id
  if (row.status !== 'visible' && !isMod && !isOwn) throw new HttpError(404, '帖子不存在或已被删除')
  if (countView && row.status === 'visible') {
    db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(id)
    row.viewCount += 1
  }
  return mapPost(row, viewer)
}

export async function createPost(viewer: SessionUser, input: { board: string; title: string; body: string; tags: string[]; images: string[]; anonymous: boolean }) {
  const board = db.prepare('SELECT id FROM boards WHERE name = ?').get(input.board) as { id: number } | undefined
  if (!board) throw new HttpError(400, '板块不存在')
  const moderation = await moderateTextWithAI(input.title, input.body, input.tags.join(' '))
  const status = moderation.risk === 'high' ? 'pending' : 'visible'
  const result = db.prepare(`
    INSERT INTO posts (user_id, board_id, title, body, tags, images, anonymous, status, risk_level, risk_reasons)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(viewer.id, board.id, input.title.trim(), input.body.trim(), JSON.stringify(input.tags), JSON.stringify(input.images), input.anonymous ? 1 : 0, status, moderation.risk, JSON.stringify(moderation.reasons))
  const postId = Number(result.lastInsertRowid)
  logAudit('ai', 'ai-guard-01',
    moderation.risk === 'high' ? 'FLAG_PENDING' : moderation.risk === 'medium' ? 'FLAG_REVIEW' : 'AUTO_PASS',
    'post', postId,
    moderation.reasons.length ? `AI 初审判定${riskLabel[moderation.risk]}：${moderation.reasons.join('；')}` : 'AI 初审判定低风险，自动放行')
  if (moderation.risk === 'medium') {
    db.prepare(`INSERT INTO reports (reporter_id, reporter_label, target_type, target_id, reason, detail) VALUES (NULL, 'AI 巡检', 'post', ?, ?, ?)`)
      .run(postId, 'AI 判定中风险，建议人工复核', moderation.reasons.join('；'))
  }
  if (status === 'pending') {
    notify(viewer.id, { type: 'moderation', content: `你的帖子《${input.title.trim()}》正在等待人工复核，通过后将对所有人可见。` })
  }
  return { post: getPost(postId, viewer), moderation }
}

export async function updatePost(viewer: SessionUser, id: number, input: { board: string; title: string; body: string; tags: string[]; images: string[]; anonymous: boolean }) {
  const row = db.prepare('SELECT id, user_id, status FROM posts WHERE id = ?').get(id) as any
  if (!row || row.status === 'deleted') throw new HttpError(404, '帖子不存在')
  if (row.user_id !== viewer.id) throw new HttpError(403, '只能编辑自己的帖子')
  if (row.status === 'hidden') throw new HttpError(403, '帖子已被隐藏，暂时无法编辑，如有疑问请联系管理员')
  const board = db.prepare('SELECT id FROM boards WHERE name = ?').get(input.board) as { id: number } | undefined
  if (!board) throw new HttpError(400, '板块不存在')
  const moderation = await moderateTextWithAI(input.title, input.body, input.tags.join(' '))
  const status = moderation.risk === 'high' ? 'pending' : 'visible'
  db.prepare(`
    UPDATE posts SET board_id = ?, title = ?, body = ?, tags = ?, images = ?, anonymous = ?, status = ?,
      risk_level = ?, risk_reasons = ?, edited = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(board.id, input.title.trim(), input.body.trim(), JSON.stringify(input.tags), JSON.stringify(input.images), input.anonymous ? 1 : 0, status, moderation.risk, JSON.stringify(moderation.reasons), id)
  logAudit('ai', 'ai-guard-01',
    moderation.risk === 'high' ? 'FLAG_PENDING' : moderation.risk === 'medium' ? 'FLAG_REVIEW' : 'AUTO_PASS',
    'post', id,
    moderation.reasons.length ? `编辑后重审判定${riskLabel[moderation.risk]}：${moderation.reasons.join('；')}` : '编辑后重审判定低风险，自动放行')
  if (status === 'pending' && row.status !== 'pending') {
    notify(viewer.id, { type: 'moderation', content: `你编辑后的帖子《${input.title.trim()}》正在等待人工复核，通过后将重新对所有人可见。` })
  }
  return { post: getPost(id, viewer), moderation }
}

export function setFeatured(viewer: SessionUser, postId: number, featured: boolean) {
  const post = db.prepare("SELECT id, user_id, title FROM posts WHERE id = ? AND status = 'visible'").get(postId) as any
  if (!post) throw new HttpError(404, '帖子不存在或不可精选')
  db.prepare('UPDATE posts SET featured = ? WHERE id = ?').run(featured ? 1 : 0, postId)
  logAudit('user', viewer.username, featured ? 'FEATURE' : 'UNFEATURE', 'post', postId, featured ? '帖子被设为精选' : '帖子被取消精选')
  if (featured && post.user_id !== viewer.id) {
    notify(post.user_id, { type: 'moderation', targetType: 'post', targetId: postId, content: `你的帖子《${post.title}》被设为社区精选，会在推荐流中优先展示。` })
  }
}

export function deletePost(viewer: SessionUser, id: number) {
  const row = db.prepare('SELECT id, user_id, status, title FROM posts WHERE id = ?').get(id) as any
  if (!row || row.status === 'deleted') throw new HttpError(404, '帖子不存在')
  if (row.user_id === viewer.id) {
    db.prepare("UPDATE posts SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id)
    logAudit('user', viewer.username, 'DELETE', 'post', id, '作者删除了自己的帖子')
  } else if (canModerate(viewer.role)) {
    db.prepare("UPDATE posts SET status = 'hidden', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id)
    logAudit('user', viewer.username, 'HIDE', 'post', id, '审核人员隐藏了该帖子')
    notify(row.user_id, { type: 'moderation', content: `你的帖子《${row.title}》已被审核人员隐藏，如有疑问可以发起申诉。` })
  } else {
    throw new HttpError(403, '只能删除自己的帖子')
  }
}

export function toggleLike(viewer: SessionUser, targetType: 'post' | 'comment', targetId: number) {
  const target = targetType === 'post'
    ? db.prepare("SELECT id, user_id, title as label FROM posts WHERE id = ? AND status != 'deleted'").get(targetId) as any
    : db.prepare("SELECT id, user_id, body as label FROM comments WHERE id = ? AND status = 'visible'").get(targetId) as any
  if (!target) throw new HttpError(404, '内容不存在或已被删除')
  const table = targetType === 'post' ? 'posts' : 'comments'
  const existing = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?').get(viewer.id, targetType, targetId)
  if (existing) {
    db.prepare('DELETE FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?').run(viewer.id, targetType, targetId)
    db.prepare(`UPDATE ${table} SET like_count = like_count - 1 WHERE id = ?`).run(targetId)
  } else {
    db.prepare('INSERT INTO likes (user_id, target_type, target_id) VALUES (?, ?, ?)').run(viewer.id, targetType, targetId)
    db.prepare(`UPDATE ${table} SET like_count = like_count + 1 WHERE id = ?`).run(targetId)
    if (target.user_id !== viewer.id) {
      const summary = targetType === 'post' ? `《${target.label}》` : `「${String(target.label).slice(0, 20)}…」`
      notifyOnce(target.user_id, { type: 'like', actorId: viewer.id, targetType, targetId, content: `${viewer.nickname} 赞了你的${targetType === 'post' ? '帖子' : '评论'}${summary}` })
    }
  }
  const count = (db.prepare(`SELECT like_count as c FROM ${table} WHERE id = ?`).get(targetId) as { c: number }).c
  return { liked: !existing, likeCount: count }
}

export function toggleFavorite(viewer: SessionUser, postId: number) {
  const post = db.prepare("SELECT id FROM posts WHERE id = ? AND status = 'visible'").get(postId)
  if (!post) throw new HttpError(404, '帖子不存在或暂不可收藏')
  const existing = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND post_id = ?').get(viewer.id, postId)
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND post_id = ?').run(viewer.id, postId)
  } else {
    db.prepare('INSERT INTO favorites (user_id, post_id) VALUES (?, ?)').run(viewer.id, postId)
  }
  return { favorited: !existing }
}

// ---------- comments ----------

const COMMENT_FIELDS = `
  c.id, c.post_id as postId, c.parent_id as parentId, c.body, c.anonymous, c.status, c.user_id,
  c.like_count as likeCount, ${ISO('c.created_at')} as createdAt,
  u.nickname, u.role, u.dept, u.grade,
  (SELECT COUNT(*) FROM likes l WHERE l.user_id = @viewerId AND l.target_type = 'comment' AND l.target_id = c.id) as liked
`

export function listComments(postId: number, viewer: Viewer) {
  getPost(postId, viewer)
  const rows = db.prepare(`
    SELECT ${COMMENT_FIELDS} FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.post_id = @postId AND c.status = 'visible' ORDER BY c.id
  `).all({ postId, viewerId: viewer?.id ?? 0 }) as any[]
  const byId = new Map(rows.map((row) => [row.id, row]))
  return rows.map((row) => {
    const { author, realAuthor, isOwn } = authorFor(row, viewer)
    const parent = row.parentId ? byId.get(row.parentId) : undefined
    const parentAuthor = parent ? authorFor(parent, viewer).author.nickname : row.parentId ? '已删除的评论' : undefined
    return {
      id: row.id,
      postId: row.postId,
      parentId: row.parentId,
      body: row.body,
      likeCount: row.likeCount,
      liked: Boolean(row.liked),
      createdAt: row.createdAt,
      author,
      isOwn,
      ...(parentAuthor ? { replyTo: parentAuthor } : {}),
      ...(realAuthor ? { realAuthor } : {}),
    }
  })
}

export function createComment(viewer: SessionUser, postId: number, input: { body: string; parentId?: number; anonymous: boolean }) {
  const post = db.prepare("SELECT id, user_id, title FROM posts WHERE id = ? AND status = 'visible'").get(postId) as any
  if (!post) throw new HttpError(404, '帖子不存在或暂不可评论')
  const moderation = moderateText(input.body)
  if (moderation.risk === 'high') {
    throw new HttpError(422, `发布失败：${moderation.reasons.join('；')}。请修改后重试。`)
  }
  let parent: any = null
  if (input.parentId) {
    parent = db.prepare("SELECT id, user_id FROM comments WHERE id = ? AND post_id = ? AND status = 'visible'").get(input.parentId, postId)
    if (!parent) throw new HttpError(400, '回复的评论不存在')
  }
  const result = db.prepare('INSERT INTO comments (post_id, user_id, parent_id, body, anonymous) VALUES (?, ?, ?, ?, ?)')
    .run(postId, viewer.id, input.parentId ?? null, input.body.trim(), input.anonymous ? 1 : 0)
  const commentId = Number(result.lastInsertRowid)
  db.prepare('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?').run(postId)
  if (moderation.risk === 'medium') {
    db.prepare(`INSERT INTO reports (reporter_id, reporter_label, target_type, target_id, reason, detail) VALUES (NULL, 'AI 巡检', 'comment', ?, ?, ?)`)
      .run(commentId, 'AI 判定中风险，建议人工复核', moderation.reasons.join('；'))
    logAudit('ai', 'ai-guard-01', 'FLAG_REVIEW', 'comment', commentId, `AI 初审判定中风险：${moderation.reasons.join('；')}`)
  }
  const displayName = input.anonymous ? '匿名同学' : viewer.nickname
  if (post.user_id !== viewer.id) {
    notify(post.user_id, { type: 'comment', actorId: viewer.id, targetType: 'post', targetId: postId, content: `${displayName} 评论了你的帖子《${post.title}》` })
  }
  if (parent && parent.user_id !== viewer.id && parent.user_id !== post.user_id) {
    notify(parent.user_id, { type: 'reply', actorId: viewer.id, targetType: 'post', targetId: postId, content: `${displayName} 回复了你在《${post.title}》下的评论` })
  }
  return listComments(postId, viewer).find((comment) => comment.id === commentId)
}

export function deleteComment(viewer: SessionUser, commentId: number) {
  const row = db.prepare('SELECT id, user_id, post_id, status FROM comments WHERE id = ?').get(commentId) as any
  if (!row || row.status !== 'visible') throw new HttpError(404, '评论不存在')
  if (row.user_id !== viewer.id && !canModerate(viewer.role)) throw new HttpError(403, '只能删除自己的评论')
  db.prepare(row.user_id === viewer.id ? "UPDATE comments SET status = 'deleted' WHERE id = ?" : "UPDATE comments SET status = 'hidden' WHERE id = ?").run(commentId)
  db.prepare('UPDATE posts SET comment_count = comment_count - 1 WHERE id = ?').run(row.post_id)
  logAudit('user', viewer.username, row.user_id === viewer.id ? 'DELETE' : 'HIDE', 'comment', commentId, row.user_id === viewer.id ? '作者删除了自己的评论' : '审核人员隐藏了该评论')
}

// ---------- needs ----------

export function listNeeds(viewer: Viewer, { mine = false } = {}) {
  const rows = db.prepare(`
    SELECT n.id, n.user_id, n.title, n.body, n.dept, n.status, n.anonymous,
      ${ISO('n.created_at')} as createdAt, ${ISO('n.updated_at')} as updatedAt,
      u.nickname, u.role, u.dept as userDept, u.grade,
      (SELECT COUNT(*) FROM need_follows f WHERE f.need_id = n.id) as followerCount,
      (SELECT COUNT(*) FROM need_follows f WHERE f.need_id = n.id AND f.user_id = @viewerId) as following
    FROM needs n JOIN users u ON u.id = n.user_id
    ${mine ? 'WHERE n.user_id = @viewerId' : ''}
    ORDER BY n.updated_at DESC
  `).all({ viewerId: viewer?.id ?? 0 }) as any[]
  const updates = db.prepare(`
    SELECT nu.id, nu.need_id as needId, nu.status, nu.content, ${ISO('nu.created_at')} as createdAt, u.nickname
    FROM need_updates nu JOIN users u ON u.id = nu.user_id ORDER BY nu.id
  `).all() as any[]
  const updatesByNeed = new Map<number, any[]>()
  for (const update of updates) {
    const list = updatesByNeed.get(update.needId) ?? []
    list.push({ id: update.id, status: update.status, content: update.content, by: update.nickname, createdAt: update.createdAt })
    updatesByNeed.set(update.needId, list)
  }
  return rows.map((row) => {
    const { author, realAuthor, isOwn } = authorFor({ ...row, dept: row.userDept }, viewer)
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      dept: row.dept,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      followerCount: row.followerCount,
      following: Boolean(row.following),
      updates: updatesByNeed.get(row.id) ?? [],
      author,
      isOwn,
      ...(realAuthor ? { realAuthor } : {}),
    }
  })
}

export function createNeed(viewer: SessionUser, input: { title: string; body: string; dept: string; anonymous: boolean }) {
  if (!DEPARTMENTS.includes(input.dept)) throw new HttpError(400, '请选择有效的职能部门')
  const moderation = moderateText(input.title, input.body)
  if (moderation.risk === 'high') throw new HttpError(422, `提交失败：${moderation.reasons.join('；')}。请修改后重试。`)
  const result = db.prepare('INSERT INTO needs (user_id, title, body, dept, anonymous) VALUES (?, ?, ?, ?, ?)')
    .run(viewer.id, input.title.trim(), input.body.trim(), input.dept, input.anonymous ? 1 : 0)
  const needId = Number(result.lastInsertRowid)
  db.prepare('INSERT INTO need_follows (user_id, need_id) VALUES (?, ?)').run(viewer.id, needId)
  return listNeeds(viewer).find((need) => need.id === needId)
}

export function toggleFollowNeed(viewer: SessionUser, needId: number) {
  const need = db.prepare('SELECT id FROM needs WHERE id = ?').get(needId)
  if (!need) throw new HttpError(404, '诉求不存在')
  const existing = db.prepare('SELECT 1 FROM need_follows WHERE user_id = ? AND need_id = ?').get(viewer.id, needId)
  if (existing) {
    db.prepare('DELETE FROM need_follows WHERE user_id = ? AND need_id = ?').run(viewer.id, needId)
  } else {
    db.prepare('INSERT INTO need_follows (user_id, need_id) VALUES (?, ?)').run(viewer.id, needId)
  }
  const count = (db.prepare('SELECT COUNT(*) as c FROM need_follows WHERE need_id = ?').get(needId) as { c: number }).c
  return { following: !existing, followerCount: count }
}

const NEED_STATUS_LABEL: Record<string, string> = { pending: '待回应', accepted: '已受理', progress: '处理中', resolved: '已解决', closed: '已关闭' }

export function addNeedUpdate(viewer: SessionUser, needId: number, input: { status: string; content: string }) {
  if (!(viewer.role === 'staff' || viewer.role === 'admin')) throw new HttpError(403, '只有职能部门账号可以更新诉求进展')
  if (!Object.hasOwn(NEED_STATUS_LABEL, input.status)) throw new HttpError(400, '无效的诉求状态')
  const need = db.prepare('SELECT id, user_id, title FROM needs WHERE id = ?').get(needId) as any
  if (!need) throw new HttpError(404, '诉求不存在')
  db.prepare('INSERT INTO need_updates (need_id, user_id, status, content) VALUES (?, ?, ?, ?)').run(needId, viewer.id, input.status, input.content.trim())
  db.prepare('UPDATE needs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(input.status, needId)
  logAudit('user', viewer.username, 'NEED_UPDATE', 'need', needId, `诉求状态更新为「${NEED_STATUS_LABEL[input.status]}」`)
  const followers = db.prepare('SELECT user_id FROM need_follows WHERE need_id = ?').all(needId) as Array<{ user_id: number }>
  const recipients = new Set<number>([need.user_id, ...followers.map((f) => f.user_id)])
  recipients.delete(viewer.id)
  for (const userId of recipients) {
    notify(userId, { type: 'need_update', actorId: viewer.id, targetType: 'need', targetId: needId, content: `「${need.title}」有新进展：${NEED_STATUS_LABEL[input.status]} — ${input.content.trim().slice(0, 40)}` })
  }
  return listNeeds(viewer).find((item) => item.id === needId)
}

// ---------- reports & moderation ----------

export const REPORT_REASONS = ['垃圾广告或引流', '疑似诈骗或违规交易', '人身攻击或不友善', '泄露他人隐私', '不实信息', '其他']

export function createReport(viewer: SessionUser, input: { targetType: 'post' | 'comment'; targetId: number; reason: string; detail?: string }) {
  const target = input.targetType === 'post'
    ? db.prepare("SELECT id FROM posts WHERE id = ? AND status != 'deleted'").get(input.targetId)
    : db.prepare("SELECT id FROM comments WHERE id = ? AND status = 'visible'").get(input.targetId)
  if (!target) throw new HttpError(404, '举报对象不存在')
  const duplicated = db.prepare("SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'").get(viewer.id, input.targetType, input.targetId)
  if (duplicated) throw new HttpError(409, '你已经举报过这条内容，审核员会尽快处理')
  db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason, detail) VALUES (?, ?, ?, ?, ?)')
    .run(viewer.id, input.targetType, input.targetId, input.reason, input.detail?.trim() ?? '')
}

export function moderationOverview(viewer: SessionUser) {
  const pendingPosts = db.prepare(`
    SELECT ${POST_FIELDS} ${POST_FROM} WHERE p.status = 'pending' ORDER BY p.id DESC
  `).all({ viewerId: viewer.id }).map((row) => mapPost(row, viewer))
  const reportRows = db.prepare(`
    SELECT r.id, r.target_type as targetType, r.target_id as targetId, r.reason, r.detail, ${ISO('r.created_at')} as createdAt,
      r.reporter_label as reporterLabel, ru.nickname as reporterNickname
    FROM reports r LEFT JOIN users ru ON ru.id = r.reporter_id
    WHERE r.status = 'open' ORDER BY r.id DESC
  `).all() as any[]
  const openReports = reportRows.map((row) => {
    let target: any = null
    if (row.targetType === 'post') {
      const post = db.prepare('SELECT p.id, p.title, p.body, p.status, u.nickname FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?').get(row.targetId) as any
      if (post) target = { id: post.id, kind: 'post', title: post.title, excerpt: post.body.slice(0, 80), status: post.status, author: post.nickname }
    } else {
      const comment = db.prepare('SELECT c.id, c.body, c.status, c.post_id, u.nickname, p.title FROM comments c JOIN users u ON u.id = c.user_id JOIN posts p ON p.id = c.post_id WHERE c.id = ?').get(row.targetId) as any
      if (comment) target = { id: comment.id, kind: 'comment', title: `《${comment.title}》下的评论`, excerpt: comment.body.slice(0, 80), status: comment.status, author: comment.nickname, postId: comment.post_id }
    }
    return {
      id: row.id,
      reason: row.reason,
      detail: row.detail,
      createdAt: row.createdAt,
      reporter: row.reporterNickname ?? row.reporterLabel ?? '匿名',
      target,
    }
  }).filter((report) => report.target)
  const handledToday = (db.prepare(`
    SELECT COUNT(*) as c FROM audit_logs
    WHERE actor_type = 'user' AND action IN ('APPROVE', 'HIDE', 'DISMISS') AND created_at >= datetime('now', '-24 hours')
  `).get() as { c: number }).c
  const totalPosts = (db.prepare("SELECT COUNT(*) as c FROM posts WHERE status != 'deleted'").get() as { c: number }).c
  const lowRisk = (db.prepare("SELECT COUNT(*) as c FROM posts WHERE status != 'deleted' AND risk_level = 'low'").get() as { c: number }).c
  return {
    pendingPosts,
    openReports,
    metrics: {
      pending: pendingPosts.length + openReports.length,
      handledToday,
      autoPassRate: totalPosts === 0 ? 100 : Math.round((lowRisk / totalPosts) * 1000) / 10,
    },
  }
}

export function moderatePost(viewer: SessionUser, postId: number, action: 'approve' | 'hide', reason?: string) {
  const post = db.prepare("SELECT id, user_id, title, status FROM posts WHERE id = ? AND status != 'deleted'").get(postId) as any
  if (!post) throw new HttpError(404, '帖子不存在')
  if (action === 'approve') {
    db.prepare("UPDATE posts SET status = 'visible', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(postId)
    logAudit('user', viewer.username, 'APPROVE', 'post', postId, reason?.trim() || '人工复核通过')
    notify(post.user_id, { type: 'moderation', targetType: 'post', targetId: postId, content: `你的帖子《${post.title}》已通过人工复核，现在对所有人可见。` })
  } else {
    db.prepare("UPDATE posts SET status = 'hidden', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(postId)
    logAudit('user', viewer.username, 'HIDE', 'post', postId, reason?.trim() || '人工复核未通过，帖子已隐藏')
    notify(post.user_id, { type: 'moderation', targetType: 'post', targetId: postId, content: `你的帖子《${post.title}》未通过人工复核已被隐藏${reason ? `：${reason}` : ''}，如有疑问可以发起申诉。` })
  }
  db.prepare("UPDATE reports SET status = 'resolved', handled_by = ?, handled_at = CURRENT_TIMESTAMP WHERE target_type = 'post' AND target_id = ? AND status = 'open'").run(viewer.id, postId)
}

export function handleReport(viewer: SessionUser, reportId: number, action: 'dismiss' | 'hide', reason?: string) {
  const report = db.prepare("SELECT * FROM reports WHERE id = ? AND status = 'open'").get(reportId) as any
  if (!report) throw new HttpError(404, '举报不存在或已处理')
  if (action === 'dismiss') {
    db.prepare("UPDATE reports SET status = 'dismissed', handled_by = ?, handled_at = CURRENT_TIMESTAMP WHERE id = ?").run(viewer.id, reportId)
    logAudit('user', viewer.username, 'DISMISS', report.target_type, report.target_id, reason?.trim() || '人工复核未发现违规，举报已驳回')
    return
  }
  if (report.target_type === 'post') {
    const post = db.prepare('SELECT id, user_id, title FROM posts WHERE id = ?').get(report.target_id) as any
    if (post) {
      db.prepare("UPDATE posts SET status = 'hidden', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(post.id)
      notify(post.user_id, { type: 'moderation', targetType: 'post', targetId: post.id, content: `你的帖子《${post.title}》经举报核实已被隐藏，如有疑问可以发起申诉。` })
    }
  } else {
    const comment = db.prepare('SELECT id, user_id, post_id, status FROM comments WHERE id = ?').get(report.target_id) as any
    if (comment && comment.status === 'visible') {
      db.prepare("UPDATE comments SET status = 'hidden' WHERE id = ?").run(comment.id)
      db.prepare('UPDATE posts SET comment_count = comment_count - 1 WHERE id = ?').run(comment.post_id)
      notify(comment.user_id, { type: 'moderation', content: '你的一条评论经举报核实已被隐藏，如有疑问可以发起申诉。' })
    }
  }
  db.prepare("UPDATE reports SET status = 'resolved', handled_by = ?, handled_at = CURRENT_TIMESTAMP WHERE target_type = ? AND target_id = ? AND status = 'open'").run(viewer.id, report.target_type, report.target_id)
  logAudit('user', viewer.username, 'HIDE', report.target_type, report.target_id, reason?.trim() || '举报核实，内容已隐藏')
}

// ---------- notifications ----------

function notify(userId: number, input: { type: string; actorId?: number; targetType?: string; targetId?: number; content: string }) {
  db.prepare('INSERT INTO notifications (user_id, type, actor_id, target_type, target_id, content) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, input.type, input.actorId ?? null, input.targetType ?? null, input.targetId ?? null, input.content)
}

function notifyOnce(userId: number, input: { type: string; actorId: number; targetType: string; targetId: number; content: string }) {
  const existing = db.prepare('SELECT 1 FROM notifications WHERE user_id = ? AND type = ? AND actor_id = ? AND target_type = ? AND target_id = ? AND read = 0')
    .get(userId, input.type, input.actorId, input.targetType, input.targetId)
  if (!existing) notify(userId, input)
}

export function listNotifications(viewer: SessionUser) {
  const items = db.prepare(`
    SELECT id, type, target_type as targetType, target_id as targetId, content, read, ${ISO('created_at')} as createdAt
    FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30
  `).all(viewer.id).map((row: any) => ({ ...row, read: Boolean(row.read) }))
  const unread = (db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0').get(viewer.id) as { c: number }).c
  return { items, unread }
}

export function markNotificationsRead(viewer: SessionUser, ids?: number[]) {
  if (ids?.length) {
    const mark = db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?')
    for (const id of ids) mark.run(viewer.id, id)
  } else {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(viewer.id)
  }
}

export function unreadCount(viewer: SessionUser) {
  return (db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0').get(viewer.id) as { c: number }).c
}

// ---------- profile ----------

export function myStats(viewer: SessionUser) {
  const posts = (db.prepare("SELECT COUNT(*) as c FROM posts WHERE user_id = ? AND status != 'deleted'").get(viewer.id) as { c: number }).c
  const comments = (db.prepare("SELECT COUNT(*) as c FROM comments WHERE user_id = ? AND status = 'visible'").get(viewer.id) as { c: number }).c
  const likesReceived = (db.prepare(`
    SELECT COUNT(*) as c FROM likes l WHERE
      (l.target_type = 'post' AND l.target_id IN (SELECT id FROM posts WHERE user_id = @id)) OR
      (l.target_type = 'comment' AND l.target_id IN (SELECT id FROM comments WHERE user_id = @id))
  `).get({ id: viewer.id }) as { c: number }).c
  const helped = (db.prepare(`
    SELECT COUNT(DISTINCT c.post_id) as c FROM comments c JOIN posts p ON p.id = c.post_id
    WHERE c.user_id = @id AND p.user_id != @id AND c.status = 'visible'
  `).get({ id: viewer.id }) as { c: number }).c
  const favorites = (db.prepare('SELECT COUNT(*) as c FROM favorites WHERE user_id = ?').get(viewer.id) as { c: number }).c
  const needs = (db.prepare('SELECT COUNT(*) as c FROM needs WHERE user_id = ?').get(viewer.id) as { c: number }).c
  const followers = (db.prepare('SELECT COUNT(*) as c FROM user_follows WHERE following_id = ?').get(viewer.id) as { c: number }).c
  const following = (db.prepare('SELECT COUNT(*) as c FROM user_follows WHERE follower_id = ?').get(viewer.id) as { c: number }).c
  const unreadMessages = directUnreadCount(viewer)
  const joinedDays = (db.prepare("SELECT CAST(julianday('now') - julianday(created_at) AS INTEGER) as c FROM users WHERE id = ?").get(viewer.id) as { c: number }).c
  return { posts, comments, likesReceived, helped, favorites, needs, followers, following, unreadMessages, joinedDays }
}

export function updateProfile(viewer: SessionUser, input: { nickname?: string; bio?: string; dept?: string; grade?: string }) {
  const nickname = input.nickname?.trim()
  if (nickname !== undefined && (nickname.length < 2 || nickname.length > 16)) throw new HttpError(400, '昵称长度需要在 2-16 个字符之间')
  db.prepare(`
    UPDATE users SET
      nickname = COALESCE(?, nickname),
      bio = COALESCE(?, bio),
      dept = COALESCE(?, dept),
      grade = COALESCE(?, grade)
    WHERE id = ?
  `).run(nickname ?? null, input.bio?.trim() ?? null, input.dept?.trim() ?? null, input.grade?.trim() ?? null, viewer.id)
  return db.prepare('SELECT id, username, nickname, role, dept, grade, bio, verified, campus, email, verification_status as verificationStatus FROM users WHERE id = ?').get(viewer.id)
}

export function publicProfile(userId: number, viewer: Viewer = null) {
  const row = db.prepare(`
    SELECT id, nickname, role, dept, grade, bio, campus, verified, status, ${ISO('created_at')} as createdAt,
      CAST(julianday('now') - julianday(created_at) AS INTEGER) as joinedDays
    FROM users WHERE id = ?
  `).get(userId) as any
  if (!row || row.status !== 'active') throw new HttpError(404, '用户不存在或已注销')
  const posts = (db.prepare("SELECT COUNT(*) as c FROM posts WHERE user_id = ? AND status = 'visible' AND anonymous = 0").get(userId) as { c: number }).c
  const comments = (db.prepare("SELECT COUNT(*) as c FROM comments WHERE user_id = ? AND status = 'visible' AND anonymous = 0").get(userId) as { c: number }).c
  const likesReceived = (db.prepare(`
    SELECT COUNT(*) as c FROM likes l WHERE
      (l.target_type = 'post' AND l.target_id IN (SELECT id FROM posts WHERE user_id = @id AND anonymous = 0)) OR
      (l.target_type = 'comment' AND l.target_id IN (SELECT id FROM comments WHERE user_id = @id AND anonymous = 0))
  `).get({ id: userId }) as { c: number }).c
  const followers = (db.prepare('SELECT COUNT(*) as c FROM user_follows WHERE following_id = ?').get(userId) as { c: number }).c
  const followingCount = (db.prepare('SELECT COUNT(*) as c FROM user_follows WHERE follower_id = ?').get(userId) as { c: number }).c
  const following = viewer
    ? Boolean((db.prepare('SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?').get(viewer.id, userId)))
    : false
  return {
    id: row.id,
    nickname: row.nickname,
    avatar: String(row.nickname).slice(0, 1),
    roleLabel: roleLabel(row),
    bio: row.bio,
    campus: row.campus,
    verified: Boolean(row.verified),
    joinedDays: row.joinedDays,
    createdAt: row.createdAt,
    following,
    stats: { posts, comments, likesReceived, followers, following: followingCount },
  }
}

export function toggleUserFollow(viewer: SessionUser, userId: number) {
  if (viewer.id === userId) throw new HttpError(400, '不能关注自己')
  const target = db.prepare("SELECT id, nickname FROM users WHERE id = ? AND status = 'active'").get(userId) as { id: number; nickname: string } | undefined
  if (!target) throw new HttpError(404, '用户不存在')
  const exists = db.prepare('SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?').get(viewer.id, userId)
  if (exists) {
    db.prepare('DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?').run(viewer.id, userId)
  } else {
    db.prepare('INSERT INTO user_follows (follower_id, following_id) VALUES (?, ?)').run(viewer.id, userId)
    notify(userId, { type: 'follow', actorId: viewer.id, targetType: 'user', targetId: viewer.id, content: `${viewer.nickname} 关注了你` })
  }
  const followerCount = (db.prepare('SELECT COUNT(*) as c FROM user_follows WHERE following_id = ?').get(userId) as { c: number }).c
  return { following: !exists, followerCount }
}

// ---------- direct messages ----------

function directPair(a: number, b: number) {
  return a < b ? [a, b] as const : [b, a] as const
}

function ensureDirectConversation(viewerId: number, otherId: number) {
  if (viewerId === otherId) throw new HttpError(400, '不能给自己发私信')
  const target = db.prepare("SELECT id, nickname, role, dept, grade, status FROM users WHERE id = ? AND status = 'active'").get(otherId) as any
  if (!target) throw new HttpError(404, '用户不存在')
  const [low, high] = directPair(viewerId, otherId)
  db.prepare('INSERT OR IGNORE INTO direct_conversations (user_low_id, user_high_id) VALUES (?, ?)').run(low, high)
  const conversation = db.prepare('SELECT id FROM direct_conversations WHERE user_low_id = ? AND user_high_id = ?').get(low, high) as { id: number }
  return { conversationId: conversation.id, target }
}

export function listDirectConversations(viewer: SessionUser) {
  const rows = db.prepare(`
    SELECT c.id,
      CASE WHEN c.user_low_id = @viewerId THEN c.user_high_id ELSE c.user_low_id END as otherId,
      u.nickname, u.role, u.dept, u.grade,
      (SELECT body FROM direct_messages lm WHERE lm.conversation_id = c.id ORDER BY lm.id DESC LIMIT 1) as lastMessage,
      (SELECT ${ISO('lm.created_at')} FROM direct_messages lm WHERE lm.conversation_id = c.id ORDER BY lm.id DESC LIMIT 1) as updatedAt,
      (SELECT COUNT(*) FROM direct_messages um WHERE um.conversation_id = c.id AND um.sender_id != @viewerId AND um.read_at IS NULL) as unread
    FROM direct_conversations c
    JOIN users u ON u.id = CASE WHEN c.user_low_id = @viewerId THEN c.user_high_id ELSE c.user_low_id END
    WHERE (c.user_low_id = @viewerId OR c.user_high_id = @viewerId) AND u.status = 'active'
      AND EXISTS (SELECT 1 FROM direct_messages em WHERE em.conversation_id = c.id)
    ORDER BY COALESCE(updatedAt, c.updated_at) DESC
  `).all({ viewerId: viewer.id }) as any[]
  return rows.map((row) => ({
    id: row.id,
    other: { id: row.otherId, nickname: row.nickname, avatar: String(row.nickname).slice(0, 1), roleLabel: roleLabel(row) },
    lastMessage: row.lastMessage,
    updatedAt: row.updatedAt,
    unread: Number(row.unread),
  }))
}

export function getDirectThread(viewer: SessionUser, otherId: number) {
  const { conversationId, target } = ensureDirectConversation(viewer.id, otherId)
  db.prepare("UPDATE direct_messages SET read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL").run(conversationId, viewer.id)
  const messages = db.prepare(`
    SELECT id, sender_id as senderId, body, ${ISO('created_at')} as createdAt, read_at as readAt
    FROM direct_messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 200
  `).all(conversationId)
  return {
    other: { id: target.id, nickname: target.nickname, avatar: String(target.nickname).slice(0, 1), roleLabel: roleLabel(target) },
    messages,
  }
}

export function sendDirectMessage(viewer: SessionUser, otherId: number, body: string) {
  const { conversationId } = ensureDirectConversation(viewer.id, otherId)
  const result = db.prepare('INSERT INTO direct_messages (conversation_id, sender_id, body) VALUES (?, ?, ?)')
    .run(conversationId, viewer.id, body.trim())
  db.prepare('UPDATE direct_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversationId)
  return db.prepare(`SELECT id, sender_id as senderId, body, ${ISO('created_at')} as createdAt, read_at as readAt FROM direct_messages WHERE id = ?`)
    .get(result.lastInsertRowid)
}

export function directUnreadCount(viewer: SessionUser) {
  return (db.prepare(`
    SELECT COUNT(*) as c FROM direct_messages m JOIN direct_conversations c ON c.id = m.conversation_id
    WHERE (c.user_low_id = @id OR c.user_high_id = @id) AND m.sender_id != @id AND m.read_at IS NULL
  `).get({ id: viewer.id }) as { c: number }).c
}

// ---------- admin ----------

export function adminListUsers(q?: string) {
  const where = q ? 'WHERE u.username LIKE @q OR u.nickname LIKE @q' : ''
  return db.prepare(`
    SELECT u.id, u.username, u.nickname, u.role, u.dept, u.grade, u.status, ${ISO('u.created_at')} as createdAt,
      (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.status != 'deleted') as postCount,
      (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id AND c.status = 'visible') as commentCount,
      (SELECT ${ISO('MAX(s.created_at)')} FROM sessions s WHERE s.user_id = u.id) as lastLoginAt
    FROM users u ${where} ORDER BY u.id
  `).all(q ? { q: `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` } : {})
}

const ASSIGNABLE_ROLES = ['student', 'teacher', 'staff', 'moderator', 'admin']

export function adminUpdateUser(viewer: SessionUser, userId: number, input: { role?: string; status?: string }) {
  const target = db.prepare('SELECT id, username, nickname, role, status FROM users WHERE id = ?').get(userId) as any
  if (!target) throw new HttpError(404, '用户不存在')
  if (input.role !== undefined) {
    if (!ASSIGNABLE_ROLES.includes(input.role)) throw new HttpError(400, '无效的角色')
    if (target.id === viewer.id) throw new HttpError(400, '不能修改自己的角色')
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(input.role, userId)
    logAudit('user', viewer.username, 'SET_ROLE', 'user', userId, `将 ${target.nickname}（${target.username}）的角色从 ${target.role} 调整为 ${input.role}`)
    notify(userId, { type: 'system', content: `你的账号角色已被管理员调整为「${roleLabel({ role: input.role, dept: '', grade: '' })}」。` })
  }
  if (input.status !== undefined) {
    if (input.status !== 'active' && input.status !== 'banned') throw new HttpError(400, '无效的状态')
    if (target.id === viewer.id) throw new HttpError(400, '不能封禁自己')
    if (target.role === 'admin' && input.status === 'banned') throw new HttpError(400, '不能封禁管理员账号')
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(input.status, userId)
    if (input.status === 'banned') {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    }
    logAudit('user', viewer.username, input.status === 'banned' ? 'BAN' : 'UNBAN', 'user', userId,
      input.status === 'banned' ? `封禁账号 ${target.nickname}（${target.username}）` : `解封账号 ${target.nickname}（${target.username}）`)
  }
  return db.prepare(`
    SELECT u.id, u.username, u.nickname, u.role, u.dept, u.grade, u.status, ${ISO('u.created_at')} as createdAt,
      (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.status != 'deleted') as postCount,
      (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id AND c.status = 'visible') as commentCount,
      (SELECT ${ISO('MAX(s.created_at)')} FROM sessions s WHERE s.user_id = u.id) as lastLoginAt
    FROM users u WHERE u.id = ?
  `).get(userId)
}

const BOARD_COLORS = ['coral', 'mint', 'gold', 'lavender', 'sky', 'rose']

export function adminSaveBoard(viewer: SessionUser, input: { id?: number; name: string; description: string; icon?: string; color?: string }) {
  const name = input.name.trim()
  if (name.length < 2 || name.length > 12) throw new HttpError(400, '板块名称需要在 2-12 个字符之间')
  const description = input.description.trim().slice(0, 60)
  const icon = input.icon?.trim() || 'Hash'
  const color = BOARD_COLORS.includes(input.color ?? '') ? input.color! : 'mint'
  const clash = db.prepare('SELECT id FROM boards WHERE name = ?').get(name) as { id: number } | undefined
  if (input.id) {
    const board = db.prepare('SELECT id FROM boards WHERE id = ?').get(input.id)
    if (!board) throw new HttpError(404, '板块不存在')
    if (clash && clash.id !== input.id) throw new HttpError(409, '已有同名板块')
    db.prepare('UPDATE boards SET name = ?, description = ?, icon = ?, color = ? WHERE id = ?').run(name, description, icon, color, input.id)
    logAudit('user', viewer.username, 'BOARD_UPDATE', 'board', input.id, `更新板块「${name}」`)
    return listBoards().find((board: any) => board.id === input.id)
  }
  if (clash) throw new HttpError(409, '已有同名板块')
  const sort = ((db.prepare('SELECT MAX(sort) as m FROM boards').get() as { m: number | null }).m ?? 0) + 1
  const result = db.prepare('INSERT INTO boards (name, description, icon, color, sort) VALUES (?, ?, ?, ?, ?)').run(name, description, icon, color, sort)
  const boardId = Number(result.lastInsertRowid)
  logAudit('user', viewer.username, 'BOARD_CREATE', 'board', boardId, `新建板块「${name}」`)
  return listBoards().find((board: any) => board.id === boardId)
}

// ---------- audit ----------

export function logAudit(actorType: 'ai' | 'user', actor: string, action: string, targetType: string, targetId: number | null, reason: string) {
  db.prepare('INSERT INTO audit_logs (actor_type, actor, action, target_type, target_id, reason) VALUES (?, ?, ?, ?, ?, ?)')
    .run(actorType, actor, action, targetType, targetId, reason)
}

export function listAuditLogs(limit = 50) {
  return db.prepare(`
    SELECT id, actor_type as actorType, actor, action, target_type as targetType, target_id as targetId, reason, ${ISO('created_at')} as createdAt
    FROM audit_logs ORDER BY id DESC LIMIT ?
  `).all(limit)
}

export type { ModerationResult }
