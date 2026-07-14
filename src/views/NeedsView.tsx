import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Clock3, Plus, Send, Users } from 'lucide-react'
import { api } from '../api'
import { timeAgo } from '../format'
import NeedForm from '../components/NeedForm'
import type { Me, Need } from '../types'
import { NEED_STATUS } from '../types'

type Filter = 'all' | 'mine' | 'following'

export default function NeedsView({ user, notify, requireAuth }: {
  user: Me | null
  notify: (message: string) => void
  requireAuth: () => boolean
}) {
  const [needs, setNeeds] = useState<Need[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [updateStatus, setUpdateStatus] = useState('accepted')
  const [updateContent, setUpdateContent] = useState('')
  const [busy, setBusy] = useState(false)

  const canHandle = user && (user.role === 'staff' || user.role === 'admin')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api<{ data: Need[] }>('/api/needs')
      .then((payload) => !cancelled && setNeeds(payload.data))
      .catch((err) => !cancelled && notify(err instanceof Error ? err.message : '加载失败'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [user?.id, notify])

  const filtered = useMemo(() => needs.filter((need) => {
    if (filter === 'mine') return need.isOwn
    if (filter === 'following') return need.following
    return true
  }), [needs, filter])

  const resolved = needs.filter((need) => need.status === 'resolved').length
  const answered = needs.filter((need) => need.updates.length > 0).length

  const toggleFollow = async (need: Need) => {
    if (!requireAuth()) return
    try {
      const payload = await api<{ data: { following: boolean; followerCount: number } }>(`/api/needs/${need.id}/follow`, { method: 'POST' })
      setNeeds((items) => items.map((item) => item.id === need.id ? { ...item, ...payload.data } : item))
    } catch (err) {
      notify(err instanceof Error ? err.message : '操作失败')
    }
  }

  const submitUpdate = async (need: Need) => {
    if (updateContent.trim().length < 5 || busy) return
    setBusy(true)
    try {
      const payload = await api<{ data: Need }>(`/api/needs/${need.id}/updates`, { method: 'POST', body: { status: updateStatus, content: updateContent } })
      setNeeds((items) => items.map((item) => item.id === need.id ? payload.data : item))
      setUpdateContent('')
      notify('进展已更新，关注者已收到通知')
    } catch (err) {
      notify(err instanceof Error ? err.message : '更新失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-view">
      <div className="page-header">
        <div>
          <span className="section-kicker">ISSUE TRACKER</span>
          <h1>诉求墙</h1>
          <p>把遇到的问题说清楚，也让解决过程被看见。</p>
        </div>
        <button className="primary-button" onClick={() => { if (requireAuth()) setCreateOpen(true) }}><Plus size={17} />提出诉求</button>
      </div>

      <div className="needs-overview">
        <div><span>全部诉求</span><strong>{needs.length}</strong><small>来自全校同学</small></div>
        <div><span>已获得回应</span><strong>{answered}</strong><small>回应率 <em>{needs.length ? Math.round((answered / needs.length) * 100) : 0}%</em></small></div>
        <div><span>已解决</span><strong>{resolved}</strong><small>每一件都有据可查</small></div>
      </div>

      <div className="section-heading compact">
        <div><span className="section-kicker">TRACKING</span><h2>诉求进展</h2></div>
        <div className="filter-pills">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部</button>
          <button className={filter === 'mine' ? 'active' : ''} onClick={() => setFilter('mine')}>我发起的</button>
          <button className={filter === 'following' ? 'active' : ''} onClick={() => setFilter('following')}>我关注的</button>
        </div>
      </div>

      <div className="need-list">
        {loading && <div className="empty-state loading-state">正在加载诉求…</div>}
        {!loading && filtered.length === 0 && (
          <div className="empty-state"><ClipboardList size={26} /><h3>这里还没有诉求</h3><p>{filter === 'all' ? '成为第一个提出诉求的人。' : '切换筛选条件看看其他诉求。'}</p></div>
        )}
        {filtered.map((need) => {
          const meta = NEED_STATUS[need.status]
          const expanded = expandedId === need.id
          return (
            <div className={`need-card ${expanded ? 'expanded' : ''}`} key={need.id}>
              <div className={`need-icon ${meta.tone}`}><ClipboardList size={18} /></div>
              <div className="need-main">
                <button className="need-title-row" onClick={() => setExpandedId(expanded ? null : need.id)}>
                  <h3>{need.title}</h3>
                  <span className={`status ${meta.tone}`}><Clock3 size={13} />{meta.label}</span>
                </button>
                <p>{need.dept} · 发起人 {need.author.nickname}{need.isOwn ? '（我）' : ''} · {timeAgo(need.createdAt)}</p>
                <div className="progress-track"><span style={{ width: `${meta.percent}%` }} /></div>
                <div className="need-foot">
                  <span><Users size={14} />{need.followerCount} 人关注</span>
                  <span>更新于 {timeAgo(need.updatedAt)}</span>
                  <button className={`follow-button ${need.following ? 'on' : ''}`} onClick={() => toggleFollow(need)}>
                    {need.following ? <CheckCircle2 size={13} /> : <Plus size={13} />}{need.following ? '已关注' : '关注'}
                  </button>
                  <button className="expand-button" onClick={() => setExpandedId(expanded ? null : need.id)} aria-label="展开详情">
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                </div>
                {expanded && (
                  <div className="need-detail">
                    <p className="need-body">{need.body}</p>
                    <div className="timeline">
                      <div className="timeline-item">
                        <span className="timeline-dot start" />
                        <div><strong>诉求发起</strong><p>{need.author.nickname} 提交给 {need.dept}</p><small>{timeAgo(need.createdAt)}</small></div>
                      </div>
                      {need.updates.map((update) => (
                        <div className="timeline-item" key={update.id}>
                          <span className={`timeline-dot ${NEED_STATUS[update.status as Need['status']]?.tone ?? 'pending'}`} />
                          <div>
                            <strong>{NEED_STATUS[update.status as Need['status']]?.label ?? update.status} · {update.by}</strong>
                            <p>{update.content}</p>
                            <small>{timeAgo(update.createdAt)}</small>
                          </div>
                        </div>
                      ))}
                      {need.updates.length === 0 && <div className="timeline-item"><span className="timeline-dot pending" /><div><strong>等待受理</strong><p>职能部门尚未回应，社区关注会加速处理。</p></div></div>}
                    </div>
                    {canHandle && (
                      <div className="staff-update-form">
                        <div className="staff-form-head">以 {user.nickname} 的身份更新进展</div>
                        <div className="staff-form-row">
                          <select value={updateStatus} onChange={(event) => setUpdateStatus(event.target.value)}>
                            {Object.entries(NEED_STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
                          </select>
                          <input value={updateContent} maxLength={500} onChange={(event) => setUpdateContent(event.target.value)} placeholder="填写处理进展（至少 5 个字）" />
                          <button className="primary-button" disabled={updateContent.trim().length < 5 || busy} onClick={() => submitUpdate(need)}><Send size={14} />更新</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {createOpen && (
        <NeedForm
          onClose={() => setCreateOpen(false)}
          onCreated={(need) => {
            setNeeds((items) => [need, ...items])
            setCreateOpen(false)
            setExpandedId(need.id)
            notify('诉求已提交，职能部门与关注者会收到进展通知')
          }}
        />
      )}
    </div>
  )
}
