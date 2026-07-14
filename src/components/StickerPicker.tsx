import { useState } from 'react'
import { ChevronLeft, SmilePlus, Sparkles } from 'lucide-react'
import { STICKERS, stickerFromBody, type StickerId } from '../stickers'

const QUICK_EMOJIS = ['😀', '😂', '🥹', '😍', '🤩', '🥳', '😎', '🤔', '😵‍💫', '😭', '😤', '🫡', '👍', '👏', '🙏', '🫶', '🔥', '✨', '💯', '📚', '☕', '🍜', '🏸', '🎓']

export function StickerCard({ id, compact = false }: { id: StickerId; compact?: boolean }) {
  const sticker = STICKERS.find((item) => item.id === id)
  if (!sticker) return null
  return (
    <div className={`sticker-card ${sticker.tone} ${compact ? 'compact' : ''}`} aria-label={`表情包：${sticker.label}`}>
      <span>{sticker.emoji}</span>
      <strong>{sticker.label}</strong>
      <i aria-hidden="true">✦</i>
    </div>
  )
}

export function CommentBody({ body }: { body: string }) {
  const sticker = stickerFromBody(body)
  return sticker ? <StickerCard id={sticker.id} /> : <p>{body}</p>
}

export default function StickerPicker({ onEmoji, onSticker, onClose }: {
  onEmoji: (emoji: string) => void
  onSticker: (id: StickerId) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'emoji' | 'sticker'>('sticker')
  return (
    <div className="sticker-picker" role="dialog" aria-label="选择表情或表情包">
      <div className="sticker-picker-head">
        <div className="sticker-tabs">
          <button className={tab === 'sticker' ? 'active' : ''} onClick={() => setTab('sticker')}><Sparkles size={14} />校园表情包</button>
          <button className={tab === 'emoji' ? 'active' : ''} onClick={() => setTab('emoji')}><SmilePlus size={14} />Emoji</button>
        </div>
        <button className="picker-close" onClick={onClose} aria-label="收起表情面板"><ChevronLeft size={16} /></button>
      </div>
      {tab === 'sticker' ? (
        <div className="sticker-grid">
          {STICKERS.map((sticker) => (
            <button key={sticker.id} onClick={() => onSticker(sticker.id)} aria-label={`选择表情包：${sticker.label}`}>
              <StickerCard id={sticker.id} compact />
            </button>
          ))}
        </div>
      ) : (
        <div className="emoji-grid">
          {QUICK_EMOJIS.map((emoji) => <button key={emoji} onClick={() => onEmoji(emoji)} aria-label={`插入 ${emoji}`}>{emoji}</button>)}
        </div>
      )}
    </div>
  )
}
