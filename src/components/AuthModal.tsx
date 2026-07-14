import { useState } from 'react'
import { KeyRound, LockKeyhole, ShieldCheck, UserRound, X } from 'lucide-react'
import { api, setToken } from '../api'
import type { Me } from '../types'

type AuthPayload = { token: string; user: Me }

const demoAccounts = [
  { username: 'demo', password: 'demo123456', label: '学生 · 知行同学' },
  { username: 'mod', password: 'demo123456', label: '审核员' },
  { username: 'houqin', password: 'demo123456', label: '后勤服务中心' },
  { username: 'admin', password: 'admin123456', label: '管理员' },
]

export default function AuthModal({ onClose, onAuthed }: { onClose: () => void; onAuthed: (user: Me) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [grade, setGrade] = useState('大一')
  const [dept, setDept] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const payload = mode === 'login'
        ? await api<AuthPayload>('/api/auth/login', { method: 'POST', body: { username, password } })
        : await api<AuthPayload>('/api/auth/register', { method: 'POST', body: { username, password, nickname, grade, dept } })
      setToken(payload.token)
      onAuthed(payload.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="composer-modal auth-modal">
        <div className="modal-head">
          <div>
            <span className="section-kicker">{mode === 'login' ? 'WELCOME BACK' : 'JOIN THE COMMONS'}</span>
            <h2>{mode === 'login' ? '欢迎回到知行里' : '加入知行里'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </div>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>登录</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>注册</button>
        </div>
        <label>用户名（学号）
          <div className="input-icon"><UserRound size={15} /><input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="3-20 位字母、数字或下划线" /></div>
        </label>
        <label>密码
          <div className="input-icon"><KeyRound size={15} /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? '至少 8 位' : '请输入密码'} onKeyDown={(e) => e.key === 'Enter' && submit()} /></div>
        </label>
        {mode === 'register' && (
          <>
            <label>昵称（前台展示）
              <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="2-16 个字符" />
            </label>
            <div className="field-row">
              <label>年级
                <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                  {['大一', '大二', '大三', '大四', '研一', '研二', '研三', '博士'].map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>学院
                <input value={dept} onChange={(e) => setDept(e.target.value)} placeholder="如：计算机学院" />
              </label>
            </div>
          </>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="composer-note">
          <ShieldCheck size={16} />
          <span>{mode === 'register' ? '注册即视为完成校园身份验证（演示环境）。实名信息仅用于安全验证，前台展示昵称。' : '演示账号一键填入：'}
            {mode === 'login' && (
              <span className="demo-accounts">
                {demoAccounts.map((account) => (
                  <button key={account.username} onClick={() => { setUsername(account.username); setPassword(account.password) }}>{account.label}</button>
                ))}
              </span>
            )}
          </span>
        </div>
        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={busy || !username || !password || (mode === 'register' && !nickname)} onClick={submit}>
            <LockKeyhole size={15} />{busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </div>
      </div>
    </div>
  )
}
