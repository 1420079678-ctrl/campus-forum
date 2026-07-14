import { randomBytes } from 'node:crypto'
import { db } from '../server/db.js'
import { hashPassword } from '../server/password.js'

function argument(name: string, fallback: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1].trim() : fallback
}

const username = argument('--username', 'jxd_owner')
const nickname = argument('--nickname', '嘉大圈站长')
const configuredPassword = process.env.ADMIN_PASSWORD?.trim()
const password = configuredPassword || randomBytes(18).toString('base64url')
const campus = process.env.CAMPUS_NAME?.trim() || '嘉兴大学'

if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) throw new Error('管理员用户名需要是 3-20 位字母、数字或下划线')
if (nickname.length < 2 || nickname.length > 16) throw new Error('管理员昵称需要是 2-16 个字符')
if (password.length < 12 || password.length > 64) throw new Error('管理员密码需要是 12-64 位')

const provision = db.transaction(() => {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined
  if (existing) {
    db.prepare(`
      UPDATE users SET password_hash = ?, nickname = ?, role = 'admin', dept = '社区运营', grade = '',
        status = 'active', verified = 1, campus = ?, verification_status = 'verified'
      WHERE id = ?
    `).run(hashPassword(password), nickname, campus, existing.id)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id)
    return existing.id
  }
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, nickname, role, dept, grade, bio, status, verified, campus, verification_status)
    VALUES (?, ?, ?, 'admin', '社区运营', '', '负责嘉大圈平台治理。', 'active', 1, ?, 'verified')
  `).run(username, hashPassword(password), nickname, campus)
  return Number(result.lastInsertRowid)
})

const id = provision()
console.log(`管理员账号已创建（ID ${id}）`)
console.log(`用户名：${username}`)
console.log(`密码：${password}`)
console.log('请妥善保存密码；再次运行同一用户名会重置该管理员密码。')
