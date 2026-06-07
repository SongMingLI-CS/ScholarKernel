import { NextResponse } from "next/server"

import { ensureUserBilling } from "./token-audit"

export class QuotaExceededError extends Error {
  readonly code = 402 as const
  constructor(message = "您的免费学术配额已耗尽，请升级商业套餐。") {
    super(message)
    this.name = "QuotaExceededError"
  }
}

export async function getBillingSnapshot(userId: string) {
  const billing = await ensureUserBilling(userId)
  const remaining = Math.max(0, billing.tokenQuota - billing.tokenUsed)
  const usagePercent =
    billing.tokenQuota > 0 ? Math.min(100, Math.round((billing.tokenUsed / billing.tokenQuota) * 100)) : 100
  return {
    tokenQuota: billing.tokenQuota,
    tokenUsed: billing.tokenUsed,
    totalSpent: billing.totalSpent,
    remaining,
    usagePercent,
    quotaExceeded: billing.tokenUsed >= billing.tokenQuota,
  }
}

export async function assertQuotaAvailable(userId: string): Promise<void> {
  const snapshot = await getBillingSnapshot(userId)
  if (snapshot.quotaExceeded) {
    throw new QuotaExceededError()
  }
}

export function jsonQuotaExceeded(message?: string) {
  return NextResponse.json(
    {
      error: "Quota Exceeded",
      code: 402,
      message: message ?? "您的免费学术配额已耗尽，请升级商业套餐。",
    },
    { status: 402 }
  )
}
