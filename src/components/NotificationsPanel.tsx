import { useEffect, useState } from 'react'
import { Bell, CheckCheck, ClipboardList, Heart, MessageCircle, ShieldCheck, Sparkles, X } from 'lucide-react'
import { api } from '../api'
import { timeAgo } from '../format'
import type { NotificationItem } from '../types'

const typeIcon: Record<string, typeof Bell> = {
  comment: MessageCircle,
  reply: MessageCircle,
  like: Heart,
  moderation: ShieldCheck,
  need_update: ClipboardList,
  system: Sparkles,
}

export default function NotificationsPanel({ onClose, navigate, onUnreadChange }: {
  onClose: () => void
  navigate: (path: string) => void
  onUnreadChange: (count: number) => void
}) {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    api<{ data: { items: NotificationItem[]; unread: number } }>('/api/notifications')
      .then((payload) => {
        setItems(payload.data.items)
        onUnreadChange(payload.data.unread)
      })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }

  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const markAll = async () => {
    await api('/api/notifications/read', { method: 'POST', body: {} }).catch(() => undefined)
    setItems((list) => list.map((item) => ({ ...item, read: true })))
    onUnreadChange(0)
  }

  const openItem = async (item: NotificationItem) => {
    if (!item.read) {
      api('/api/notifications/read', { method: 'POST', body: { ids: [item.id] } }).catch(() => undefined)
      setItems((list) => list.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry))
      onUnreadChange(items.filter((entry) => !entry.read && entry.id !== item.id).length)
    }
    if (item.targetType === 'post' && item.targetId) {
      navigate(`/post/${item.targetId}`)
      onClose()
    } else if (item.targetType === 'need') {
      navigate('/needs')
      onClose()
    }
  }

  return (
    <div className="notif-panel">
      <div className="notif-head">
        <strong><Bell size={15} /> 互动通知</strong>
        <div>
          <button className="ghost-button small" onClick={markAll}><CheckCheck size={13} />全部已读</button>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </div>
      </div>
      <div className="notif-list">
        {loading && <div className="notif-empty">加载中…</div>}
        {!loading && items.length === 0 && <div className="notif-empty">还没有通知，去社区逛逛吧</div>}
        {items.map((item) => {
          const Icon = typeIcon[item.type] ?? Bell
          return (
            <button key={item.id} className={`notif-item ${item.read ? '' : 'unread'}`} onClick={() => openItem(item)}>
              <span className={`notif-icon ${item.type}`}><Icon size={14} /></span>
              <span className="notif-body">
                <span>{item.content}</span>
                <small>{timeAgo(item.createdAt)}</small>
              </span>
              {!item.read && <i className="unread-dot" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
