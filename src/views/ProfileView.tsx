import { useEffect, useState } from 'react'
import {
  Bookmark, CheckCircle2, ChevronRight, Eye, Heart, KeyRound, LockKeyhole, LogOut,
  Mail, MessageCircle, PenLine, ShieldCheck, Trash2, UserRound, X,
} from 'lucide-react'
import { api } from '../api'
import { timeAgo } from '../format'
import type { Me, MyStats, Post, PostPage } from '../types'
import { avatarStyle } from '../avatar'

const statusLabel: Record<string, string> = { visible: '', pending: '待复核', hidden: '已隐藏' }
const PROFILE_AVATARS = ['🌿', '🎧', '📚', '🏸', '📷', '☕', '🐱', '🪐', '🎨', '🛼', '🌻', '🧩']

export default function ProfileView({ user, stats, notify, requireAuth, navigate, onLogout, onUserUpdated }: {
  user: Me | null
  stats: MyStats | null
  notify: (message: string) => void
  requireAuth: () => boolean
  navigate: (path: string) => void
  onLogout: () => void
  onUserUpdated: (user: Me) => void
}) {
  const [tab, setTab] = useState<'posts' | 'favorites'>('posts')
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState(user?.nickname ?? '')
  const [avatar, setAvatar] = useState(user?.avatar ?? '🌿')
  const [grade, setGrade] = useState(user?.grade ?? '')
  const [dept, setDept] = useState(user?.dept ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [busy, setBusy] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [verifyEmail, setVerifyEmail] = useState(user?.email ?? '')
  const [verifyCode, setVerifyCode] = useState('')
  const [devCode, setDevCode] = useState('')
  const [verifyBusy, setVerifyBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    api<PostPage>(`/api/posts?${tab === 'posts' ? 'mine=1' : 'favorites=1'}&sort=latest&pageSize=50`)
      .then((payload) => !cancelled && setPosts(payload.items))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [user, tab])

  useEffect(() => {
    setNickname(user?.nickname ?? '')
    setAvatar(user?.avatar ?? '🌿')
    setGrade(user?.grade ?? '')
    setDept(user?.dept ?? '')
    setBio(user?.bio ?? '')
  }, [user])

  if (!user) {
    return (
      <div className="page-view">
        <div className="empty-state">
          <UserRound size={26} />
          <h3>登录后查看你的个人空间</h3>
          <p>发帖记录、收藏、关注和社区贡献都会在这里沉淀。</p>
          <button className="primary-button" onClick={() => requireAuth()}>登录 / 注册</button>
        </div>
      </div>
    )
  }

  const saveProfile = async () => {
    if (busy) return
    setBusy(true)
    try {
      const payload = await api<{ user: Me }>('/api/me', { method: 'PATCH', body: { nickname, avatar, grade, dept, bio } })
      onUserUpdated(payload.user)
      setEditing(false)
      notify('资料已更新')
    } catch (err) {
      notify(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const changePassword = async () => {
    if (pwBusy) return
    if (newPassword !== newPassword2) {
      notify('两次输入的新密码不一致')
      return
    }
    setPwBusy(true)
    try {
      await api('/api/me/password', { method: 'POST', body: { oldPassword, newPassword } })
      setPwOpen(false)
      setOldPassword('')
      setNewPassword('')
      setNewPassword2('')
      notify('密码已修改，其他设备已自动退出登录')
    } catch (err) {
      notify(err instanceof Error ? err.message : '修改失败')
    } finally {
      setPwBusy(false)
    }
  }

  const requestVerification = async () => {
    if (!verifyEmail.trim() || verifyBusy) return
    setVerifyBusy(true)
    try {
      const payload = await api<{ data: { email: string; devCode?: string } }>('/api/verification/request', { method: 'POST', body: { email: verifyEmail } })
      setVerifyEmail(payload.data.email)
      setDevCode(payload.data.devCode ?? '')
      notify(payload.data.devCode ? '演示验证码已生成，可直接填写' : '验证码已发送到校园邮箱')
    } catch (err) {
      notify(err instanceof Error ? err.message : '验证码发送失败')
    } finally {
      setVerifyBusy(false)
    }
  }

  const confirmVerification = async () => {
    if (!/^\d{6}$/.test(verifyCode) || verifyBusy) return
    setVerifyBusy(true)
    try {
      const payload = await api<{ data: { verified: boolean; email: string; campus: string } }>('/api/verification/confirm', { method: 'POST', body: { code: verifyCode } })
      onUserUpdated({ ...user, verified: true, verificationStatus: 'verified', email: payload.data.email, campus: payload.data.campus })
      setVerifyCode('')
      setDevCode('')
      notify('校园身份验证完成，社区互动权限已开启')
    } catch (err) {
      notify(err instanceof Error ? err.message : '验证失败')
    } finally {
      setVerifyBusy(false)
    }
  }

  const deletePost = async (post: Post) => {
    if (!window.confirm(`确定删除《${post.title}》吗？`)) return
    try {
      await api(`/api/posts/${post.id}`, { method: 'DELETE' })
      setPosts((items) => items.filter((item) => item.id !== post.id))
      notify('帖子已删除')
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <div className="page-view">
      <div className="profile-hero">
        <div className="avatar profile-avatar" style={avatarStyle(user.id)}>{user.avatar}</div>
        <div>
          <span className="verified-label"><ShieldCheck size={14} />{user.verified ? '已验证成员' : '未验证'} · {user.roleLabel}</span>
          <h1>{user.nickname}</h1>
          <p>{[user.grade, user.dept].filter(Boolean).join(' · ') || '资料待完善'} · 加入嘉大圈 {stats?.joinedDays ?? 0} 天</p>
          {user.bio && <p className="profile-bio">{user.bio}</p>}
        </div>
        <div className="profile-hero-actions">
          <button className="ghost-button" onClick={() => setEditing((value) => !value)}>{editing ? <><X size={15} />取消编辑</> : <><PenLine size={15} />编辑资料</>}</button>
          <button className="ghost-button logout" onClick={onLogout}><LogOut size={15} />退出登录</button>
        </div>
      </div>

      {editing && (
        <div className="profile-panel edit-panel">
          <span className="section-kicker">EDIT PROFILE</span>
          <div className="avatar-picker">
            <strong>选择你的校园头像</strong>
            <div>{PROFILE_AVATARS.map((item, index) => <button type="button" key={item} aria-label={`选择头像 ${item}`} aria-pressed={avatar === item} className={avatar === item ? 'selected' : ''} style={avatarStyle(index)} onClick={() => setAvatar(item)}>{item}</button>)}</div>
          </div>
          <div className="edit-grid">
            <label>昵称<input value={nickname} maxLength={16} onChange={(event) => setNickname(event.target.value)} /></label>
            <label>年级<input value={grade} maxLength={10} onChange={(event) => setGrade(event.target.value)} placeholder="如：大二" /></label>
            <label>学院<input value={dept} maxLength={20} onChange={(event) => setDept(event.target.value)} placeholder="如：经济学院" /></label>
          </div>
          <label>个人简介<textarea value={bio} maxLength={120} rows={2} onChange={(event) => setBio(event.target.value)} placeholder="一句话介绍自己" /></label>
          <div className="modal-actions">
            <button className="primary-button" disabled={busy || nickname.trim().length < 2} onClick={saveProfile}>{busy ? '保存中…' : '保存资料'}</button>
          </div>
        </div>
      )}

      <div className="profile-grid">
        <div className="profile-panel">
          <span className="section-kicker">COMMUNITY IMPACT</span>
          <h2>我的社区贡献</h2>
          <div className="impact-row">
            <div><strong>{stats?.likesReceived ?? 0}</strong><span>获得赞同</span></div>
            <div><strong>{stats?.helped ?? 0}</strong><span>帮助过同学</span></div>
            <div><strong>{stats?.posts ?? 0}</strong><span>发起讨论</span></div>
          </div>
          <div className="impact-row secondary">
            <div><strong>{stats?.comments ?? 0}</strong><span>参与回复</span></div>
            <div><strong>{stats?.favorites ?? 0}</strong><span>收藏内容</span></div>
            <div><strong>{stats?.followers ?? 0}</strong><span>关注我的</span></div>
          </div>
        </div>
        <div className="profile-panel security-panel">
          <div className="panel-heading"><span className="section-kicker">IDENTITY &amp; SAFETY</span><LockKeyhole size={17} /></div>
          <h2>身份与安全</h2>
          <p>你的真实身份只用于社区安全验证，前台展示昵称。匿名内容的实名信息仅审核人员可见。</p>
          <div className={`security-row ${user.verified ? '' : 'pending'}`}>
            {user.verified ? <CheckCircle2 size={16} /> : <Mail size={16} />}
            <span>{user.verified ? '校园身份已验证' : '校园身份待验证'}</span>
            <small>{user.verified ? (user.email || user.username) : '验证后可发帖、评论与私信'}</small>
          </div>
          <div className="security-row"><CheckCircle2 size={16} /><span>账号角色</span><small>{user.roleLabel}</small></div>
          <div className="security-row"><CheckCircle2 size={16} /><span>发言与回复权限</span><small>实名制 · 已开启</small></div>
          <div className="security-row password-row">
            <KeyRound size={16} />
            <span>登录密码</span>
            <button className="link-button" onClick={() => setPwOpen((value) => !value)}>{pwOpen ? '收起' : '修改密码'}</button>
          </div>
          {!user.verified && (
            <div className="verification-form">
              <label>校园邮箱<input type="email" value={verifyEmail} onChange={(event) => setVerifyEmail(event.target.value)} placeholder="学号@学校邮箱域名" /></label>
              <button className="ghost-button" disabled={verifyBusy || !verifyEmail.trim()} onClick={requestVerification}>{verifyBusy ? '发送中…' : '获取验证码'}</button>
              <label>验证码<input inputMode="numeric" value={verifyCode} maxLength={6} onChange={(event) => setVerifyCode(event.target.value.replace(/\D/g, ''))} placeholder="6 位验证码" /></label>
              <button className="primary-button" disabled={verifyBusy || !/^\d{6}$/.test(verifyCode)} onClick={confirmVerification}>完成验证</button>
              {devCode && <button className="dev-code" onClick={() => setVerifyCode(devCode)}>演示环境验证码：<strong>{devCode}</strong>（点击填入）</button>}
            </div>
          )}
          {pwOpen && (
            <div className="pw-form">
              <input type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} placeholder="原密码" autoComplete="current-password" />
              <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="新密码（至少 8 位）" autoComplete="new-password" />
              <input type="password" value={newPassword2} onChange={(event) => setNewPassword2(event.target.value)} placeholder="再输入一次新密码" autoComplete="new-password" />
              <button
                className="primary-button"
                disabled={pwBusy || oldPassword.length === 0 || newPassword.length < 8}
                onClick={changePassword}
              >{pwBusy ? '提交中…' : '确认修改'}</button>
            </div>
          )}
        </div>
      </div>

      <div className="section-heading compact profile-list-heading">
        <div>
          <span className="section-kicker">MY CONTENT</span>
          <div className="profile-tabs">
            <button className={tab === 'posts' ? 'active' : ''} onClick={() => setTab('posts')}><PenLine size={14} />我的帖子</button>
            <button className={tab === 'favorites' ? 'active' : ''} onClick={() => setTab('favorites')}><Bookmark size={14} />我的收藏</button>
          </div>
        </div>
      </div>
      <div className="profile-post-list">
        {loading && <div className="empty-state small loading-state">加载中…</div>}
        {!loading && posts.length === 0 && (
          <div className="empty-state small"><p>{tab === 'posts' ? '还没有发过帖子，去社区发起第一场讨论吧。' : '还没有收藏内容。'}</p></div>
        )}
        {!loading && posts.map((post) => (
          <div className="profile-post-row" key={post.id}>
            <button className="profile-post-main" onClick={() => navigate(`/post/${post.id}`)}>
              <strong>
                {post.title}
                {post.status !== 'visible' && <span className={`mini-badge ${post.status === 'pending' ? 'warn' : 'danger'}`}>{statusLabel[post.status]}</span>}
              </strong>
              <span>{post.board} · {timeAgo(post.createdAt)}</span>
            </button>
            <span className="profile-post-stats">
              <span><Heart size={13} />{post.likeCount}</span>
              <span><MessageCircle size={13} />{post.commentCount}</span>
              <span><Eye size={13} />{post.viewCount}</span>
            </span>
            {tab === 'posts'
              ? <button className="icon-button" onClick={() => deletePost(post)} aria-label="删除"><Trash2 size={15} /></button>
              : <ChevronRight size={16} className="row-chevron" />}
          </div>
        ))}
      </div>
    </div>
  )
}
