import test from 'node:test'
import assert from 'node:assert/strict'
import { moderateText } from '../server/moderate.js'

test('ordinary campus discussion is low risk', () => {
  const result = moderateText('数据库期末复习', '想找同学一起整理范式和事务的知识点')
  assert.equal(result.risk, 'low')
  assert.deepEqual(result.reasons, [])
})

test('payment plus off-platform contact is high risk', () => {
  const result = moderateText('低价资料', '先转账定金，然后加我微信 abc12345 私聊')
  assert.equal(result.risk, 'high')
  assert.ok(result.reasons.some((reason) => reason.includes('诈骗')))
})

test('academic misconduct is high risk', () => {
  const result = moderateText('期末帮助', '专业代考代写，保证包过')
  assert.equal(result.risk, 'high')
})
