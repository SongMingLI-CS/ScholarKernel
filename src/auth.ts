import { PrismaAdapter } from "@auth/prisma-adapter"
import bcrypt from "bcryptjs"
import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import GitHub from "next-auth/providers/github"

import { prisma } from "@/lib/prisma"
import { isAuthEnabled, readAuthPassword, verifyPassword } from "@/lib/session-auth"

const githubId = process.env.GITHUB_ID?.trim()
const githubSecret = process.env.GITHUB_SECRET?.trim()
const hasGitHub = Boolean(githubId && githubSecret)

function readCredentialsUserId(): string {
  const raw = process.env.AUTH_USER_ID
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  return trimmed.length > 0 ? trimmed : "primary_user"
}

async function ensureCredentialsUser() {
  const userId = readCredentialsUserId()
  const password = readAuthPassword()
  const passwordHash = password ? await bcrypt.hash(password, 12) : null

  return prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      name: "Admin",
      email: process.env.AUTH_USER_EMAIL?.trim() || null,
      passwordHash,
    },
    update: {
      ...(passwordHash ? { passwordHash } : {}),
    },
  })
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  secret:
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    process.env.AUTH_SESSION_SECRET ??
    process.env.ENCRYPTION_SECRET,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/",
  },
  providers: [
    ...(hasGitHub
      ? [
          GitHub({
            clientId: githubId!,
            clientSecret: githubSecret!,
          }),
        ]
      : []),
    Credentials({
      id: "credentials",
      name: "Credentials",
      credentials: {
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!isAuthEnabled()) return null
        const password = typeof credentials?.password === "string" ? credentials.password : ""
        if (!password.trim() || !verifyPassword(password)) return null

        const user = await ensureCredentialsUser()
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = String(user.id)
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = String(token.sub)
      }
      return session
    },
  },
  trustHost: true,
})
