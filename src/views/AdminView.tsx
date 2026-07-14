import { useEffect, useMemo, useState } from 'react'
import {
  Ban, CheckCircle2, LayoutGrid, LockKeyhole, Plus, RotateCcw, Search, Settings2, UserRound,
} from 'lucide-react'
import { api } from '../api'
import { boardIcon } from '../boardMeta'
import { timeAgo } from '../format'
import type { AdminUser, Board, Me } from '../types'
import { ROLE_LABEL } from '../types'

const BOARD_COLORS = ['coral', 'mint', 'gold', 'lavender', 'sky', 'rose']
const ACTIVE_ROLES: Me['role'][] = ['student', 'moderator', 'admin']

export default function AdminView({ user, notify, requireAuth, navigate, onBoardsChanged }: {
  user: Me | null
  notify: (message: string) => void
  requireAuth: () => boolean
  navigate: (path: string) => void
  onBoardsChanged: () => void
}) {
  const isAdmin = user?.role === 'admin'
  const [users, setUsers] = useState<AdminUser[]>([])
  const [boards, setBoards] = useState<Board[]>([])
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState(0)
  const [boardDraft, setBoardDraft] = useState<{ id?: number; name: string; description: string; color: string } | null>(null)
  const [boardBusy, setBoardBusy] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    api<{ data: AdminUser[] }>('/api/admin/users')
      .then((payload) => setUsers(payload.data))
      .catch((err) => notify(err instanceof Error ? err.message : '加载失败'))
    api<{ data: Board[] }>('/api/boards')
      .then((payload) => setBoards(payload.data))
      .catch(() => undefined)
  }, [isAdmin, notify])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((item) => item.username.toLowerCase().includes(q) || item.nickname.toLowerCase().includes(q))
  }, [users, query])

  if (!isAdmin) {
    return (
      <div className="page-view">
        <div className="empty-state">
          <LockKeyhole size={26} />
          <h3>管理后台仅对管理员开放</h3>
          <p>使用管理员账号登录后可以管理成员角色、封禁账号和调整板块。</p>
          {!user && <button className="primary-button" onClick={() => requireAuth()}>登录</button>}
        </div>
      </div>
    )
  }

  const patchUser = async (target: AdminUser, body: { role?: string; status?: string }, message: string) => {
    if (busyId) return
    setBusyId(target.id)
    try {
      const payload = await api<{ data: AdminUser }>(`/api/admin/users/${target.id}`, { method: 'PATCH', body })
      setUsers((items) => items.map((item) => item.id === target.id ? payload.data : item))
      notify(message)
    } catch (err) {
      notify(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusyId(0)
    }
  }

  const saveBoard = async () => {
    if (!boardDraft || boardBusy) return
    setBoardBusy(true)
    try {
      await (boardDraft.id
        ? api(`/api/admin/boards/${boardDraft.id}`, { method: 'PATCH', body: boardDraft })
        : api('/api/admin/boards', { method: 'POST', body: boardDraft }))
      const payload = await api<{ data: Board[] }>('/api/boards')
      setBoards(payload.data)
      setBoardDraft(null)
      onBoardsChanged()
      notify(boardDraft.id ? '板块已更新' : '板块已创建')
    } catch (err) {
      notify(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBoardBusy(false)
    }
  }

  return (
    <div className="page-view">
      <div className="page-header">
        <div>
          <span className="section-kicker">ADMIN CONSOLE</span>
          <h1>管理后台</h1>
          <p>成员、角色与板块的集中管理，每一次操作都会记入审计日志。</p>
        </div>
        <div className="ai-status"><Settings2 size={15} />仅管理员可见</div>
      </div>

      <div className="section-heading compact">
        <div><span className="section-kicker">MEMBERS</span><h2>成员管理（{users.length}）</h2></div>
        <div className="admin-search">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索用户名或昵称" />
        </div>
      </div>
      <div className="admin-user-list">
        {filtered.map((item) => (
          <div className={`admin-user-row ${item.status === 'banned' ? 'banned' : ''}`} key={item.id}>
            <span className="avatar small">{item.nickname.slice(0, 1)}</span>
            <div className="admin-user-main">
              <strong>
                <button className="author-link" onClick={() => navigate(`/user/${item.id}`)}>{item.nickname}</button>
                <small>@{item.username}</small>
                {item.status === 'banned' && <span className="mini-badge danger">已封禁</span>}
                {item.id === user.id && <span className="mini-badge">我</span>}
              </strong>
              <span>
                {[item.grade, item.dept].filter(Boolean).join(' · ') || '资料未填写'}
                · 帖子 {item.postCount} · 评论 {item.commentCount}
                · {item.lastLoginAt ? `最近登录 ${timeAgo(item.lastLoginAt)}` : '从未登录'}
              </span>
            </div>
            <select
              className="role-select"
              value={item.role}
              disabled={item.id === user.id || busyId === item.id}
              onChange={(event) => patchUser(item, { role: event.target.value }, `已将 ${item.nickname} 的角色调整为「${ROLE_LABEL[event.target.value as Me['role']]}」`)}
            >
              {ACTIVE_ROLES.map((value) => <option key={value} value={value}>{ROLE_LABEL[value]}</option>)}
            </select>
            {item.status === 'active' ? (
              <button
                className="ghost-button small danger-ghost"
                disabled={item.id === user.id || item.role === 'admin' || busyId === item.id}
                onClick={() => window.confirm(`确定封禁 ${item.nickname}（@${item.username}）吗？封禁后将立即退出登录且无法再登录。`)
                  && patchUser(item, { status: 'banned' }, `已封禁 ${item.nickname}`)}
              ><Ban size={13} />封禁</button>
            ) : (
              <button
                className="ghost-button small"
                disabled={busyId === item.id}
                onClick={() => patchUser(item, { status: 'active' }, `已解封 ${item.nickname}`)}
              ><RotateCcw size={13} />解封</button>
            )}
          </div>
        ))}
        {filtered.length === 0 && <div className="empty-state small"><UserRound size={20} /><p>没有匹配的成员</p></div>}
      </div>

      <div className="section-heading compact admin-board-heading">
        <div><span className="section-kicker">BOARDS</span><h2>板块管理（{boards.length}）</h2></div>
        <button className="ghost-button" onClick={() => setBoardDraft({ name: '', description: '', color: 'mint' })}><Plus size={14} />新建板块</button>
      </div>
      <div className="admin-board-list">
        {boards.map((board) => {
          const Icon = boardIcon(board.icon)
          return (
            <button className="admin-board-card" key={board.id} onClick={() => setBoardDraft({ id: board.id, name: board.name, description: board.description, color: board.color })}>
              <span className={`board-dot ${board.color}`}><Icon size={15} /></span>
              <div><strong>{board.name}</strong><span>{board.description || '暂无描述'}</span></div>
              <small>{board.postCount} 帖</small>
            </button>
          )
        })}
      </div>

      {boardDraft && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setBoardDraft(null)}>
          <div className="composer-modal board-modal">
            <div className="modal-head">
              <div>
                <span className="section-kicker">{boardDraft.id ? 'EDIT BOARD' : 'NEW BOARD'}</span>
                <h2>{boardDraft.id ? `编辑「${boardDraft.name || '板块'}」` : '新建板块'}</h2>
              </div>
              <button className="icon-button" onClick={() => setBoardDraft(null)} aria-label="关闭"><LayoutGrid size={18} /></button>
            </div>
            <label>板块名称（2-12 字）
              <input autoFocus value={boardDraft.name} maxLength={12} onChange={(event) => setBoardDraft({ ...boardDraft, name: event.target.value })} placeholder="如：失物招领" />
            </label>
            <label>一句话描述
              <input value={boardDraft.description} maxLength={60} onChange={(event) => setBoardDraft({ ...boardDraft, description: event.target.value })} placeholder="这个板块用来讨论什么" />
            </label>
            <label>主题色
              <div className="color-row">
                {BOARD_COLORS.map((color) => (
                  <button key={color} className={`color-swatch board-dot ${color} ${boardDraft.color === color ? 'selected' : ''}`} onClick={() => setBoardDraft({ ...boardDraft, color })}>
                    {boardDraft.color === color && <CheckCircle2 size={13} />}
                  </button>
                ))}
              </div>
            </label>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setBoardDraft(null)}>取消</button>
              <button className="primary-button" disabled={boardDraft.name.trim().length < 2 || boardBusy} onClick={saveBoard}>{boardBusy ? '保存中…' : boardDraft.id ? '保存修改' : '创建板块'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
