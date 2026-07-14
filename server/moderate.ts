export type RiskLevel = 'low' | 'medium' | 'high'

export type ModerationResult = {
  risk: RiskLevel
  score: number
  reasons: string[]
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
  return { risk, score, reasons }
}

export const riskLabel: Record<RiskLevel, string> = { low: '低风险', medium: '中风险', high: '高风险' }
