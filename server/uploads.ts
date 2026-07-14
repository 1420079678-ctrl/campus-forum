import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HttpError } from './store.js'

export const uploadsDir = resolve(process.env.CAMPUS_FORUM_UPLOADS ?? './data/uploads')
mkdirSync(uploadsDir, { recursive: true })

const formats: Record<string, { ext: string; valid: (bytes: Buffer) => boolean }> = {
  'image/jpeg': { ext: 'jpg', valid: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', valid: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', valid: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
}

export function savePostImage(type: string, data: string) {
  const format = formats[type]
  if (!format) throw new HttpError(400, '只支持 JPG、PNG、WebP 图片')
  let bytes: Buffer
  try {
    bytes = Buffer.from(data.replace(/^data:[^;]+;base64,/, ''), 'base64')
  } catch {
    throw new HttpError(400, '图片数据无效')
  }
  if (bytes.length === 0 || !format.valid(bytes)) throw new HttpError(400, '图片格式与文件内容不一致')
  if (bytes.length > 3 * 1024 * 1024) throw new HttpError(413, '单张图片不能超过 3MB')
  const filename = `${randomUUID()}.${format.ext}`
  writeFileSync(resolve(uploadsDir, filename), bytes, { flag: 'wx' })
  return `/uploads/${filename}`
}

export function validPostImageUrl(value: unknown): value is string {
  return typeof value === 'string' && /^\/uploads\/[a-f0-9-]+\.(jpg|png|webp)$/.test(value)
}
