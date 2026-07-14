import type { CSSProperties } from 'react'

const AVATAR_PALETTES = [
  ['#c9f7df', '#7dd8b2', '#145b43', '#eafff4'],
  ['#d9efff', '#88c8f2', '#1c5f8b', '#f4fbff'],
  ['#ffe0e8', '#ff9fba', '#8e3f5a', '#fff5f8'],
  ['#fff0b8', '#ffd16b', '#775113', '#fff9df'],
  ['#e9e1ff', '#b8a6f6', '#55458f', '#f8f5ff'],
  ['#ffe2cd', '#ffad78', '#864724', '#fff6ee'],
  ['#ccf5f2', '#6fd3cc', '#155e5a', '#efffff'],
  ['#f7ddff', '#d89ced', '#754087', '#fff5ff'],
] as const

type AvatarVariables = CSSProperties & {
  '--avatar-a': string
  '--avatar-b': string
  '--avatar-ink': string
  '--avatar-shine': string
}

export function avatarStyle(seed: number | string | undefined): AvatarVariables {
  const value = String(seed ?? 'guest')
  let hash = 0
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  const [a, b, ink, shine] = AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
  return { '--avatar-a': a, '--avatar-b': b, '--avatar-ink': ink, '--avatar-shine': shine }
}
