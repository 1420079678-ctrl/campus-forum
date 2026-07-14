export const STICKERS = [
  { id: 'wave', emoji: '👋', label: '嗨！同学', tone: 'mint' },
  { id: 'laugh', emoji: '😂', label: '笑不活了', tone: 'yellow' },
  { id: 'agree', emoji: '🫡', label: '收到！', tone: 'blue' },
  { id: 'heart', emoji: '🫶', label: '狠狠支持', tone: 'pink' },
  { id: 'study', emoji: '🤓', label: '学到了', tone: 'mint' },
  { id: 'cry', emoji: '😭', label: '大学生破防', tone: 'blue' },
  { id: 'wow', emoji: '😲', label: '还有这种事', tone: 'yellow' },
  { id: 'confused', emoji: '🤯', label: 'CPU 烧了', tone: 'purple' },
  { id: 'cheer', emoji: '💪', label: '冲就完了', tone: 'orange' },
  { id: 'sleepy', emoji: '😴', label: '早八退退退', tone: 'blue' },
  { id: 'eat', emoji: '😋', label: '食堂见', tone: 'orange' },
  { id: 'run', emoji: '🏃', label: '马上到！', tone: 'mint' },
  { id: 'party', emoji: '🥳', label: '好耶！', tone: 'pink' },
  { id: 'cat', emoji: '🐱', label: '猫猫围观', tone: 'yellow' },
  { id: 'dog', emoji: '🐶', label: '蹲个后续', tone: 'orange' },
  { id: 'frog', emoji: '🐸', label: '保持冷静', tone: 'mint' },
] as const

export type StickerId = typeof STICKERS[number]['id']

export function stickerToken(id: StickerId) {
  return `[[sticker:${id}]]`
}

export function stickerFromBody(body: string) {
  const match = body.match(/^\[\[sticker:([a-z]+)\]\]$/)
  return match ? STICKERS.find((sticker) => sticker.id === match[1]) : undefined
}

export function commentPreview(body: string) {
  const sticker = stickerFromBody(body)
  return sticker ? `[表情包] ${sticker.label}` : body
}
