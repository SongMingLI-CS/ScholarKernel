import type { Metadata } from "next"

import { PublicSharePageClient } from "@/components/public-share-page"

export const metadata: Metadata = {
  title: "Shared Report · ScholarKernel",
  description: "Read-only academic report shared via ScholarKernel.",
  robots: { index: false, follow: false },
}

type PageProps = { params: Promise<{ token: string }> }

export default async function PublicSharePage({ params }: PageProps) {
  const { token } = await params
  return <PublicSharePageClient token={token} />
}
