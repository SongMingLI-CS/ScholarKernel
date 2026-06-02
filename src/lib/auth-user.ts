import type { Prisma } from "../../generated/prisma/client"

import { auth } from "@/auth"
import { isAuthEnabled } from "@/lib/session-auth"

/** 无 Auth 阶段的匿名租户 ID；历史会话可能为 null userId */
export const DEFAULT_USER_ID = "default_user_id"

/**
 * @deprecated 请改用 resolveUserIdFromRequest()。仅在 Auth 未启用时用于兼容。
 */
export function resolveUserId(): string {
  return DEFAULT_USER_ID
}

/** Auth.js v5 服务端会话（等价于旧版 getServerSession） */
export async function getServerSession() {
  return auth()
}

/** 从 NextAuth 会话解析当前用户 ID；Auth 未启用时返回 DEFAULT_USER_ID */
export async function resolveUserIdFromRequest(_req?: Request): Promise<string | null> {
  if (!isAuthEnabled()) return DEFAULT_USER_ID
  const session = await auth()
  return session?.user?.id ?? null
}

/** 会话列表/详情查询：Auth 关闭时兼容历史 null userId；启用后严格按 userId 隔离 */
export function conversationOwnerWhere(userId: string): Prisma.ConversationWhereInput {
  if (!isAuthEnabled() && userId === DEFAULT_USER_ID) {
    return { OR: [{ userId }, { userId: null }] }
  }
  return { userId }
}
