import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell, CheckCircle2, ChevronRight, ClipboardList, Home, LockKeyhole, LogIn,
  Menu, Search, Settings2, ShieldCheck, Sparkles, UserRound,
} from 'lucide-react'
import './App.css'
import { api, hasToken, setToken } from './api'
import { boardIcon } from './boardMeta'
import { formatCount } from './format'
import AuthModal from './components/AuthModal'
import Composer from './components/Composer'
import ReportModal, { type ReportTargetInput } from './components/ReportModal'
import NotificationsPanel from './components/NotificationsPanel'
import HomeView from './views/HomeView'
import PostDetailView from './views/PostDetailView'
import NeedsView from './views/NeedsView'
import ModerationView from './views/ModerationView'
import ProfileView from './views/ProfileView'
import UserView from './views/UserView'
import AdminView from './views/AdminView'
import type { Board, CommentItem, Me, MyStats, Post } from './types'

type Route =
  | { tab: 'home' }
  | { tab: 'post'; id: number }
  | { tab: 'user'; id: number }
  | { tab: 'needs' }
  | { tab: 'moderation' }
  | { tab: 'admin' }
  | { tab: 'profile' }

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const postMatch = path.match(/^\/post\/(\d+)/)
  if (postMatch) return { tab: 'post', id: Number(postMatch[1]) }
  const userMatch = path.match(/^\/user\/(\d+)/)
  if (userMatch) return { tab: 'user', id: Number(userMatch[1]) }
  if (path.startsWith('/needs')) return { tab: 'needs' }
  if (path.startsWith('/moderation')) return { tab: 'moderation' }
  if (path.startsWith('/admin')) return { tab: 'admin' }
  if (path.startsWith('/profile')) return { tab: 'profile' }
  return { tab: 'home' }
}

function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [user, setUser] = useState<Me | null>(null)
  const [myStats, setMyStats] = useState<MyStats | null>(null)
  const [boards, setBoards] = useState<Board[]>([])
  const [activeBoard, setActiveBoard] = useState('全部')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [reportTarget, setReportTarget] = useState<ReportTargetInput | null>(null)
  const [unread, setUnread] = useState(0)
  const [modPending, setModPending] = useState(0)
  const [feedRefresh, setFeedRefresh] = useState(0)
  const toastTimer = useRef<number>(0)
  const searchRef = useRef<HTMLInputElement>(null)

  const notify = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2600)
  }, [])

  const navigate = useCallback((path: string) => {
    window.location.hash = path
    setMenuOpen(false)
    window.scrollTo({ top: 0 })
  }, [])

  const requireAuth = useCallback(() => {
    if (user) return true
    setAuthOpen(true)
    return false
  }, [user])

  const loadMe = useCallback(() => {
    if (!hasToken()) return
    api<{ user: Me; stats: MyStats }>('/api/me')
      .then((payload) => {
        setUser(payload.user)
        setMyStats(payload.stats)
      })
      .catch(() => {
        setToken(null)
        setUser(null)
        setMyStats(null)
      })
  }, [])

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const loadBoards = useCallback(() => {
    api<{ data: Board[] }>('/api/boards').then((payload) => setBoards(payload.data)).catch(() => undefined)
  }, [])

  useEffect(() => {
    loadBoards()
    loadMe()
  }, [loadBoards, loadMe])

  useEffect(() => {
    if (!user) {
      setUnread(0)
      setModPending(0)
      return
    }
    const refreshUnread = () => {
      api<{ data: { unread: number } }>('/api/notifications')
        .then((payload) => setUnread(payload.data.unread))
        .catch(() => undefined)
    }
    refreshUnread()
    const timer = window.setInterval(refreshUnread, 60000)
    if (user.role === 'moderator' || user.role === 'admin') {
      api<{ data: { metrics: { pending: number } } }>('/api/moderation/overview')
        .then((payload) => setModPending(payload.data.metrics.pending))
        .catch(() => undefined)
    }
    return () => window.clearInterval(timer)
  }, [user, feedRefresh])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (route.tab !== 'home') navigate('/')
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route.tab, navigate])

  const boardNames = useMemo(() => boards.map((board) => board.name), [boards])
  const canModerate = user && (user.role === 'moderator' || user.role === 'admin')
  const isAdmin = user?.role === 'admin'

  const handleLogout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    setToken(null)
    setUser(null)
    setMyStats(null)
    navigate('/')
    notify('已退出登录，欢迎再来')
  }

  const openComposer = () => {
    if (!requireAuth()) return
    setComposerOpen(true)
  }

  const handleReportPost = (post: Post) => setReportTarget({ type: 'post', id: post.id, title: `《${post.title}》` })
  const handleReportComment = (comment: CommentItem) => setReportTarget({ type: 'comment', id: comment.id, title: `${comment.author.nickname}：「${comment.body.slice(0, 40)}」` })

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" onClick={() => navigate('/')} role="button" tabIndex={0}>
          <div className="brand-mark"><Sparkles size={17} strokeWidth={2.4} /></div>
          <div><strong>知行里</strong><span>Campus Commons</span></div>
        </div>
        <div className="top-search">
          <Search size={17} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              if (route.tab !== 'home') navigate('/')
            }}
            placeholder="搜索帖子、板块或标签"
          />
          <kbd>⌘ K</kbd>
        </div>
        <div className="top-actions">
          {user && (
            <button className="icon-button notification" onClick={() => setNotifOpen((value) => !value)} aria-label="通知">
              <Bell size={19} />
              {unread > 0 && <i />}
            </button>
          )}
          {user ? (
            <button className="profile-chip" onClick={() => navigate('/profile')}>
              <span className="avatar small">{user.avatar}</span>
              <span className="profile-name">{user.nickname}</span>
              <ChevronRight size={15} />
            </button>
          ) : (
            <button className="primary-button login-button" onClick={() => setAuthOpen(true)}><LogIn size={15} />登录 / 注册</button>
          )}
          <button className="mobile-menu" onClick={() => setMenuOpen((value) => !value)} aria-label="菜单"><Menu size={20} /></button>
        </div>
      </header>

      <div className="app-body">
        <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
          {user ? (
            <div className="verify-card">
              <div className="verify-icon"><ShieldCheck size={18} /></div>
              <div><strong>{user.verified ? '已完成实名验证' : '待完成验证'}</strong><span>{user.roleLabel}</span></div>
              <CheckCircle2 size={16} className="verify-check" />
            </div>
          ) : (
            <button className="verify-card guest" onClick={() => setAuthOpen(true)}>
              <div className="verify-icon"><LockKeyhole size={18} /></div>
              <div><strong>尚未登录</strong><span>登录后解锁发帖与互动</span></div>
              <ChevronRight size={16} className="verify-check" />
            </button>
          )}
          <nav className="main-nav">
            <NavItem icon={Home} label="社区首页" active={route.tab === 'home' || route.tab === 'post' || route.tab === 'user'} onClick={() => navigate('/')} />
            <NavItem icon={ClipboardList} label="诉求墙" active={route.tab === 'needs'} onClick={() => navigate('/needs')} />
            {canModerate && <NavItem icon={ShieldCheck} label="内容审核台" active={route.tab === 'moderation'} badge={modPending > 0 ? String(modPending) : undefined} onClick={() => navigate('/moderation')} />}
            {isAdmin && <NavItem icon={Settings2} label="管理后台" active={route.tab === 'admin'} onClick={() => navigate('/admin')} />}
            <NavItem icon={UserRound} label="个人空间" active={route.tab === 'profile'} badge={unread > 0 ? String(unread) : undefined} onClick={() => navigate('/profile')} />
          </nav>
          <div className="sidebar-label">板块</div>
          <div className="board-list">
            {boards.map((board) => {
              const Icon = boardIcon(board.icon)
              return (
                <button
                  key={board.id}
                  className={`board-link ${activeBoard === board.name && route.tab === 'home' ? 'selected' : ''}`}
                  onClick={() => { setActiveBoard(board.name); navigate('/') }}
                >
                  <span className={`board-dot ${board.color}`}><Icon size={15} /></span>
                  <span>{board.name}</span>
                  <small>{formatCount(board.postCount)}</small>
                </button>
              )
            })}
          </div>
          <div className="sidebar-footer">
            <div className="safe-note"><LockKeyhole size={15} /><span>社区安全守则</span><ChevronRight size={14} /></div>
            <p>实名发言 · 前台可匿名<br />每一次表达都值得被尊重</p>
          </div>
        </aside>

        <main className="main-content">
          {route.tab === 'home' && (
            <HomeView
              user={user}
              boards={boardNames}
              activeBoard={activeBoard}
              setActiveBoard={setActiveBoard}
              query={query}
              refreshKey={feedRefresh}
              onCompose={openComposer}
              navigate={navigate}
              notify={notify}
              requireAuth={requireAuth}
              onReport={handleReportPost}
            />
          )}
          {route.tab === 'post' && (
            <PostDetailView
              id={route.id}
              user={user}
              boards={boards}
              navigate={navigate}
              notify={notify}
              requireAuth={requireAuth}
              onReport={handleReportPost}
              onReportComment={handleReportComment}
              onDeleted={() => { setFeedRefresh((value) => value + 1); navigate('/') }}
              onChanged={() => setFeedRefresh((value) => value + 1)}
            />
          )}
          {route.tab === 'user' && (
            <UserView
              id={route.id}
              user={user}
              navigate={navigate}
              notify={notify}
              requireAuth={requireAuth}
              onReport={handleReportPost}
            />
          )}
          {route.tab === 'needs' && <NeedsView user={user} notify={notify} requireAuth={requireAuth} />}
          {route.tab === 'moderation' && (
            <ModerationView user={user} notify={notify} requireAuth={requireAuth} navigate={navigate} onPendingChange={setModPending} />
          )}
          {route.tab === 'admin' && (
            <AdminView user={user} notify={notify} requireAuth={requireAuth} navigate={navigate} onBoardsChanged={loadBoards} />
          )}
          {route.tab === 'profile' && (
            <ProfileView
              user={user}
              stats={myStats}
              notify={notify}
              requireAuth={requireAuth}
              navigate={navigate}
              onLogout={handleLogout}
              onUserUpdated={(updated) => { setUser(updated); loadMe() }}
            />
          )}
        </main>
      </div>

      {authOpen && (
        <AuthModal
          onClose={() => setAuthOpen(false)}
          onAuthed={(authedUser) => {
            setAuthOpen(false)
            setUser(authedUser)
            loadMe()
            setFeedRefresh((value) => value + 1)
            notify(`欢迎回来，${authedUser.nickname}`)
          }}
        />
      )}
      {composerOpen && (
        <Composer
          boards={boards}
          onClose={() => setComposerOpen(false)}
          onPublished={(post, moderation) => {
            setComposerOpen(false)
            setFeedRefresh((value) => value + 1)
            if (post.status === 'pending') {
              notify(`AI 判定为${moderation.risk === 'high' ? '高' : '中'}风险，帖子将在人工复核通过后公开`)
              navigate('/profile')
            } else {
              notify('发布成功')
              navigate(`/post/${post.id}`)
            }
          }}
        />
      )}
      {reportTarget && <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} notify={notify} />}
      {notifOpen && user && (
        <NotificationsPanel onClose={() => setNotifOpen(false)} navigate={navigate} onUnreadChange={setUnread} />
      )}
      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}
    </div>
  )
}

function NavItem({ icon: Icon, label, active, badge, onClick }: { icon: typeof Home; label: string; active?: boolean; badge?: string; onClick: () => void }) {
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      <Icon size={18} /><span>{label}</span>{badge && <b>{badge}</b>}
    </button>
  )
}

export default App
