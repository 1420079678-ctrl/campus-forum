import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const port = 19000 + Math.floor(Math.random() * 1000)
const base = `http://127.0.0.1:${port}`
const temp = join(tmpdir(), `campus-forum-test-${process.pid}-${Date.now()}`)
let server: ChildProcess

async function request(path: string, options: { method?: string; body?: unknown; token?: string } = {}) {
  const response = await fetch(base + path, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  return { status: response.status, data: await response.json() as any }
}

before(async () => {
  mkdirSync(temp, { recursive: true })
  server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      API_PORT: String(port),
      HOST: '127.0.0.1',
      CAMPUS_FORUM_DB: join(temp, 'test.db'),
      CAMPUS_FORUM_UPLOADS: join(temp, 'uploads'),
      CAMPUS_EMAIL_DOMAINS: 'example.edu.cn',
    },
    stdio: process.env.DEBUG_TEST_SERVER ? 'inherit' : 'ignore',
  })
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const health = await request('/api/health')
      if (health.status === 200) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('API did not start')
})

after(async () => {
  if (server && !server.killed) {
    const exited = new Promise((resolve) => server.once('exit', resolve))
    server.kill()
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1500))])
  }
  rmSync(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

test('verified student can publish, follow and message', async () => {
  const defaultAdmin = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123456' },
  })
  assert.equal(defaultAdmin.status, 401)

  const username = `student${String(Date.now()).slice(-8)}`
  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: { username, password: 'password123', nickname: '测试同学', grade: '大二', dept: '计算机学院' },
  })
  assert.equal(registered.status, 201)
  assert.equal(registered.data.user.verified, false)
  const token = registered.data.token as string

  const avatarUpdated = await request('/api/me', { method: 'PATCH', token, body: { avatar: '🎧' } })
  assert.equal(avatarUpdated.status, 200)
  assert.equal(avatarUpdated.data.user.avatar, '🎧')

  const blocked = await request('/api/posts', {
    method: 'POST', token,
    body: { board: '课程学业', title: '验证前不能发布', body: '这是一段满足长度要求的测试正文。', tags: [], images: [] },
  })
  assert.equal(blocked.status, 403)

  const requested = await request('/api/verification/request', { method: 'POST', token, body: { email: `${username}@example.edu.cn` } })
  assert.equal(requested.status, 200)
  assert.match(requested.data.data.devCode, /^\d{6}$/)

  const confirmed = await request('/api/verification/confirm', { method: 'POST', token, body: { code: requested.data.data.devCode } })
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.data.data.verified, true)

  const uploaded = await request('/api/uploads', {
    method: 'POST', token,
    body: { type: 'image/png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' },
  })
  assert.equal(uploaded.status, 201)
  assert.match(uploaded.data.data.url, /^\/uploads\/.+\.png$/)

  const created = await request('/api/posts', {
    method: 'POST', token,
    body: { board: '课程学业', title: '验证后的第一篇帖子', body: '现在已经通过校园身份验证，可以正常发布内容。', tags: ['测试'], images: [uploaded.data.data.url] },
  })
  assert.equal(created.status, 201)
  assert.equal(created.data.post.images.length, 1)

  const stickerComment = await request(`/api/posts/${created.data.post.id}/comments`, {
    method: 'POST', token,
    body: { body: '[[sticker:cheer]]', anonymous: false },
  })
  assert.equal(stickerComment.status, 201, JSON.stringify(stickerComment.data))
  assert.equal(stickerComment.data.data.body, '[[sticker:cheer]]')

  const followed = await request('/api/users/12/follow', { method: 'POST', token })
  assert.equal(followed.status, 200)
  assert.equal(followed.data.data.following, true)

  const sent = await request('/api/messages/12', { method: 'POST', token, body: { body: '你好，想交流一下校园活动。' } })
  assert.equal(sent.status, 201)
  const thread = await request('/api/messages/12', { token })
  assert.equal(thread.status, 200)
  assert.equal(thread.data.data.messages.length, 1)

  const pulse = await request('/api/pulse')
  assert.equal(pulse.status, 200)
  assert.equal(pulse.data.data.campus, '嘉兴大学')
  assert.ok(Array.isArray(pulse.data.data.hotPosts))
})

test('campus scenes have student-only cold-start content', async () => {
  const market = await request('/api/posts?board=%E9%97%B2%E7%BD%AE%E9%9B%86%E5%B8%82&pageSize=20')
  assert.equal(market.status, 200)
  assert.ok(market.data.items.length >= 4)
  assert.ok(market.data.items.every((post: any) => post.board === '闲置集市'))

  const errands = await request('/api/posts?q=%E8%B7%91%E8%85%BF&pageSize=20')
  assert.equal(errands.status, 200)
  assert.ok(errands.data.items.length >= 4)

  const lost = await request('/api/posts?q=%E5%A4%B1%E7%89%A9&pageSize=20')
  assert.equal(lost.status, 200)
  assert.ok(lost.data.items.length >= 4)
  const pets = await request('/api/posts?q=%E5%AE%A0%E7%89%A9&pageSize=20')
  assert.equal(pets.status, 200)
  assert.ok(pets.data.items.length >= 2)
  assert.ok([...market.data.items, ...errands.data.items, ...lost.data.items]
    .every((post: any) => !['教师', '职能部门'].includes(post.author.roleLabel)))
})
