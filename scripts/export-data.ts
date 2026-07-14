import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { db } from '../server/db.js'

const tables = [
  'users', 'boards', 'posts', 'comments', 'likes', 'favorites', 'needs', 'need_updates',
  'need_follows', 'reports', 'notifications', 'audit_logs', 'user_follows',
  'direct_conversations', 'direct_messages',
] as const

const destination = resolve(process.argv[2] ?? `./data/exports/campus-forum-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
mkdirSync(dirname(destination), { recursive: true })

const payload: Record<string, unknown> = {
  format: 'campus-forum-export-v1',
  exportedAt: new Date().toISOString(),
  schemaVersion: db.pragma('user_version', { simple: true }),
}

for (const table of tables) payload[table] = db.prepare(`SELECT * FROM ${table}`).all()
writeFileSync(destination, JSON.stringify(payload, null, 2), { flag: 'wx' })
console.log(`Exported ${tables.length} tables to ${destination}`)
console.warn('The export contains password hashes and private messages. Store it as sensitive data.')
