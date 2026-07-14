import { useEffect, useState } from 'react'
import { ClipboardList, ShieldCheck, X } from 'lucide-react'
import { api } from '../api'
import type { Need } from '../types'

let cachedDepartments: string[] | null = null

export default function NeedForm({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (need: Need) => void
}) {
  const [departments, setDepartments] = useState<string[]>(cachedDepartments ?? [])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [dept, setDept] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (cachedDepartments) {
      if (!dept && cachedDepartments.length) setDept(cachedDepartments[0])
      return
    }
    api<{ departments: string[] }>('/api/meta')
      .then((meta) => {
        cachedDepartments = meta.departments
        setDepartments(meta.departments)
        setDept((current) => current || meta.departments[0])
      })
      .catch(() => undefined)
  }, [dept])

  const canSubmit = title.trim().length >= 5 && body.trim().length >= 10 && dept && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError('')
    try {
      const payload = await api<{ data: Need }>('/api/needs', { method: 'POST', body: { title, body, dept, anonymous } })
      onCreated(payload.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后再试')
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="composer-modal">
        <div className="modal-head">
          <div>
            <span className="section-kicker">RAISE AN ISSUE</span>
            <h2>把问题说清楚，让它被解决</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </div>
        <label>诉求标题 <small className="char-count">{title.trim().length}/60</small>
          <input autoFocus value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} placeholder="一句话说明你希望解决的问题" />
        </label>
        <label>具体描述 <small className="char-count">{body.trim().length}/2000</small>
          <textarea value={body} maxLength={2000} onChange={(event) => setBody(event.target.value)} rows={5} placeholder="说明背景、影响范围和你期望的处理方式，越具体越容易被受理" />
        </label>
        <label>提交给
          <select value={dept} onChange={(event) => setDept(event.target.value)}>
            {departments.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} />
          <span className="toggle-track"><span className="toggle-thumb" /></span>
          <span className="toggle-label">匿名提交 <small>职能部门只能看到诉求内容，看不到你的身份</small></span>
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="composer-note">
          <ShieldCheck size={16} />
          <span>诉求提交后会通知对应职能部门，处理进展会推送给你和所有关注者，全过程公开可查。</span>
        </div>
        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={!canSubmit} onClick={submit}><ClipboardList size={15} />{busy ? '提交中…' : '提交诉求'}</button>
        </div>
      </div>
    </div>
  )
}
