import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Mail, MessageCircle, Send, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import { timeAgo } from '../format'
import type { DirectConversation, DirectMessage, DirectThread, Me } from '../types'
import { avatarStyle } from '../avatar'

export default function MessagesView({ user, initialOtherId, navigate, notify, requireAuth, onUnreadChange }: {
  user: Me | null
  initialOtherId?: number
  navigate: (path: string) => void
  notify: (message: string) => void
  requireAuth: () => boolean
  onUnreadChange: (count: number) => void
}) {
  const [conversations, setConversations] = useState<DirectConversation[]>([])
  const [thread, setThread] = useState<DirectThread | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const loadConversations = useCallback(async () => {
    if (!user?.verified) return
    try {
      const payload = await api<{ data: { items: DirectConversation[]; unread: number } }>('/api/messages')
      setConversations(payload.data.items)
      onUnreadChange(payload.data.unread)
    } catch (err) {
      notify(err instanceof Error ? err.message : '私信加载失败')
    }
  }, [user?.verified, notify, onUnreadChange])

  const openThread = useCallback(async (otherId: number) => {
    setLoading(true)
    try {
      const payload = await api<{ data: DirectThread }>(`/api/messages/${otherId}`)
      setThread(payload.data)
      onUnreadChange(0)
      void loadConversations()
    } catch (err) {
      notify(err instanceof Error ? err.message : '会话加载失败')
    } finally {
      setLoading(false)
    }
  }, [loadConversations, notify, onUnreadChange])

  useEffect(() => {
    if (!user?.verified) return
    void loadConversations()
  }, [user?.verified, loadConversations])

  useEffect(() => {
    if (user?.verified && initialOtherId) void openThread(initialOtherId)
  }, [initialOtherId, user?.verified, openThread])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [thread?.messages.length])

  const send = async () => {
    if (!thread || !draft.trim() || sending) return
    setSending(true)
    try {
      const payload = await api<{ data: DirectMessage }>(`/api/messages/${thread.other.id}`, { method: 'POST', body: { body: draft } })
      setThread({ ...thread, messages: [...thread.messages, payload.data] })
      setDraft('')
      void loadConversations()
    } catch (err) {
      notify(err instanceof Error ? err.message : '发送失败')
    } finally {
      setSending(false)
    }
  }

  if (!user) {
    return <div className="page-view"><div className="empty-state"><Mail size={26} /><h3>登录后使用站内私信</h3><p>与同学交流时不必公开手机号、微信等个人联系方式。</p><button className="primary-button" onClick={() => requireAuth()}>登录 / 注册</button></div></div>
  }

  if (!user.verified) {
    return <div className="page-view"><div className="empty-state"><ShieldCheck size={26} /><h3>验证校园身份后开启私信</h3><p>为了减少广告和骚扰，只有已验证的校园成员可以发送私信。</p><button className="primary-button" onClick={() => navigate('/profile')}>前往身份验证</button></div></div>
  }

  return (
    <div className="page-view messages-page">
      <div className="page-header messages-header">
        <div><span className="section-kicker">CAMPUS MESSAGES</span><h1>站内私信</h1><p>联系同学时请保护个人隐私，遇到骚扰可向审核员举报。</p></div>
      </div>
      <div className="messages-layout">
        <aside className={`conversation-list ${thread ? 'has-thread' : ''}`}>
          <div className="conversation-title"><MessageCircle size={16} /><strong>最近会话</strong></div>
          {conversations.length === 0 && <div className="conversation-empty">还没有私信。可以从同学主页发起交流。</div>}
          {conversations.map((item) => (
            <button key={item.id} className={thread?.other.id === item.other.id ? 'active' : ''} onClick={() => navigate(`/messages/${item.other.id}`)}>
              <span className="avatar" style={avatarStyle(item.other.id)}>{item.other.avatar}</span>
              <span><strong>{item.other.nickname}</strong><small>{item.lastMessage}</small></span>
              <span className="conversation-meta"><small>{timeAgo(item.updatedAt)}</small>{item.unread > 0 && <b>{item.unread}</b>}</span>
            </button>
          ))}
        </aside>
        <section className={`message-thread ${thread ? 'open' : ''}`}>
          {!thread && !loading && <div className="message-placeholder"><Mail size={30} /><h3>选择一位同学开始交流</h3><p>站内沟通更安全，也不会暴露校外联系方式。</p></div>}
          {loading && <div className="message-placeholder">正在加载会话…</div>}
          {thread && !loading && (
            <>
              <div className="thread-head">
                <button className="icon-button thread-back" onClick={() => { setThread(null); navigate('/messages') }} aria-label="返回会话列表"><ArrowLeft size={18} /></button>
                <span className="avatar" style={avatarStyle(thread.other.id)}>{thread.other.avatar}</span><div><strong>{thread.other.nickname}</strong><small>{thread.other.roleLabel}</small></div>
              </div>
              <div className="message-list">
                {thread.messages.length === 0 && <div className="conversation-empty">还没有消息，友善地打个招呼吧。</div>}
                {thread.messages.map((message) => (
                  <div key={message.id} className={`message-bubble ${message.senderId === user.id ? 'mine' : ''}`}>
                    <p>{message.body}</p><small>{timeAgo(message.createdAt)}</small>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <div className="message-composer">
                <textarea value={draft} maxLength={1000} rows={2} placeholder="友善交流，不要发送手机号、验证码等敏感信息" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
                }} />
                <button className="primary-button" disabled={!draft.trim() || sending} onClick={send}><Send size={16} />{sending ? '发送中' : '发送'}</button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
