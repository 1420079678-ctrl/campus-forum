import { BookOpen, GraduationCap, Hash, Home, ShoppingBag, TrendingUp, Users } from 'lucide-react'

const icons: Record<string, typeof Hash> = { BookOpen, Home, TrendingUp, GraduationCap, ShoppingBag, Users }

export function boardIcon(name: string) {
  return icons[name] ?? Hash
}
