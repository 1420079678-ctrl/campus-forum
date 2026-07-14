import { useEffect, useState } from 'react'
import { ArrowLeft, CalendarDays, Heart, Mail, MessageCircle, PenLine, UserCheck, UserPlus, UserRound } from 'lucide-react'
import { api } from '../api'
import PostCard from '../components/PostCard'
import type { Me, Post, PostPage, PublicProfile } from '../types'

export default function UserView({ id, user, navigate, notify, requireAuth, onReport }: {
  id: number
  user: Me | null
  navigate: (path: string) => void
  notify: (message: string) => void
  requireAuth: () => boolean
  onReport: (post: Post) => void
}) {
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [followBusy, setFollowBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      api<{ data: PublicProfile }>(`/api/users/${id}`),
      api<PostPage>(`/api/posts?user=${id}&sort=latest&pageSize=50`).catch(() => ({ items: [] as Post[] })),
    ])
      .then(([profilePayload, postsPayload]) => {
        if (cancelled) return
        setProfile(profilePayload.data)
        setPosts(postsPayload.items)
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [id, user?.id])

  const toggleLike = async (post: Post) => {
    if (!requireAuth()) return
    const revert = posts
    setPosts((items) => items.map((item) => item.id === post.id
      ? { ...item, liked: !item.liked, likeCount: item.likeCount + (item.liked ? -1 : 1) }
      : item))
    try {
      await api(`/api/posts/${post.id}/like`, { method: 'POST' })
    } catch (err) {
      setPosts(revert)
      notify(err instanceof Error ? err.message : '操作失败')
    }
  }

  const toggleFavorite = async (post: Post) => {
    if (!requireAuth()) return
    const revert = posts
    setPosts((items) => items.map((item) => item.id === post.id ? { ...item, favorited: !item.favorited } : item))
    try {
      await api(`/api/posts/${post.id}/favorite`, { method: 'POST' })
      notify(post.favorited ? '已取消收藏' : '已收藏这条讨论')
    } catch (err) {
      setPosts(revert)
      notify(err instanceof Error ? err.message : '操作失败')
    }
  }

  const toggleFollow = async () => {
    if (!profile || !requireAuth() || followBusy) return
    setFollowBusy(true)
    try {
      const payload = await api<{ data: { following: boolean; followerCount: number } }>(`/api/users/${id}/follow`, { method: 'POST' })
      setProfile({ ...profile, following: payload.data.following, stats: { ...profile.stats, followers: payload.data.followerCount } })
      notify(payload.data.following ? `已关注 ${profile.nickname}` : `已取消关注 ${profile.nickname}`)
    } catch (err) {
      notify(err instanceof Error ? err.message : '操作失败')
    } finally {
      setFollowBusy(false)
    }
  }

  if (loading) return <div className="page-view"><div className="empty-state loading-state">正在加载主页…</div></div>
  if (error || !profile) {
    return (
      <div className="page-view">
        <button className="ghost-button" onClick={() => navigate('/')}><ArrowLeft size={15} />返回社区</button>
        <div className="empty-state"><UserRound size={26} /><h3>{error || '用户不存在'}</h3><p>这位同学可能已经离开社区。</p></div>
      </div>
    )
  }

  return (
    <div className="page-view">
      <button className="ghost-button" onClick={() => navigate('/')}><ArrowLeft size={15} />返回社区</button>
      <div className="profile-hero">
        <div className="avatar profile-avatar">{profile.avatar}</div>
        <div>
          <span className="verified-label"><UserRound size={14} />{profile.roleLabel}</span>
          <h1>{profile.nickname}</h1>
          <p><CalendarDays size={12} style={{ verticalAlign: '-2px' }} /> 加入嘉大圈 {profile.joinedDays} 天</p>
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        </div>
        {user?.id !== profile.id && (
          <div className="profile-hero-actions">
            <button className={`ghost-button ${profile.following ? 'engaged' : ''}`} disabled={followBusy} onClick={toggleFollow}>
              {profile.following ? <UserCheck size={15} /> : <UserPlus size={15} />}{profile.following ? '已关注' : '关注'}
            </button>
            <button className="primary-button" onClick={() => requireAuth() && navigate(`/messages/${profile.id}`)}><Mail size={15} />发私信</button>
          </div>
        )}
      </div>
      <div className="profile-panel user-impact">
        <span className="section-kicker">COMMUNITY IMPACT</span>
        <div className="impact-row">
          <div><strong>{profile.stats.posts}</strong><span><PenLine size={11} /> 公开帖子</span></div>
          <div><strong>{profile.stats.comments}</strong><span><MessageCircle size={11} /> 参与回复</span></div>
          <div><strong>{profile.stats.likesReceived}</strong><span><Heart size={11} /> 获得赞同</span></div>
          <div><strong>{profile.stats.followers}</strong><span><UserRound size={11} /> 关注者</span></div>
          <div><strong>{profile.stats.following}</strong><span><UserCheck size={11} /> 正在关注</span></div>
        </div>
      </div>
      <div className="section-heading compact user-posts-heading">
        <div><span className="section-kicker">PUBLIC POSTS</span><h2>TA 的公开帖子</h2></div>
      </div>
      <div className="feed-list">
        {posts.length === 0 && <div className="empty-state small"><p>还没有公开的帖子。</p></div>}
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onOpen={(postId) => navigate(`/post/${postId}`)}
            onLike={toggleLike}
            onFavorite={toggleFavorite}
            onReport={(target) => { if (requireAuth()) onReport(target) }}
          />
        ))}
      </div>
    </div>
  )
}
