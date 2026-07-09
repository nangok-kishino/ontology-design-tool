// メールドメインの解析・検証（サーバー/クライアント共通で使用する純粋関数のみ）

const DOMAIN_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/

export function getEmailDomain(email: string): string {
  const at = email.lastIndexOf("@")
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase()
}

export function parseDomainList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0),
    ),
  )
}

export function isEmailAllowed(allowedDomains: string[] | undefined, email: string): boolean {
  if (!allowedDomains || allowedDomains.length === 0) return true
  return allowedDomains.includes(getEmailDomain(email))
}

// プロジェクトの閲覧可能ドメイン入力を検証する
// - 空欄はOK（パブリックプロジェクト）
// - 各ドメインは「@」を含めない・ドメイン形式であること
// - 自分自身のドメインが含まれていること（指定した場合、作成者が閉め出されないようにする）
export function validateAllowedDomainsInput(
  raw: string,
  ownEmail: string,
): { domains: string[] } | { error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { domains: [] }

  const tokens = trimmed.split(",").map((d) => d.trim()).filter((d) => d.length > 0)
  for (const token of tokens) {
    if (token.includes("@")) {
      return { error: `不正なドメイン名です（「${token}」に @ を含めないでください）` }
    }
    if (!DOMAIN_PATTERN.test(token)) {
      return { error: `不正なドメイン名です（「${token}」）` }
    }
  }

  const domains = parseDomainList(trimmed)
  const ownDomain = getEmailDomain(ownEmail)
  if (!domains.includes(ownDomain)) {
    return { error: `自分のドメイン（${ownDomain}）が含まれていないため作成・保存できません` }
  }

  return { domains }
}
