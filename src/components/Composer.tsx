import { useMemo, useState } from 'react'
import { PenLine, ShieldCheck, X } from 'lucide-react'
import { api } from '../api'
import type { Board, ModerationResult, Post } from '../types'

type PublishPayload = { post: Post; moderation: ModerationResult }

export default function Composer({ boards, editPost, onClose, onPublished }: {
  boards: Board[]
  editPost?: Post
  onClose: () => void
  onPublished: (post: Post, moderation: ModerationResult) => void
}) {
  const [board, setBoard] = useState(editPost?.board ?? boards[0]?.name ?? '学习交流')
  const [title, setTitle] = useState(editPost?.title ?? '')
  const [body, setBody] = useState(editPost?.body ?? '')
  const [tagsInput, setTagsInput] = useState(editPost?.tags.join(' ') ?? '')
  const [anonymous, setAnonymous] = useState(editPost?.author.anonymous ?? false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const tags = useMemo(() => Array.from(new Set(
    tagsInput.split(/[,，#\s]+/).map((tag) => tag.trim()).filter(Boolean),
  )).slice(0, 4), [tagsInput])

  const canPublish = title.trim().length >= 5 && body.trim().length >= 10 && !busy

  const publish = async () => {
    if (!canPublish) return
    setBusy(true)
    setError('')
    try {
      const payload = editPost
        ? await api<PublishPayload>(`/api/posts/${editPost.id}`, { method: 'PATCH', body: { board, title, body, tags, anonymous } })
        : await api<PublishPayload>('/api/posts', { method: 'POST', body: { board, title, body, tags, anonymous } })
      onPublished(payload.post, payload.moderation)
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败，请稍后再试')
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="composer-modal">
        <div className="modal-head">
          <div>
            <span className="section-kicker">{editPost ? 'EDIT POST' : 'START A DISCUSSION'}</span>
            <h2>{editPost ? '编辑这篇帖子' : '发起一场有价值的讨论'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </div>
        <label>选择板块
          <select value={board} onChange={(event) => setBoard(event.target.value)}>
            {boards.map((item) => <option key={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>标题 <small className="char-count">{title.trim().length}/60</small>
          <input autoFocus value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} placeholder="一句话说清楚你想讨论什么（至少 5 个字）" />
        </label>
        <label>正文 <small className="char-count">{body.trim().length}/5000</small>
          <textarea value={body} maxLength={5000} onChange={(event) => setBody(event.target.value)} placeholder="补充背景、你的尝试和希望得到的帮助…（至少 10 个字）" rows={6} />
        </label>
        <label>标签（可选，空格或逗号分隔，最多 4 个）
          <input value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} placeholder="如：期末复习 数据库" />
        </label>
        {tags.length > 0 && <div className="tag-row composer-tags">{tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
        <label className="toggle-row">
          <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} />
          <span className="toggle-track"><span className="toggle-thumb" /></span>
          <span className="toggle-label">匿名发布 <small>前台隐藏身份，实名信息仅审核可见</small></span>
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="composer-note">
          <ShieldCheck size={16} />
          <span>{editPost ? '编辑后会重新经过 AI 风险检查：低风险自动放行，高风险将进入人工复核。' : '发布前会经过 AI 风险检查：低风险自动放行，高风险将进入人工复核。'}请尊重他人，不要公开真实姓名、联系方式等隐私。</span>
        </div>
        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={!canPublish} onClick={publish}><PenLine size={16} />{busy ? (editPost ? '保存中…' : '发布中…') : editPost ? '保存修改' : '发布讨论'}</button>
        </div>
      </div>
    </div>
  )
}
