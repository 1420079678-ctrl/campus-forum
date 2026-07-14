import { useEffect, useState } from 'react'
import {
  ArrowLeft, Bookmark, CornerDownRight, Eye, Flag, Hash, Heart, MessageCircle,
  PenLine, SendHorizontal, ShieldAlert, Star, Trash2,
} from 'lucide-react'
import { api } from '../api'
import { timeAgo } from '../format'
import Composer from '../components/Composer'
import type { Board, CommentItem, Me, Post } from '../types'
import { RISK_LABEL } from '../types'

export default function PostDetailView({ id, user, boards, navigate, notify, requireAuth, onReport, onReportComment, onDeleted, onChanged }: {
  id: number
  user: Me | null
  boards: Board[]
  navigate: (path: string) => void
  notify: (message: string) => void
  requireAuth: () => boolean
  onReport: (post: Post) => void
  onReportComment: (comment: CommentItem) => void
  onDeleted: () => void
  onChanged: () => void
}) {
  const [post, setPost] = useState<Post | null>(null)
  const [comments, setComments] = useState<CommentItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)

  const canModerate = user && (user.role === 'moderator' || user.role === 'admin')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      api<{ data: Post }>(`/api/posts/${id}`),
      api<{ data: CommentItem[] }>(`/api/posts/${id}/comments`).catch(() => ({ data: [] as CommentItem[] })),
    ])
      .then(([postPayload, commentsPayload]) => {
        if (cancelled) return
        setPost(postPayload.data)
        setComments(commentsPayload.data)
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [id, user?.id])

  const openAuthor = (authorId?: number) => {
    if (authorId) navigate(`/user/${authorId}`)
  }

  const togglePostLike = async () => {
    if (!post || !requireAuth()) return
    const revert = post
    setPost({ ...post, liked: !post.liked, likeCount: post.likeCount + (post.liked ? -1 : 1) })
    try {
      await api(`/api/posts/${post.id}/like`, { method: 'POST' })
    } catch (err) {
      setPost(revert)
      notify(err instanceof Error ? err.message : '操作失败')
    }
  }

  const togglePostFavorite = async () => {
    if (!post || !requireAuth()) return
    const revert = post
    setPost({ ...post, favorited: !post.favorited })
    try {
      await api(`/api/posts/${post.id}/favorite`, { method: 'POST' })
      notify(post.favorited ? '已取消收藏' : '已收藏这条讨论')
    } catch (err) {
      setPost(revert)
      notify(err instanceof Error ? err.message : '操作失败')
    }
  }

  const toggleFeatured = async () => {
    if (!post) return
    try {
      await api(`/api/moderation/posts/${post.id}`, { method: 'POST', body: { action: post.featured ? 'unfeature' : 'feature' } })
      setPost({ ...post, featured: !post.featured })
      notify(post.featured ? '已取消精选' : '已设为精选，作者会收到通知')
      onChanged()
    } catch (err) {
      notify(err instanceof Error ? err.message : '操作失败')
    }
  }

  const toggleCommentLike = async (comment: CommentItem) => {
    if (!requireAuth()) return
    const revert = comments
    setComments((items) => items.map((item) => item.id === comment.id
      ? { ...item, liked: !item.liked, likeCount: item.likeCount + (item.liked ? -1 : 1) }
      : item))
    try {
      await api(`/api/comments/${comment.id}/like`, { method: 'POST' })
    } catch (err) {
      setComments(revert)
      notify(err instanceof Error ? err.message : '操作失败')
    }
  }

  const submitComment = async () => {
    if (!requireAuth() || !post || body.trim().length === 0 || busy) return
    setBusy(true)
    try {
      const payload = await api<{ data: CommentItem }>(`/api/posts/${post.id}/comments`, {
        method: 'POST',
        body: { body, parentId: replyTo?.id, anonymous },
      })
      setComments((items) => [...items, payload.data])
      setPost((current) => current ? { ...current, commentCount: current.commentCount + 1 } : current)
      setBody('')
      setReplyTo(null)
      notify('评论已发布')
    } catch (err) {
      notify(err instanceof Error ? err.message : '发布失败')
    } finally {
      setBusy(false)
    }
  }

  const deleteComment = async (comment: CommentItem) => {
    if (!window.confirm('确定删除这条评论吗？')) return
    try {
      await api(`/api/comments/${comment.id}`, { method: 'DELETE' })
      setComments((items) => items.filter((item) => item.id !== comment.id))
      setPost((current) => current ? { ...current, commentCount: Math.max(0, current.commentCount - 1) } : current)
      notify('评论已删除')
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败')
    }
  }

  const deletePost = async () => {
    if (!post || !window.confirm('确定删除这篇帖子吗？删除后无法恢复。')) return
    try {
      await api(`/api/posts/${post.id}`, { method: 'DELETE' })
      notify('帖子已删除')
      onDeleted()
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败')
    }
  }

  if (loading) return <div className="page-view"><div className="empty-state loading-state">正在加载帖子…</div></div>
  if (error || !post) {
    return (
      <div className="page-view">
        <button className="ghost-button" onClick={() => navigate('/')}><ArrowLeft size={15} />返回社区</button>
        <div className="empty-state"><ShieldAlert size={26} /><h3>{error || '帖子不存在'}</h3><p>它可能已被删除，或暂时处于审核中。</p></div>
      </div>
    )
  }

  return (
    <div className="page-view post-detail">
      <button className="ghost-button" onClick={() => navigate('/')}><ArrowLeft size={15} />返回社区</button>
      {post.status === 'pending' && (
        <div className="status-banner warn"><ShieldAlert size={16} />这篇帖子正在等待人工复核，目前只有你自己可以看到。{post.riskReasons?.length ? ` AI 标记原因：${post.riskReasons.join('；')}` : ''}</div>
      )}
      {post.status === 'hidden' && (
        <div className="status-banner danger"><ShieldAlert size={16} />这篇帖子已被隐藏，仅作者与审核人员可见。</div>
      )}
      <article className="post-card detail-card">
        <div className="post-meta">
          <span className="avatar">{post.author.avatar}</span>
          <div>
            <strong>
              {post.author.id
                ? <button className="author-link" onClick={() => openAuthor(post.author.id)}>{post.author.nickname}</button>
                : post.author.nickname}
              {post.featured && <span className="mini-badge">精选</span>}
            </strong>
            <span>{post.author.roleLabel} · {timeAgo(post.createdAt)}{post.edited ? ' · 已编辑' : ''}</span>
          </div>
          <span className="post-views"><Eye size={13} />{post.viewCount} 次浏览</span>
        </div>
        <div className="post-content detail-content">
          <div className="post-board"><Hash size={13} />{post.board}</div>
          <h1>{post.title}</h1>
          <p className="detail-body">{post.body}</p>
          {post.images.length > 0 && (
            <div className={`post-images detail-images count-${Math.min(post.images.length, 4)}`}>
              {post.images.map((src, index) => <img key={src} src={src} alt={`${post.title} 配图 ${index + 1}`} />)}
            </div>
          )}
          {post.tags.length > 0 && <div className="tag-row">{post.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
        </div>
        <div className="post-actions detail-actions">
          <button className={post.liked ? 'engaged' : ''} onClick={togglePostLike}><Heart size={17} fill={post.liked ? 'currentColor' : 'none'} />{post.likeCount}</button>
          <button><MessageCircle size={17} />{post.commentCount}</button>
          <button className={post.favorited ? 'engaged' : ''} onClick={togglePostFavorite}><Bookmark size={16} fill={post.favorited ? 'currentColor' : 'none'} />{post.favorited ? '已收藏' : '收藏'}</button>
          {canModerate && post.status === 'visible' && (
            <button className={post.featured ? 'engaged' : ''} onClick={toggleFeatured}><Star size={15} fill={post.featured ? 'currentColor' : 'none'} />{post.featured ? '取消精选' : '设为精选'}</button>
          )}
          {post.isOwn && <button onClick={() => setEditing(true)}><PenLine size={15} />编辑</button>}
          {post.isOwn && <button className="danger-action" onClick={deletePost}><Trash2 size={15} />删除</button>}
          {!post.isOwn && <button className="report-action" onClick={() => requireAuth() && onReport(post)}><Flag size={15} />举报</button>}
        </div>
      </article>

      <div className="section-heading compact comments-heading">
        <div><span className="section-kicker">DISCUSSION</span><h2>{post.commentCount} 条回复</h2></div>
      </div>
      <div className="comment-list">
        {comments.length === 0 && <div className="empty-state small"><MessageCircle size={22} /><p>还没有回复，来抢个沙发。</p></div>}
        {comments.map((comment) => (
          <div key={comment.id} className={`comment-item ${comment.parentId ? 'nested' : ''}`}>
            {comment.parentId && <CornerDownRight size={14} className="nest-mark" />}
            <span className="avatar small">{comment.author.avatar}</span>
            <div className="comment-main">
              <div className="comment-head">
                <strong>
                  {comment.author.id
                    ? <button className="author-link" onClick={() => openAuthor(comment.author.id)}>{comment.author.nickname}</button>
                    : comment.author.nickname}
                </strong>
                <span>{comment.author.roleLabel}</span>
                {comment.replyTo && <span className="reply-to">回复 {comment.replyTo}</span>}
                <small>{timeAgo(comment.createdAt)}</small>
              </div>
              <p>{comment.body}</p>
              <div className="comment-actions">
                <button className={comment.liked ? 'engaged' : ''} onClick={() => toggleCommentLike(comment)}>
                  <Heart size={14} fill={comment.liked ? 'currentColor' : 'none'} />{comment.likeCount > 0 ? comment.likeCount : '赞'}
                </button>
                <button onClick={() => { if (requireAuth()) { setReplyTo(comment); document.getElementById('comment-input')?.focus() } }}><MessageCircle size={14} />回复</button>
                {comment.isOwn && <button onClick={() => deleteComment(comment)}><Trash2 size={13} />删除</button>}
                {!comment.isOwn && <button onClick={() => requireAuth() && onReportComment(comment)}><Flag size={13} />举报</button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="comment-composer">
        {replyTo && (
          <div className="replying-chip">
            <CornerDownRight size={13} />回复 {replyTo.author.nickname}：{replyTo.body.slice(0, 24)}…
            <button onClick={() => setReplyTo(null)}>取消</button>
          </div>
        )}
        {user ? (
          <>
            <div className="comment-input-row">
              <span className="avatar small">{user.avatar}</span>
              <textarea
                id="comment-input"
                value={body}
                maxLength={1000}
                onChange={(event) => setBody(event.target.value)}
                placeholder={post.status === 'visible' ? '友善的回复是社区最好的礼物…' : '帖子审核通过后才能回复'}
                disabled={post.status !== 'visible'}
                rows={3}
              />
            </div>
            <div className="comment-submit-row">
              <label className="toggle-row small">
                <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} />
                <span className="toggle-track"><span className="toggle-thumb" /></span>
                <span className="toggle-label">匿名回复</span>
              </label>
              <button className="primary-button" disabled={body.trim().length === 0 || busy || post.status !== 'visible'} onClick={submitComment}>
                <SendHorizontal size={15} />{busy ? '发布中…' : replyTo ? '发布回复' : '发布评论'}
              </button>
            </div>
          </>
        ) : (
          <button className="ghost-button login-to-comment" onClick={() => requireAuth()}>登录后参与讨论</button>
        )}
      </div>
      {post.riskLevel && post.riskLevel !== 'low' && post.isOwn && (
        <p className="risk-note">AI 风险评估：{RISK_LABEL[post.riskLevel]}{post.riskReasons?.length ? ` · ${post.riskReasons.join('；')}` : ''}</p>
      )}
      {editing && (
        <Composer
          boards={boards}
          editPost={post}
          onClose={() => setEditing(false)}
          onPublished={(updated, moderation) => {
            setEditing(false)
            setPost(updated)
            onChanged()
            if (updated.status === 'pending') {
              notify(`AI 判定为${moderation.risk === 'high' ? '高' : '中'}风险，帖子将在人工复核通过后重新公开`)
            } else {
              notify('修改已保存')
            }
          }}
        />
      )}
    </div>
  )
}
