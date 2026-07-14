export type RiskLevel = 'low' | 'medium' | 'high'

export type ModerationResult = {
  risk: RiskLevel
  score: number
  reasons: string[]
  source?: 'rules' | 'llm+rules'
}

type Rule = {
  weight: number
  reason: string
  test: (text: string) => boolean
}

const rules: Rule[] = [
  { weight: 6, reason: '疑似诈骗话术（转账/汇款/押金 + 私下联系）', test: (t) => /(转账|汇款|打款|定金|押金|保证金)/.test(t) && /(私聊|私信|加我|联系我|扫码)/.test(t) },
  { weight: 6, reason: '疑似代考代写等学术不端交易', test: (t) => /(代考|代写|代做|枪手|包过)/.test(t) },
  { weight: 6, reason: '疑似刷单兼职诈骗', test: (t) => /(刷单|点赞员|打字员).{0,12}(兼职|日结|返现|佣金)/.test(t) || /(兼职).{0,12}(刷单|返现)/.test(t) },
  { weight: 6, reason: '疑似赌博或借贷推广', test: (t) => /(博彩|赌球|网赌|裸贷|套现|高利贷)/.test(t) },
  { weight: 4, reason: '包含手机号码，存在隐私或引流风险', test: (t) => /1[3-9]\d{9}/.test(t) },
  { weight: 3, reason: '引导添加校外联系方式', test: (t) => /(加|\+)\s*(微信|vx|wx|v信|qq|q群)/i.test(t) || /(微信|qq)号?\s*[:：]?\s*[a-zA-Z0-9_-]{5,}/i.test(t) },
  { weight: 3, reason: '包含侮辱性表达', test: (t) => /(傻逼|脑残|废物|滚蛋|贱人|去死)/.test(t) },
  { weight: 3, reason: '涉及大额金钱交易', test: (t) => /(高价|急收|急出).{0,10}(回收|收购|出售)/.test(t) || /\d{3,}\s*(元|块|rmb).{0,8}(出|收|转)/i.test(t) },
  { weight: 2, reason: '包含站外链接，需要确认安全性', test: (t) => /https?:\/\/(?!.*\.edu\.cn)/i.test(t) },
  { weight: 2, reason: '检测到大量重复字符，疑似灌水', test: (t) => /(.)\1{9,}/.test(t) },
  { weight: 2, reason: '疑似广告推广内容', test: (t) => /(优惠券|折扣码|推广|引流|招代理|一手货源)/.test(t) },
]

export function moderateText(...parts: Array<string | undefined>): ModerationResult {
  const text = parts.filter(Boolean).join('\n')
  const reasons: string[] = []
  let score = 0
  for (const rule of rules) {
    if (rule.test(text)) {
      score += rule.weight
      reasons.push(rule.reason)
    }
  }
  const risk: RiskLevel = score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low'
  return { risk, score, reasons, source: 'rules' }
}

const riskRank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 }

/**
 * Optional OpenAI-compatible moderation adapter. Rules always run first and
 * remain authoritative when the external model is unavailable or less strict.
 */
export async function moderateTextWithAI(...parts: Array<string | undefined>): Promise<ModerationResult> {
  const ruleResult = moderateText(...parts)
  const endpoint = process.env.LLM_MODERATION_URL?.trim()
  const apiKey = process.env.LLM_API_KEY?.trim()
  if (!endpoint || !apiKey) return ruleResult

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.LLM_TIMEOUT_MS ?? 5000))
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? 'gpt-4.1-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是大学校园社区内容安全审核员。只输出 JSON：{"risk":"low|medium|high","score":0到10的整数,"reasons":["简短中文理由"]}。重点识别诈骗、学术不端、隐私泄露、骚扰仇恨、违法交易和人身安全风险。一般意见分歧不得判为违规。',
          },
          { role: 'user', content: parts.filter(Boolean).join('\n').slice(0, 8000) },
        ],
      }),
    })
    if (!response.ok) throw new Error(`LLM moderation HTTP ${response.status}`)
    const payload = await response.json() as any
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('LLM moderation returned no content')
    const parsed = JSON.parse(content) as { risk?: string; score?: number; reasons?: unknown }
    if (parsed.risk !== 'low' && parsed.risk !== 'medium' && parsed.risk !== 'high') throw new Error('LLM moderation returned invalid risk')
    const modelRisk = parsed.risk as RiskLevel
    const risk = riskRank[modelRisk] > riskRank[ruleResult.risk] ? modelRisk : ruleResult.risk
    const reasons = Array.from(new Set([
      ...ruleResult.reasons,
      ...(Array.isArray(parsed.reasons) ? parsed.reasons.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 5) : []),
    ]))
    return {
      risk,
      score: Math.max(ruleResult.score, Math.min(Math.max(Number(parsed.score) || 0, 0), 10)),
      reasons,
      source: 'llm+rules',
    }
  } catch (error) {
    console.warn('External LLM moderation unavailable; using local rules:', error instanceof Error ? error.message : error)
    return ruleResult
  } finally {
    clearTimeout(timeout)
  }
}

export const riskLabel: Record<RiskLevel, string> = { low: '低风险', medium: '中风险', high: '高风险' }
