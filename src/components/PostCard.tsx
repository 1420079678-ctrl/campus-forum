import { Bookmark, Eye, Flag, Heart, MessageCircle } from 'lucide-react'
import type { MouseEvent } from 'react'
import { timeAgo } from '../format'
import type { Post } from '../types'
import { avatarStyle } from '../avatar'

export default function PostCard({ post, onOpen, onLike, onFavorite, onReport, onAuthor }: {
  post: Post
  onOpen: (id: number) => void
  onLike: (post: Post) => void
  onFavorite: (post: Post) => void
  onReport: (post: Post) => void
  onAuthor?: (id: number) => void
}) {
  const stop = (event: MouseEvent, action: () => void) => {
    event.stopPropagation()
    action()
  }
  const boardTone = ({ '课程学业': 'coral', '校园生活': 'mint', '实习就业': 'gold', '经验问答': 'lavender', '闲置集市': 'sky', '社团活动': 'rose' } as Record<string, string>)[post.board] ?? 'mint'
  return (
    <article className={`post-card clickable post-tone-${boardTone}`} onClick={() => onOpen(post.id)}>
      <div className="post-meta">
        <span className="avatar" style={avatarStyle(post.author.id ?? post.author.nickname)}>{post.author.avatar}</span>
        <div className="post-author-copy">
          <strong>
            {onAuthor && post.author.id
              ? <button className="author-link" onClick={(event) => stop(event, () => onAuthor(post.author.id!))}>{post.author.nickname}</button>
              : post.author.nickname}
            {post.featured && <span className="mini-badge">精选</span>}
            {post.status === 'pending' && <span className="mini-badge warn">待复核</span>}
            {post.status === 'hidden' && <span className="mini-badge danger">已隐藏</span>}
          </strong>
          <span>{post.author.roleLabel} · {timeAgo(post.createdAt)}{post.edited ? ' · 已编辑' : ''}</span>
        </div>
        <div className="post-meta-side"><span className="post-board-pill">{post.board}</span><span className="post-views"><Eye size={13} />{post.viewCount}</span></div>
      </div>
      <div className={`post-content ${post.images.length === 1 ? 'with-cover' : ''}`}>
        <div className="post-copy">
          <h3>{post.title}</h3>
          <p>{post.body}</p>
          {post.tags.length > 0 && <div className="tag-row">{post.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
        </div>
        {post.images.length > 0 && (
          <div className={`post-images count-${Math.min(post.images.length, 4)}`}>
            {post.images.map((src, index) => <img key={src} src={src} alt={`${post.title} 配图 ${index + 1}`} loading="lazy" />)}
          </div>
        )}
      </div>
      <div className="post-actions">
        <button className={post.liked ? 'engaged' : ''} onClick={(event) => stop(event, () => onLike(post))}>
          <Heart size={17} fill={post.liked ? 'currentColor' : 'none'} /><span>赞</span>{post.likeCount}
        </button>
        <button onClick={(event) => stop(event, () => onOpen(post.id))}><MessageCircle size={17} /><span>回复</span>{post.commentCount}</button>
        <button className={post.favorited ? 'engaged' : ''} onClick={(event) => stop(event, () => onFavorite(post))}>
          <Bookmark size={16} fill={post.favorited ? 'currentColor' : 'none'} />{post.favorited ? '已收藏' : '收藏'}
        </button>
        <button className="report-action" onClick={(event) => stop(event, () => onReport(post))}><Flag size={15} />举报</button>
      </div>
    </article>
  )
}
