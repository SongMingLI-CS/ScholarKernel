/** 学术场景快捷提示词（点击填入输入框） */
export type QuickPrompt = {
  id: string
  label: { zh: string; en: string }
  prompt: { zh: string; en: string }
}

export const QUICK_PROMPTS: readonly QuickPrompt[] = [
  {
    id: "lit-review",
    label: { zh: "文献综述", en: "Literature review" },
    prompt: {
      zh: "请检索该主题近三年的核心论文，并写一份结构化文献综述（背景、方法、结论、研究空白）。",
      en: "Search core papers from the last 3 years on this topic and write a structured literature review (background, methods, findings, gaps).",
    },
  },
  {
    id: "paper-summary",
    label: { zh: "论文精读", en: "Paper deep-dive" },
    prompt: {
      zh: "请检索并精读一篇经典论文，总结：问题定义、方法、实验设置、主要结论与局限。",
      en: "Find and summarize a landmark paper: problem, method, experiments, key results, and limitations.",
    },
  },
  {
    id: "compare-methods",
    label: { zh: "方法对比", en: "Compare methods" },
    prompt: {
      zh: "请对比两种主流方法的原理、优缺点与适用场景，并给出选型建议。",
      en: "Compare two mainstream methods: principles, pros/cons, use cases, and a selection recommendation.",
    },
  },
  {
    id: "experiment-design",
    label: { zh: "实验设计", en: "Experiment design" },
    prompt: {
      zh: "针对以下研究问题，给出可执行的实验设计：变量、基线、评价指标与预期消融。",
      en: "For the research question below, propose an experiment: variables, baselines, metrics, and ablations.",
    },
  },
  {
    id: "explain-simple",
    label: { zh: "通俗解释", en: "ELI5" },
    prompt: {
      zh: "请用通俗语言解释以下概念，并给一个具体例子帮助理解：",
      en: "Explain the following concept in plain language with a concrete example:",
    },
  },
  {
    id: "related-work",
    label: { zh: "Related Work", en: "Related work" },
    prompt: {
      zh: "请检索相关论文并撰写 Related Work 段落（按主题分组，每段含代表性引用）。",
      en: "Search related papers and draft a Related Work section grouped by theme with representative citations.",
    },
  },
] as const
