export type Author = {
  id?: number
  nickname: string
  avatar: string
  roleLabel: string
  anonymous: boolean
}

export type Me = {
  id: number
  username: string
  nickname: string
  role: 'student' | 'teacher' | 'staff' | 'moderator' | 'admin'
  dept: string
  grade: string
  bio: string
  verified: boolean
  campus: string
  email: string
  verificationStatus: 'unverified' | 'pending' | 'verified'
  roleLabel: string
  avatar: string
}

export type MyStats = {
  posts: number
  comments: number
  likesReceived: number
  helped: number
  favorites: number
  needs: number
  followers: number
  following: number
  unreadMessages: number
  joinedDays: number
}

export type Board = {
  id: number
  name: string
  description: string
  icon: string
  color: string
  postCount: number
}

export type Post = {
  id: number
  board: string
  boardId: number
  title: string
  body: string
  tags: string[]
  images: string[]
  status: 'visible' | 'pending' | 'hidden' | 'deleted'
  featured: boolean
  edited: boolean
  viewCount: number
  likeCount: number
  commentCount: number
  createdAt: string
  liked: boolean
  favorited: boolean
  author: Author
  realAuthor?: Author
  isOwn: boolean
  riskLevel?: 'low' | 'medium' | 'high'
  riskReasons?: string[]
}

export type PostPage = {
  items: Post[]
  total: number
  page: number
  pageSize: number
}

export type CommentItem = {
  id: number
  postId: number
  parentId: number | null
  body: string
  likeCount: number
  liked: boolean
  createdAt: string
  author: Author
  realAuthor?: Author
  isOwn: boolean
  replyTo?: string
}

export type NeedUpdate = {
  id: number
  status: string
  content: string
  by: string
  createdAt: string
}

export type Need = {
  id: number
  title: string
  body: string
  dept: string
  status: 'pending' | 'accepted' | 'progress' | 'resolved' | 'closed'
  createdAt: string
  updatedAt: string
  followerCount: number
  following: boolean
  updates: NeedUpdate[]
  author: Author
  realAuthor?: Author
  isOwn: boolean
}

export type NotificationItem = {
  id: number
  type: string
  targetType: string | null
  targetId: number | null
  content: string
  read: boolean
  createdAt: string
}

export type CommunityStats = {
  members: number
  weekDiscussions: number
  needResponseRate: number
  knowledgeCount: number
}

export type CommunityPulse = {
  campus: string
  onlineNow: number
  trendingTags: Array<{ name: string; count: number; rank: number }>
  hotPosts: Array<{ id: number; title: string; board: string; likeCount: number; commentCount: number; heat: number }>
  activeStudents: Array<{ id: number; nickname: string; avatar: string; roleLabel: string; contribution: number }>
}

export type ReportTarget = {
  id: number
  kind: 'post' | 'comment'
  title: string
  excerpt: string
  status: string
  author: string
  postId?: number
}

export type OpenReport = {
  id: number
  reason: string
  detail: string
  createdAt: string
  reporter: string
  target: ReportTarget
}

export type ModerationOverview = {
  pendingPosts: Post[]
  openReports: OpenReport[]
  metrics: {
    pending: number
    handledToday: number
    autoPassRate: number
  }
}

export type AuditLog = {
  id: number
  actorType: 'ai' | 'user'
  actor: string
  action: string
  targetType: string
  targetId: number | null
  reason: string
  createdAt: string
}

export type ModerationResult = {
  risk: 'low' | 'medium' | 'high'
  score: number
  reasons: string[]
}

export type PublicProfile = {
  id: number
  nickname: string
  avatar: string
  roleLabel: string
  bio: string
  campus: string
  verified: boolean
  following: boolean
  joinedDays: number
  createdAt: string
  stats: { posts: number; comments: number; likesReceived: number; followers: number; following: number }
}

export type DirectUser = {
  id: number
  nickname: string
  avatar: string
  roleLabel: string
}

export type DirectConversation = {
  id: number
  other: DirectUser
  lastMessage: string
  updatedAt: string
  unread: number
}

export type DirectMessage = {
  id: number
  senderId: number
  body: string
  createdAt: string
  readAt: string | null
}

export type DirectThread = {
  other: DirectUser
  messages: DirectMessage[]
}

export type AdminUser = {
  id: number
  username: string
  nickname: string
  role: Me['role']
  dept: string
  grade: string
  status: 'active' | 'banned'
  createdAt: string
  postCount: number
  commentCount: number
  lastLoginAt: string | null
}

export const ROLE_LABEL: Record<Me['role'], string> = {
  student: '学生',
  teacher: '教师',
  staff: '职能部门',
  moderator: '审核员',
  admin: '管理员',
}

export const NEED_STATUS: Record<Need['status'], { label: string; tone: string; percent: number }> = {
  pending: { label: '待回应', tone: 'pending', percent: 18 },
  accepted: { label: '已受理', tone: 'accepted', percent: 45 },
  progress: { label: '处理中', tone: 'progress', percent: 72 },
  resolved: { label: '已解决', tone: 'resolved', percent: 100 },
  closed: { label: '已关闭', tone: 'closed', percent: 100 },
}

export const RISK_LABEL: Record<string, string> = { low: '低风险', medium: '中风险', high: '高风险' }
