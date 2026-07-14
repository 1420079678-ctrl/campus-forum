import { useEffect, useState } from 'react'
import { ChevronRight, Flame, Hash, MapPin, Plus, Search, Sparkles, TrendingUp, Users } from 'lucide-react'
import { api } from '../api'
import { boardIcon } from '../boardMeta'
import { formatCount } from '../format'
import PostCard from '../components/PostCard'
import type { Board, CommunityPulse, CommunityStats, Me, Post, PostPage } from '../types'

const PAGE_SIZE = 10

export default function HomeView({ user, boards, activeBoard, setActiveBoard, query, onSearch, refreshKey, onCompose, navigate, notify, requireAuth, onReport }: {
  user: Me | null
  boards: Board[]
  activeBoard: string
  setActiveBoard: (board: string) => void
  query: string
  onSearch: (value: string) => void
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
  const [pulse, setPulse] = useState<CommunityPulse | null>(null)
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    Promise.all([
      api<{ data: CommunityStats }>('/api/stats'),
      api<{ data: CommunityPulse }>('/api/pulse'),
    ]).then(([statsPayload, pulsePayload]) => {
      setStats(statsPayload.data)
      setPulse(pulsePayload.data)
    }).catch(() => undefined)
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

  const chooseFollowing = () => {
    if (!user && !requireAuth()) return
    setFeed('following')
  }

  return (
    <div className="community-layout">
      <section className="feed-shell">
        <header className="feed-head">
          <div>
            <span className="campus-label"><MapPin size={13} />嘉兴大学</span>
            <h1>{feed === 'campus' ? '嘉大正在发生' : '我关注的同学'}</h1>
            <p>{feed === 'campus' ? '课程、生活、搭子和经验，都在这里聊。' : '只看你在意的人，少一点噪音。'}</p>
          </div>
          <button className="primary-button desktop-compose" onClick={onCompose}><Plus size={17} />发布</button>
        </header>

        <div className="feed-tabs" role="tablist" aria-label="信息流范围">
          <button role="tab" aria-selected={feed === 'campus'} className={feed === 'campus' ? 'active' : ''} onClick={() => setFeed('campus')}>推荐</button>
          <button role="tab" aria-selected={feed === 'following'} className={feed === 'following' ? 'active' : ''} onClick={chooseFollowing}>关注</button>
          <button role="tab" aria-selected={sort === 'latest'} className={sort === 'latest' ? 'active' : ''} onClick={() => { setFeed('campus'); setSort('latest') }}>最新</button>
        </div>

        <div className="board-strip" aria-label="兴趣板块">
          <button className={activeBoard === '全部' ? 'active' : ''} onClick={() => setActiveBoard('全部')}><Hash size={14} />全部</button>
          {boards.map((board) => {
            const Icon = boardIcon(board.icon)
            return <button key={board.id} className={activeBoard === board.name ? 'active' : ''} onClick={() => setActiveBoard(board.name)}><Icon size={14} />{board.name}</button>
          })}
        </div>

        <div className="feed-control-bar">
          <span>{query ? `“${query}” 的结果` : activeBoard === '全部' ? '全部动态' : activeBoard}<b>{total}</b></span>
          <div className="sort-select" aria-label="帖子排序">
            <button className={sort === 'recommend' ? 'selected' : ''} onClick={() => setSort('recommend')}>综合</button>
            <button className={sort === 'hot' ? 'selected' : ''} onClick={() => setSort('hot')}>热度</button>
            <button className={sort === 'latest' ? 'selected' : ''} onClick={() => setSort('latest')}>时间</button>
          </div>
        </div>

        <div className="feed-list">
          {loading && [0, 1, 2].map((item) => <div className="post-skeleton" key={item}><i /><div><b /><span /><span /></div></div>)}
          {!loading && posts.map((post) => (
            <PostCard key={post.id} post={post} onOpen={(id) => navigate(`/post/${id}`)} onLike={toggleLike} onFavorite={toggleFavorite} onReport={(target) => requireAuth() && onReport(target)} onAuthor={(id) => navigate(`/user/${id}`)} />
          ))}
          {!loading && posts.length === 0 && (
            <div className="empty-state feed-empty">
              <Search size={24} />
              <h3>{feed === 'following' ? '关注流还是空的' : '没有找到相关讨论'}</h3>
              <p>{feed === 'following' ? '去推荐页关注几位有趣的同学吧。' : '换个关键词，或者发起第一条讨论。'}</p>
              <button className="primary-button" onClick={feed === 'following' ? () => setFeed('campus') : onCompose}>{feed === 'following' ? '去逛推荐' : '发布讨论'}</button>
            </div>
          )}
          {!loading && posts.length < total && <button className="ghost-button load-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? '加载中…' : `继续看 ${total - posts.length} 条动态`}</button>}
        </div>
      </section>

      <aside className="campus-rail" id="campus-hot">
        <section className="campus-card">
          <div className="campus-card-head"><span className="campus-emblem">嘉</span><div><strong>嘉兴大学</strong><small>学生社区 · STUDENTS ONLY</small></div></div>
          <p>只属于嘉大学生的真实讨论场。可以匿名表达，但每个账号都经过校园身份验证。</p>
          <div className="campus-metrics">
            <div><strong>{stats?.members ?? '—'}</strong><span>嘉大同学</span></div>
            <div><strong>{stats?.weekDiscussions ?? '—'}</strong><span>本周互动</span></div>
            <div><strong>{pulse?.onlineNow ?? '—'}</strong><span>近期在线</span></div>
          </div>
        </section>

        <section className="rail-section hot-section">
          <div className="rail-title"><span><Flame size={16} />嘉大热榜</span><small>实时</small></div>
          <div className="hot-list">
            {pulse?.hotPosts.map((post, index) => (
              <button key={post.id} onClick={() => navigate(`/post/${post.id}`)}>
                <b className={index < 3 ? 'top' : ''}>{index + 1}</b>
                <span><strong>{post.title}</strong><small>{post.board} · {formatCount(Math.round(post.heat))} 热度</small></span>
                <ChevronRight size={13} />
              </button>
            ))}
          </div>
        </section>

        <section className="rail-section topic-section">
          <div className="rail-title"><span><TrendingUp size={16} />热门话题</span></div>
          <div className="topic-cloud">
            {pulse?.trendingTags.map((tag) => <button key={tag.name} onClick={() => onSearch(tag.name)}>#{tag.name}<small>{tag.count}</small></button>)}
          </div>
        </section>

        <section className="rail-section active-section">
          <div className="rail-title"><span><Users size={16} />本周活跃同学</span></div>
          <div className="active-students">
            {pulse?.activeStudents.map((student) => (
              <button key={student.id} onClick={() => navigate(`/user/${student.id}`)}><span className="avatar">{student.avatar}</span><span><strong>{student.nickname}</strong><small>{student.roleLabel}</small></span><em>{student.contribution} 贡献</em></button>
            ))}
          </div>
        </section>

        <div className="rail-safety"><Sparkles size={15} /><span>友善表达，保护隐私。遇到不适内容请及时举报。</span></div>
      </aside>
    </div>
  )
}
