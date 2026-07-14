import { useEffect, useState } from 'react'
import { Plus, Search, Sparkles, Users, Zap } from 'lucide-react'
import { api } from '../api'
import PostCard from '../components/PostCard'
import type { CommunityStats, Me, Post, PostPage } from '../types'

const PAGE_SIZE = 10

export default function HomeView({ user, boards, activeBoard, setActiveBoard, query, refreshKey, onCompose, navigate, notify, requireAuth, onReport }: {
  user: Me | null
  boards: string[]
  activeBoard: string
  setActiveBoard: (board: string) => void
  query: string
  refreshKey: number
  onCompose: () => void
  navigate: (path: string) => void
  notify: (message: string) => void
  requireAuth: () => boolean
  onReport: (post: Post) => void
}) {
  const [sort, setSort] = useState<'recommend' | 'latest' | 'hot'>('recommend')
  const [feed, setFeed] = useState<'campus' | 'following'>('campus')
  const [posts, setPosts] = useState<Post[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [stats, setStats] = useState<CommunityStats | null>(null)
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    api<{ data: CommunityStats }>('/api/stats').then((payload) => setStats(payload.data)).catch(() => undefined)
  }, [refreshKey])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api<PostPage>(`/api/posts?board=${encodeURIComponent(activeBoard)}&q=${encodeURIComponent(debouncedQuery)}&sort=${sort}&following=${feed === 'following' ? '1' : '0'}&page=1&pageSize=${PAGE_SIZE}`)
      .then((payload) => {
        if (cancelled) return
        setPosts(payload.items)
        setTotal(payload.total)
        setPage(1)
      })
      .catch((err) => !cancelled && notify(err instanceof Error ? err.message : '加载失败'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [activeBoard, debouncedQuery, sort, feed, refreshKey, user?.id, notify])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const payload = await api<PostPage>(`/api/posts?board=${encodeURIComponent(activeBoard)}&q=${encodeURIComponent(debouncedQuery)}&sort=${sort}&following=${feed === 'following' ? '1' : '0'}&page=${page + 1}&pageSize=${PAGE_SIZE}`)
      setPosts((items) => {
        const seen = new Set(items.map((post) => post.id))
        return [...items, ...payload.items.filter((post) => !seen.has(post.id))]
      })
      setTotal(payload.total)
      setPage(payload.page)
    } catch {
      notify('加载失败，请稍后再试')
    } finally {
      setLoadingMore(false)
    }
  }

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

  const handleReport = (post: Post) => {
    if (!requireAuth()) return
    onReport(post)
  }

  return <>
    <section className="hero-row">
      <div>
        <div className="eyebrow"><span className="live-dot" />今天，校园里有什么新鲜事</div>
        <h1>一起把大学过明白。</h1>
        <p className="hero-copy">分享经验，提出问题，找到同路人。<br />在这里，学生的每个声音都能被看见。</p>
      </div>
      <div className="hero-art">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" />
        <div className="hero-sticker sticker-one"><Users size={16} /><strong>{stats?.members ?? '—'}</strong><span>位成员在这里</span></div>
        <div className="hero-sticker sticker-two"><Zap size={16} /><strong>{stats ? `${stats.needResponseRate}%` : '—'}</strong><span>诉求得到回应</span></div>
        <div className="hero-sun"><Sparkles size={34} /></div>
      </div>
    </section>
    <section className="stats-row">
      <div><strong>{stats?.members ?? '—'}</strong><span>社区成员</span></div>
      <div><strong>{stats?.weekDiscussions ?? '—'}</strong><span>本周讨论</span></div>
      <div><strong>{stats ? `${stats.needResponseRate}%` : '—'}</strong><span>诉求回应率</span></div>
      <div><strong>{stats?.knowledgeCount ?? '—'}</strong><span>条经验沉淀</span></div>
    </section>
    <div className="section-heading">
      <div><span className="section-kicker">COMMUNITY FEED</span><h2>社区动态</h2></div>
      <button className="primary-button" onClick={onCompose}><Plus size={17} />发起讨论</button>
    </div>
    <div className="feed-scope" aria-label="信息流范围">
      <button className={feed === 'campus' ? 'active' : ''} onClick={() => setFeed('campus')}>校园广场</button>
      <button className={feed === 'following' ? 'active' : ''} onClick={() => {
        if (!user && !requireAuth()) return
        setFeed('following')
      }}>我的关注</button>
    </div>
    <div className="feed-toolbar">
      <div className="filter-pills">
        {['全部', ...boards].map((name) => (
          <button key={name} className={activeBoard === name ? 'active' : ''} onClick={() => setActiveBoard(name)}>{name}</button>
        ))}
      </div>
      <div className="sort-select">
        <span>排序：</span>
        <button className={sort === 'recommend' ? 'selected' : ''} onClick={() => setSort('recommend')}>推荐</button>
        <button className={sort === 'latest' ? 'selected' : ''} onClick={() => setSort('latest')}>最新</button>
        <button className={sort === 'hot' ? 'selected' : ''} onClick={() => setSort('hot')}>热门</button>
      </div>
    </div>
    <div className="feed-list">
      {loading && <div className="empty-state loading-state">正在加载社区动态…</div>}
      {!loading && posts.map((post) => (
        <PostCard key={post.id} post={post} onOpen={(id) => navigate(`/post/${id}`)} onLike={toggleLike} onFavorite={toggleFavorite} onReport={handleReport} onAuthor={(id) => navigate(`/user/${id}`)} />
      ))}
      {!loading && posts.length === 0 && (
        <div className="empty-state">
          <Search size={26} />
          <h3>{feed === 'following' ? '关注流还是空的' : '没有找到相关讨论'}</h3>
          <p>{feed === 'following' ? '去校园广场关注感兴趣的同学，他们的新帖子会出现在这里。' : '换个关键词，或者发起一个新的话题。'}</p>
        </div>
      )}
      {!loading && posts.length < total && (
        <button className="ghost-button load-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? '加载中…' : `加载更多（还有 ${total - posts.length} 条）`}
        </button>
      )}
    </div>
  </>
}
