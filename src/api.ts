const API_BASE: string = import.meta.env.VITE_API_URL ?? ''

let token: string | null = localStorage.getItem('cf_token')

export function setToken(value: string | null) {
  token = value
  if (value) localStorage.setItem('cf_token', value)
  else localStorage.removeItem('cf_token')
}

export function hasToken() {
  return Boolean(token)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new ApiError(0, '无法连接服务器，请确认 API 已启动')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(response.status, (data as { error?: string }).error ?? '请求失败，请稍后再试')
  }
  return data as T
}
