export function timeAgo(iso: string) {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return iso
  const diffMinutes = Math.floor((Date.now() - time) / 60000)
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays} 天前`
  const date = new Date(time)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return sameYear ? `${date.getMonth() + 1} 月 ${date.getDate()} 日` : `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`
}

export function formatCount(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}
