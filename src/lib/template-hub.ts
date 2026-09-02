import {
  ACADEMIC_TEMPLATES,
  isAcademicTemplateId,
  type AcademicTemplate,
  type AcademicTemplateId,
  type TemplateInitialAgent,
} from "@/config/presets"
import { createOptimisticConversation } from "@/lib/optimistic-ui"
import type { ConversationSummary } from "@/lib/db-types"
import type { WorkflowNode } from "@/store/types"

export type TemplateBootstrapPayload = {
  templateId: AcademicTemplateId
  systemPrompt: string
  initialAgents: WorkflowNode[]
  jobId: string
}

export type CreateConversationFromTemplateBody = {
  templateId: string
  initialInput?: string
}

export function getTemplateById(templateId: string): AcademicTemplate | null {
  if (!isAcademicTemplateId(templateId)) return null
  return ACADEMIC_TEMPLATES.find((t) => t.id === templateId) ?? null
}

export function resolveTemplateSystemPrompt(templateId: string): string | null {
  const template = getTemplateById(templateId)
  return template?.systemPrompt ?? null
}

export function templateInitialAgentToWorkflowNode(agent: TemplateInitialAgent): WorkflowNode {
  return {
    id: agent.id,
    type: agent.type,
    provider: agent.provider,
    status: agent.status ?? "pending",
    title: agent.title,
    logs: agent.logs ?? [],
    metadata: agent.metadata,
  }
}

/** Build workflow nodes for topology — first wave agents enter `running`. */
export function buildTemplateWorkflowNodes(template: AcademicTemplate): WorkflowNode[] {
  return template.initialAgents.map(templateInitialAgentToWorkflowNode)
}

export function buildTemplateBootstrap(templateId: string): Omit<TemplateBootstrapPayload, "jobId"> | null {
  const template = getTemplateById(templateId)
  if (!template) return null
  return {
    templateId: template.id,
    systemPrompt: template.systemPrompt,
    initialAgents: buildTemplateWorkflowNodes(template),
  }
}

export function createOptimisticConversationFromTemplate(
  tempId: string,
  templateId: string
): ConversationSummary | null {
  const template = getTemplateById(templateId)
  if (!template) return null
  return createOptimisticConversation(tempId, template.title)
}

export function parseTemplateIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const rec = body as Record<string, unknown>
  const templateId = typeof rec.templateId === "string" ? rec.templateId.trim() : ""
  return templateId || null
}

export function validateTemplateCreateBody(body: unknown): CreateConversationFromTemplateBody | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const rec = body as Record<string, unknown>
  const templateId = typeof rec.templateId === "string" ? rec.templateId.trim() : ""
  if (!templateId || !isAcademicTemplateId(templateId)) return null
  const initialInput = typeof rec.initialInput === "string" ? rec.initialInput.trim() : undefined
  return { templateId, ...(initialInput ? { initialInput } : {}) }
}
