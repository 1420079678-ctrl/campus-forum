import { useEffect, useState } from 'react'
import { Flag, X } from 'lucide-react'
import { api } from '../api'

export type ReportTargetInput = { type: 'post' | 'comment'; id: number; title: string }

let cachedReasons: string[] | null = null

export default function ReportModal({ target, onClose, notify }: {
  target: ReportTargetInput
  onClose: () => void
  notify: (message: string) => void
}) {
  const [reasons, setReasons] = useState<string[]>(cachedReasons ?? [])
  const [reason, setReason] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (cachedReasons) return
    api<{ reportReasons: string[] }>('/api/meta')
      .then((meta) => { cachedReasons = meta.reportReasons; setReasons(meta.reportReasons) })
      .catch(() => setReasons(['垃圾广告或引流', '疑似诈骗或违规交易', '人身攻击或不友善', '其他']))
  }, [])

  const submit = async () => {
    if (!reason || busy) return
    setBusy(true)
    setError('')
    try {
      await api('/api/reports', { method: 'POST', body: { targetType: target.type, targetId: target.id, reason, detail } })
      notify('举报已提交，审核员会尽快处理')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后再试')
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="composer-modal report-modal">
        <div className="modal-head">
          <div>
            <span className="section-kicker">REPORT CONTENT</span>
            <h2>举报{target.type === 'post' ? '帖子' : '评论'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </div>
        <p className="report-target">{target.title}</p>
        <div className="reason-list">
          {reasons.map((item) => (
            <button key={item} className={reason === item ? 'selected' : ''} onClick={() => setReason(item)}>{item}</button>
          ))}
        </div>
        <label>补充说明（可选）
          <textarea value={detail} maxLength={300} onChange={(event) => setDetail(event.target.value)} rows={3} placeholder="补充具体情况，帮助审核员更快判断" />
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={!reason || busy} onClick={submit}><Flag size={15} />{busy ? '提交中…' : '提交举报'}</button>
        </div>
      </div>
    </div>
  )
}
