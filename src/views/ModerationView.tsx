import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2, ChevronRight, ClipboardCheck, EyeOff, Flag, LockKeyhole,
  ShieldCheck, Sparkles, UserRound, Zap,
} from 'lucide-react'
import { api } from '../api'
import { timeAgo } from '../format'
import type { AuditLog, Me, ModerationOverview } from '../types'
import { RISK_LABEL } from '../types'

export default function ModerationView({ user, notify, requireAuth, navigate, onPendingChange }: {
  user: Me | null
  notify: (message: string) => void
  requireAuth: () => boolean
  navigate: (path: string) => void
  onPendingChange: (count: number) => void
}) {
  const canModerate = user && (user.role === 'moderator' || user.role === 'admin')
  const [overview, setOverview] = useState<ModerationOverview | null>(null)
  const [audit, setAudit] = useState<AuditLog[]>([])
  const [busyKey, setBusyKey] = useState('')
  const [showAudit, setShowAudit] = useState(false)

  const load = useCallback(() => {
    if (!canModerate) return
    api<{ data: ModerationOverview }>('/api/moderation/overview')
      .then((payload) => {
        setOverview(payload.data)
        onPendingChange(payload.data.metrics.pending)
      })
      .catch((err) => notify(err instanceof Error ? err.message : '加载失败'))
    api<{ data: AuditLog[] }>('/api/moderation/audit')
      .then((payload) => setAudit(payload.data))
      .catch(() => undefined)
  }, [canModerate, notify, onPendingChange])

  useEffect(load, [load])

  if (!canModerate) {
    return (
      <div className="page-view">
        <div className="empty-state">
          <LockKeyhole size={26} />
          <h3>内容审核台仅对审核人员开放</h3>
          <p>使用演示账号 mod / demo123456 登录可以体验完整审核流程。</p>
          {!user && <button className="primary-button" onClick={() => requireAuth()}>登录</button>}
        </div>
      </div>
    )
  }

  const act = async (key: string, run: () => Promise<unknown>, message: string) => {
    if (busyKey) return
    setBusyKey(key)
    try {
      await run()
      notify(message)
      load()
    } catch (err) {
      notify(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusyKey('')
    }
  }

  const metrics = overview?.metrics

  return (
    <div className="page-view">
      <div className="page-header">
        <div>
          <span className="section-kicker">TRUST &amp; SAFETY</span>
          <h1>内容审核台</h1>
          <p>AI 先筛查，人工做决定。每一次处理都有据可查。</p>
        </div>
        <div className="ai-status"><span className="pulse" />AI 巡检运行中</div>
      </div>

      <div className="moderation-metrics">
        <div className="mod-metric"><div className="metric-icon orange"><ShieldCheck size={18} /></div><span>待人工复核</span><strong>{metrics?.pending ?? '—'}</strong><small>帖子 + 举报</small></div>
        <div className="mod-metric"><div className="metric-icon blue"><Zap size={18} /></div><span>AI 自动放行率</span><strong>{metrics ? `${metrics.autoPassRate}%` : '—'}</strong><small>低风险内容直接发布</small></div>
        <div className="mod-metric"><div className="metric-icon green"><CheckCircle2 size={18} /></div><span>已处理</span><strong>{metrics?.handledToday ?? '—'}</strong><small>过去 24 小时</small></div>
      </div>

      <div className="section-heading compact">
        <div><span className="section-kicker">PENDING POSTS</span><h2>待复核帖子</h2></div>
      </div>
      <div className="review-list">
        {overview && overview.pendingPosts.length === 0 && (
          <div className="review-card reviewed"><CheckCircle2 size={20} /><div><strong>队列已清空</strong><span>没有等待复核的帖子</span></div></div>
        )}
        {overview?.pendingPosts.map((post) => (
          <div className="review-card pending-post" key={post.id}>
            <div className="review-risk">
              <span className={`risk-dot ${post.riskLevel === 'high' ? 'high' : post.riskLevel === 'medium' ? 'medium' : 'low'}`} />
              <strong>{RISK_LABEL[post.riskLevel ?? 'low']}</strong>
            </div>
            <div className="review-copy">
              <h3>{post.title}</h3>
              <p className="review-body">{post.body.slice(0, 120)}{post.body.length > 120 ? '…' : ''}</p>
              <p className="review-meta">
                <UserRound size={12} /> {post.realAuthor ? `${post.author.nickname}（实名：${post.realAuthor.nickname}）` : post.author.nickname}
                · {post.board} · {timeAgo(post.createdAt)}
              </p>
              {post.riskReasons && post.riskReasons.length > 0 && <p className="review-reasons"><Sparkles size={12} /> AI：{post.riskReasons.join('；')}</p>}
            </div>
            <div className="review-actions">
              <button disabled={busyKey === `post-${post.id}`} onClick={() => act(`post-${post.id}`, () => api(`/api/moderation/posts/${post.id}`, { method: 'POST', body: { action: 'approve' } }), '已通过复核，帖子现已公开')}>通过</button>
              <button className="danger" disabled={busyKey === `post-${post.id}`} onClick={() => act(`post-${post.id}`, () => api(`/api/moderation/posts/${post.id}`, { method: 'POST', body: { action: 'hide' } }), '帖子已隐藏，作者已收到通知')}><EyeOff size={13} />隐藏</button>
            </div>
          </div>
        ))}
      </div>

      <div className="section-heading compact">
        <div><span className="section-kicker">OPEN REPORTS</span><h2>待处理举报</h2></div>
      </div>
      <div className="review-list">
        {overview && overview.openReports.length === 0 && (
          <div className="review-card reviewed"><CheckCircle2 size={20} /><div><strong>没有待处理的举报</strong><span>社区运转良好</span></div></div>
        )}
        {overview?.openReports.map((report) => (
          <div className="review-card" key={report.id}>
            <div className="review-risk"><Flag size={15} className="report-flag" /><strong>举报</strong></div>
            <div className="review-copy">
              <h3>{report.target.title}</h3>
              <p className="review-body">「{report.target.excerpt}」 — {report.target.author}</p>
              <p className="review-meta">{report.reporter} 举报 · {report.reason}{report.detail ? ` · ${report.detail}` : ''} · {timeAgo(report.createdAt)}</p>
              {report.target.kind === 'post' && (
                <button className="link-button" onClick={() => navigate(`/post/${report.target.id}`)}>查看原帖 <ChevronRight size={12} /></button>
              )}
            </div>
            <div className="review-actions">
              <button disabled={busyKey === `report-${report.id}`} onClick={() => act(`report-${report.id}`, () => api(`/api/moderation/reports/${report.id}`, { method: 'POST', body: { action: 'dismiss' } }), '举报已驳回')}>驳回</button>
              <button className="danger" disabled={busyKey === `report-${report.id}`} onClick={() => act(`report-${report.id}`, () => api(`/api/moderation/reports/${report.id}`, { method: 'POST', body: { action: 'hide' } }), '内容已隐藏，相关人已收到通知')}><EyeOff size={13} />隐藏内容</button>
            </div>
          </div>
        ))}
      </div>

      <div className="section-heading compact">
        <div><span className="section-kicker">AUDIT TRAIL</span><h2>审计日志</h2></div>
        <button className="ghost-button" onClick={() => setShowAudit((value) => !value)}>{showAudit ? '收起' : `展开全部（${audit.length}）`} <ChevronRight size={15} /></button>
      </div>
      <div className="audit-list">
        {(showAudit ? audit : audit.slice(0, 6)).map((log) => (
          <div className="audit-item" key={log.id}>
            <span className={`audit-actor ${log.actorType}`}>{log.actorType === 'ai' ? <Sparkles size={13} /> : <ClipboardCheck size={13} />}{log.actor}</span>
            <span className="audit-action">{log.action}</span>
            <span className="audit-reason">{log.reason}</span>
            <small>{timeAgo(log.createdAt)}</small>
          </div>
        ))}
        {audit.length === 0 && <div className="empty-state small"><p>暂无审计记录</p></div>}
      </div>
    </div>
  )
}
