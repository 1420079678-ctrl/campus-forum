import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight, Bike, CalendarDays, CheckCircle2, Clock3, Flame, Heart, MapPin,
  MessageCircle, PackageOpen, Plus, Search, ShieldCheck, ShoppingBag, Sparkles, Users,
} from 'lucide-react'
import { api } from '../api'
import type { ComposerPreset } from '../components/Composer'
import PostCard from '../components/PostCard'
import type { Me, Post, PostPage } from '../types'

type SceneId = 'all' | 'market' | 'errand' | 'lost' | 'buddy' | 'events' | 'pets'

const SCENES: Array<{
  id: SceneId
  label: string
  subtitle: string
  icon: typeof Search
  tone: string
  board?: string
  query?: string
  preset: ComposerPreset
}> = [
  { id: 'all', label: '校园广场', subtitle: '今天嘉大有什么新鲜事', icon: Sparkles, tone: 'mint', preset: { board: '校园生活', tags: ['校园生活'], titlePlaceholder: '分享一件正在嘉大发生的事' } },
  { id: 'market', label: '闲置集市', subtitle: '校内面交，少走弯路', icon: ShoppingBag, tone: 'sky', board: '闲置集市', preset: { board: '闲置集市', tags: ['二手', '校内自取'], titlePlaceholder: '出什么？状态和价格写清楚更快成交', bodyPlaceholder: '写明物品状态、购入时间、期望价格和方便面交的校区位置…' } },
  { id: 'errand', label: '跑腿互助', subtitle: '顺路帮带，互相搭把手', icon: Bike, tone: 'orange', query: '跑腿', preset: { board: '校园生活', tags: ['跑腿', '互助'], titlePlaceholder: '需要同学顺路帮你做什么？', bodyPlaceholder: '写明时间、地点、具体事项和是否有感谢费，不要公开手机号…' } },
  { id: 'lost', label: '失物招领', subtitle: '让遗失早点回到身边', icon: Search, tone: 'yellow', query: '失物', preset: { board: '校园生活', tags: ['失物招领'], titlePlaceholder: '捡到了什么，或在哪里遗失？', bodyPlaceholder: '写明时间、地点和可核验的特征；证件号码等隐私请打码…' } },
  { id: 'buddy', label: '搭子广场', subtitle: '学习、运动、吃饭都同频', icon: Users, tone: 'purple', query: '搭子', preset: { board: '社团活动', tags: ['搭子'], titlePlaceholder: '找什么搭子？时间地点先说清楚', bodyPlaceholder: '介绍你的计划、频率和期待，第一次见面建议选择校园公共场所…' } },
  { id: 'events', label: '活动日历', subtitle: '社团、比赛和校园现场', icon: CalendarDays, tone: 'pink', board: '社团活动', preset: { board: '社团活动', tags: ['校园活动'], titlePlaceholder: '发布一个值得参加的校园活动', bodyPlaceholder: '写明时间、地点、人数、报名方式和是否需要准备材料…' } },
  { id: 'pets', label: '校园萌宠', subtitle: '文明观察，不追逐投喂', icon: Heart, tone: 'coral', query: '宠物', preset: { board: '校园生活', tags: ['宠物', '校园猫'], titlePlaceholder: '记录一位校园毛茸茸朋友', bodyPlaceholder: '写明观察地点和状态，避免公开敏感位置，不追逐、不擅自抓捕或投喂…' } },
]

const CAMPUS_TAGS = ['二手', '跑腿', '失物', '招领', '搭子', '活动', '社团', '比赛', '拼车', '宠物']

export default function CampusView({ user, refreshKey, onCompose, navigate, notify, requireAuth, onReport }: {
  user: Me | null
  refreshKey: number
  onCompose: (preset: ComposerPreset) => void
  navigate: (path: string) => void
  notify: (message: string) => void
  requireAuth: () => boolean
  onReport: (post: Post) => void
}) {
  const [scene, setScene] = useState<SceneId>('all')
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)

  const active = SCENES.find((item) => item.id === scene) ?? SCENES[0]
  const season = useMemo(() => {
    const month = new Date().getMonth() + 1
    if (month === 7 || month === 8) return '暑期留校模式'
    if (month === 9) return '开学季'
    if (month === 12 || month === 1) return '期末季'
    if (month >= 3 && month <= 5) return '春日校园'
    return '嘉大进行时'
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ sort: 'latest', page: '1', pageSize: scene === 'all' ? '30' : '12' })
    if (active.board) params.set('board', active.board)
    if (active.query) params.set('q', active.query)
    api<PostPage>(`/api/posts?${params}`)
      .then((payload) => {
        if (cancelled) return
        const items = scene === 'all'
          ? payload.items.filter((post) => post.board === '闲置集市' || post.board === '社团活动' || post.tags.some((tag) => CAMPUS_TAGS.some((keyword) => tag.includes(keyword))))
          : payload.items
        setPosts(items)
      })
      .catch((err) => !cancelled && notify(err instanceof Error ? err.message : '校园内容加载失败'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [active.board, active.query, scene, refreshKey, user?.id, notify])

  const toggleLike = async (post: Post) => {
    if (!requireAuth()) return
    const before = posts
    setPosts((items) => items.map((item) => item.id === post.id ? { ...item, liked: !item.liked, likeCount: item.likeCount + (item.liked ? -1 : 1) } : item))
    try { await api(`/api/posts/${post.id}/like`, { method: 'POST' }) }
    catch (err) { setPosts(before); notify(err instanceof Error ? err.message : '操作失败') }
  }

  const toggleFavorite = async (post: Post) => {
    if (!requireAuth()) return
    const before = posts
    setPosts((items) => items.map((item) => item.id === post.id ? { ...item, favorited: !item.favorited } : item))
    try {
      await api(`/api/posts/${post.id}/favorite`, { method: 'POST' })
      notify(post.favorited ? '已取消收藏' : '已收藏，之后可以在个人主页找到')
    } catch (err) { setPosts(before); notify(err instanceof Error ? err.message : '操作失败') }
  }

  return (
    <div className="campus-page">
      <section className="campus-page-hero">
        <div className="campus-hero-copy">
          <span><MapPin size={14} />嘉兴大学 · {season}</span>
          <h1>校园生活，不只是一条信息流。</h1>
          <p>闲置、跑腿、失物、搭子和活动，都能在校内完成闭环。</p>
          <div className="campus-trust-row">
            <b><CheckCircle2 size={14} />公开浏览</b>
            <b><ShieldCheck size={14} />认证互动</b>
            <b><MessageCircle size={14} />站内私信</b>
          </div>
        </div>
        <div className="campus-orbit" aria-hidden="true">
          <span className="orbit-center">嘉</span>
          <i className="orbit-one">📦</i><i className="orbit-two">🏸</i><i className="orbit-three">🎫</i>
        </div>
      </section>

      <section className="scene-grid" aria-label="校园场景">
        {SCENES.map((item) => {
          const Icon = item.icon
          return (
            <button key={item.id} aria-pressed={scene === item.id} className={`scene-card ${item.tone} ${scene === item.id ? 'active' : ''}`} onClick={() => setScene(item.id)}>
              <span><Icon size={20} /></span>
              <strong>{item.label}</strong>
              <small>{item.subtitle}</small>
              <ArrowRight size={15} />
            </button>
          )
        })}
      </section>

      <div className="campus-content-grid">
        <section className="campus-scene-feed">
          <header className="campus-scene-head">
            <div><span>LIVE ON CAMPUS</span><h2>{active.label}</h2><p>{active.subtitle}</p></div>
            <button className="primary-button" onClick={() => onCompose(active.preset)}><Plus size={16} />发布{active.id === 'all' ? '校园动态' : active.label}</button>
          </header>
          <div className="feed-list campus-post-list">
            {loading && [0, 1, 2].map((item) => <div className="post-skeleton" key={item}><i /><div><b /><span /><span /></div></div>)}
            {!loading && posts.map((post) => (
              <PostCard key={post.id} post={post} onOpen={(id) => navigate(`/post/${id}`)} onLike={toggleLike} onFavorite={toggleFavorite} onReport={(target) => requireAuth() && onReport(target)} onAuthor={(id) => navigate(`/user/${id}`)} />
            ))}
            {!loading && posts.length === 0 && (
              <div className="empty-state campus-empty"><active.icon size={26} /><h3>这里还等第一位同学</h3><p>真实、具体地说清楚需求，更容易遇见愿意回应的人。</p><button className="primary-button" onClick={() => onCompose(active.preset)}>发布第一条</button></div>
            )}
          </div>
        </section>

        <aside className="campus-side-notes">
          <section className="campus-checklist">
            <span><Flame size={15} />本周嘉大清单</span>
            <button onClick={() => setScene('lost')}><i>01</i><b>看看失物招领</b><ArrowRight size={14} /></button>
            <button onClick={() => setScene('buddy')}><i>02</i><b>找个运动搭子</b><ArrowRight size={14} /></button>
            <button onClick={() => setScene('events')}><i>03</i><b>安排一场活动</b><ArrowRight size={14} /></button>
          </section>
          <section className="campus-safety-card">
            <ShieldCheck size={20} />
            <div><strong>校内交易安全提醒</strong><p>不提前转账，不公开手机号；优先校园公共区域面交，沟通留在站内。</p></div>
          </section>
          <section className="campus-time-card"><Clock3 size={18} /><div><strong>24 小时持续更新</strong><span>按最新时间展示，过期信息及时关闭或补充状态。</span></div></section>
          <section className="campus-data-note"><PackageOpen size={18} /><p>不展示虚构成交量；开发期冷启动内容不会冒充正式运营数据。</p></section>
        </aside>
      </div>
    </div>
  )
}
