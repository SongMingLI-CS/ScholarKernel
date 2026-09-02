"use client"

import { memo } from "react"

import { WorkshopPanel } from "@/components/template-hub"
import { useTemplateLaunch } from "@/hooks/use-template-launch"

export const TemplateWorkshopPanel = memo(function TemplateWorkshopPanel() {
  const { launchWithInput } = useTemplateLaunch()
  return <WorkshopPanel onLaunch={launchWithInput} />
})
