import type { WorkflowNodeProvider, WorkflowNodeStatus, WorkflowNodeType } from "@/store/types"

export type TemplateCategory = "peer-review" | "grant" | "revision"

export type TemplateInitialAgent = {
  id: string
  type: WorkflowNodeType
  provider: WorkflowNodeProvider
  title: string
  status?: WorkflowNodeStatus
  metadata?: Record<string, unknown>
  logs?: string[]
}

export type AcademicTemplate = {
  id: string
  title: string
  description: string
  icon: string
  category: TemplateCategory
  systemPrompt: string
  initialAgents: TemplateInitialAgent[]
  defaultInputPlaceholder: string
}

export const ACADEMIC_TEMPLATES: readonly AcademicTemplate[] = [
  {
    id: "neurips-peer-review",
    title: "顶会双盲评审模拟器",
    description:
      "NeurIPS / ICML 级双盲审稿：2 位尖锐审稿人并行挑刺方法论漏洞与创新性不足，领域主席综合裁决。",
    icon: "Gavel",
    category: "peer-review",
    systemPrompt: `你是 ScholarKernel 顶会双盲评审编排内核。目标：以 NeurIPS / ICML 标准对投稿进行毁灭性但建设性的审稿模拟。

编排原则：
1. Reviewer #1 专注方法论：实验设计、对照组、统计检验、可复现性、消融完整性。
2. Reviewer #2 专注创新性与相关工作：是否 incremental、是否遗漏 SOTA 对比、贡献声明是否 over-claim。
3. Area Chair 综合两位审稿人意见，给出 Accept / Weak Accept / Borderline / Reject 倾向与 meta-review 要点。
4. 输出须结构化：Major Concerns / Minor Issues / Questions to Authors / Overall Score (1-10)。
5. 禁止空泛表扬；每条批评须指向可验证的论文段落或实验缺口。`,
    initialAgents: [
      {
        id: "peer-r1",
        type: "peer_review",
        provider: "cloud",
        title: "Reviewer #1 · 方法论刺客",
        status: "running",
        metadata: { personaId: "methodology_critic", peerReviewRole: "reviewer", templateId: "neurips-peer-review" },
        logs: ["正在扫描实验设计与统计严谨性…"],
      },
      {
        id: "peer-r2",
        type: "peer_review",
        provider: "cloud",
        title: "Reviewer #2 · 创新性猎手",
        status: "running",
        metadata: { personaId: "innovation_scout", peerReviewRole: "reviewer", templateId: "neurips-peer-review" },
        logs: ["正在对照 SOTA 评估贡献边界…"],
      },
      {
        id: "peer-r3",
        type: "peer_review",
        provider: "cloud",
        title: "Area Chair · 客观裁决",
        status: "pending",
        metadata: { personaId: "area_chair", peerReviewRole: "meta_review", templateId: "neurips-peer-review" },
        logs: ["等待并行审稿完成后综合…"],
      },
    ],
    defaultInputPlaceholder:
      "粘贴论文摘要 / 全文 PDF 提取文本，或描述实验设计与主要贡献…",
  },
  {
    id: "nsfc-grant-audit",
    title: "国自然本子致命缺陷挖掘机",
    description:
      "从技术路线可行性、科学问题属性、创新性与研究基础等维度，对本子进行预防性毁灭性挑刺。",
    icon: "Pickaxe",
    category: "grant",
    systemPrompt: `你是 ScholarKernel 基金本子预审编排内核。目标：在国自然 / 部级基金正式提交前，挖掘可能导致「函评不过」的致命缺陷。

审查维度：
1. 科学问题属性：是否真问题、是否国家需求对齐、问题边界是否清晰。
2. 技术路线：是否可执行、里程碑是否合理、风险与备选方案是否缺失。
3. 创新性：是否与已有基金 / 论文高度重叠、是否 incremental 包装。
4. 研究基础：前期成果是否支撑本子承诺、团队配置是否匹配。
5. 格式与逻辑：目标-内容-方案-基础链条是否自洽。

输出须分：致命缺陷（必须改）/ 重大风险（强烈建议改）/ 润色建议；每条须可定位到本子章节。`,
    initialAgents: [
      {
        id: "grant-route",
        type: "audit",
        provider: "cloud",
        title: "技术路线审查官",
        status: "running",
        metadata: { personaId: "grant_route_auditor", templateId: "nsfc-grant-audit" },
        logs: ["正在评估技术路线可行性与里程碑…"],
      },
      {
        id: "grant-science",
        type: "reasoning",
        provider: "cloud",
        title: "科学问题属性判官",
        status: "running",
        metadata: { personaId: "science_question_critic", templateId: "nsfc-grant-audit" },
        logs: ["正在检验科学问题必要性与边界…"],
      },
      {
        id: "grant-foundation",
        type: "audit",
        provider: "cloud",
        title: "研究基础对照员",
        status: "pending",
        metadata: { personaId: "foundation_checker", templateId: "nsfc-grant-audit" },
        logs: ["等待前序审查完成后交叉验证…"],
      },
    ],
    defaultInputPlaceholder:
      "上传基金本子 PDF / 粘贴立项依据、研究内容与技术路线章节…",
  },
  {
    id: "sci-revision-rebuttal",
    title: "SCI 大修意见润色与反驳助手",
    description:
      "输入审稿人长篇批评与修改稿，自动规划逐条反驳话术、润色措辞与 Response Letter 结构。",
    icon: "PenLine",
    category: "revision",
    systemPrompt: `你是 ScholarKernel SCI 大修回复编排内核。目标：将审稿人意见与作者修改稿对齐，生成专业、克制、证据充分的回复策略。

编排原则：
1. 逐条映射审稿意见 → 修改位置 → 回复要点（同意 / 部分同意 / 礼貌反驳）。
2. 润色语气：学术、尊重、不 defensive；反驳须引用新增实验 / 数据 / 文献。
3. 识别审稿人误解 vs 真实缺陷；对误解给出清晰澄清，对缺陷给出已改说明。
4. 输出结构：Point-by-Point Response 草稿 + 可选 Cover Letter 要点 + 仍需补充实验清单。`,
    initialAgents: [
      {
        id: "rev-mapper",
        type: "reasoning",
        provider: "cloud",
        title: "意见逐条映射员",
        status: "running",
        metadata: { personaId: "review_mapper", templateId: "sci-revision-rebuttal" },
        logs: ["正在解析审稿意见条目…"],
      },
      {
        id: "rev-rebuttal",
        type: "audit",
        provider: "cloud",
        title: "反驳话术策略师",
        status: "running",
        metadata: { personaId: "rebuttal_strategist", templateId: "sci-revision-rebuttal" },
        logs: ["正在匹配修改稿与回复策略…"],
      },
      {
        id: "rev-polish",
        type: "reasoning",
        provider: "cloud",
        title: "润色与格式审查",
        status: "pending",
        metadata: { personaId: "response_polisher", templateId: "sci-revision-rebuttal" },
        logs: ["等待策略完成后统一润色…"],
      },
    ],
    defaultInputPlaceholder:
      "粘贴审稿人意见全文 + 您的修改说明或 Revised Manuscript 摘要…",
  },
] as const

export type AcademicTemplateId = (typeof ACADEMIC_TEMPLATES)[number]["id"]

export function isAcademicTemplateId(id: string): id is AcademicTemplateId {
  return ACADEMIC_TEMPLATES.some((t) => t.id === id)
}
