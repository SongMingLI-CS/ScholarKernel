import type { LibraryChunkCandidate } from "@/lib/library-rag"

type BenchmarkTopic = {
  id: string
  chunks: LibraryChunkCandidate[]
  relevantChunkIds: string[]
  queries: string[]
}

const chunk = (documentId: string, chunkId: string, title: string, section: string, page: number, content: string, chunkIndex = 0): LibraryChunkCandidate => ({
  documentId, chunkId, documentTitle: title, section, headingPath: [section], page,
  paragraphStart: chunkIndex * 2, paragraphEnd: chunkIndex * 2 + 1, chunkIndex, content,
})

const topics: BenchmarkTopic[] = [
  {
    id: "transformer-complexity",
    chunks: [chunk("transformer", "transformer-complexity", "Attention Is All You Need", "Complexity", 6, "Self attention uses constant sequential operations, while per-layer complexity is quadratic in sequence length.")],
    relevantChunkIds: ["transformer-complexity"],
    queries: ["self attention sequential complexity", "quadratic sequence length attention", "constant sequential operations", "What is the per-layer complexity of self attention?", "How does attention scale with sequence length?", "自注意力的序列复杂度", "自注意力是否需要顺序计算", "compare self attention operations and complexity"],
  },
  {
    id: "bert-pretraining",
    chunks: [chunk("bert", "bert-pretraining", "BERT", "Pre-training", 3, "BERT combines masked language modeling with next sentence prediction for deep bidirectional pretraining.")],
    relevantChunkIds: ["bert-pretraining"],
    queries: ["BERT masked language modeling", "next sentence prediction pretraining", "deep bidirectional pretraining", "Which objectives are used to pretrain BERT?", "masked tokens and sentence prediction", "掩码语言模型与双向预训练", "BERT 的掩码语言模型目标", "BERT pre-training objectives"],
  },
  {
    id: "vision-transformer",
    chunks: [chunk("vit", "vit-patches", "Vision Transformer", "Patch embeddings", 3, "An image is split into fixed-size patches and linearly embedded as Transformer tokens for image classification.")],
    relevantChunkIds: ["vit-patches"],
    queries: ["Vision Transformer image patches", "fixed size patch embeddings", "image classification transformer tokens", "How does ViT represent an image?", "linearly embedded visual patches", "图像块如何变成 Transformer token", "视觉 Transformer 的图像块嵌入", "ViT patch token representation"],
  },
  {
    id: "resnet",
    chunks: [chunk("resnet", "resnet-residual", "Deep Residual Learning", "Residual blocks", 4, "Residual connections learn a residual mapping with identity shortcuts, enabling substantially deeper convolutional networks.")],
    relevantChunkIds: ["resnet-residual"],
    queries: ["ResNet residual connection", "identity shortcut residual mapping", "deeper convolutional networks", "Why do identity shortcuts help deep networks?", "residual blocks train depth", "残差连接与恒等捷径", "残差连接如何训练更深网络", "deep residual learning shortcut"],
  },
  {
    id: "gnn",
    chunks: [chunk("gnn", "gnn-message", "Graph Neural Networks", "Message passing", 5, "Message passing aggregates neighboring node features; excessive layers can cause oversmoothing of node representations.")],
    relevantChunkIds: ["gnn-message"],
    queries: ["graph message passing neighbors", "GNN oversmoothing", "aggregate neighboring node features", "What causes oversmoothing in graph networks?", "excessive message passing layers", "图神经网络的消息传递", "过平滑为何出现在多层 GNN", "node representation oversmoothing"],
  },
  {
    id: "clip",
    chunks: [chunk("clip", "clip-contrastive", "Learning Transferable Visual Models", "Contrastive pre-training", 2, "CLIP learns aligned image and text representations through contrastive learning and supports zero shot classification.")],
    relevantChunkIds: ["clip-contrastive"],
    queries: ["CLIP contrastive learning", "aligned image text representations", "zero shot classification", "How does CLIP support zero shot transfer?", "image text contrastive pretraining", "对比学习对齐图文表示", "CLIP 的零样本分类", "contrastive visual language model"],
  },
  {
    id: "alphafold",
    chunks: [chunk("alphafold", "alphafold-structure", "Highly Accurate Protein Structure Prediction", "Architecture", 4, "AlphaFold predicts protein structure using evolutionary multiple sequence alignments and attention over residue pair representations.")],
    relevantChunkIds: ["alphafold-structure"],
    queries: ["AlphaFold protein structure", "multiple sequence alignment attention", "residue pair representations", "What evolutionary input does AlphaFold use?", "attention for protein folding", "蛋白质结构预测中的注意力", "AlphaFold 如何使用多序列比对", "protein residue pair architecture"],
  },
  {
    id: "diffusion",
    chunks: [chunk("diffusion", "diffusion-noise", "Denoising Diffusion Probabilistic Models", "Reverse process", 3, "A diffusion model learns a reverse denoising process that transforms Gaussian noise into data through iterative sampling steps.")],
    relevantChunkIds: ["diffusion-noise"],
    queries: ["diffusion reverse denoising", "Gaussian noise iterative sampling", "denoising probabilistic model", "How does a diffusion model generate data?", "reverse process from noise", "扩散模型的反向去噪", "扩散模型如何从高斯噪声采样", "iterative diffusion sampling steps"],
  },
  {
    id: "lora",
    chunks: [chunk("lora", "lora-rank", "LoRA: Low-Rank Adaptation", "Method", 4, "Low rank adaptation freezes pretrained weights and injects trainable rank decomposition matrices into Transformer layers.")],
    relevantChunkIds: ["lora-rank"],
    queries: ["LoRA low rank adaptation", "freeze pretrained weights", "trainable rank decomposition matrices", "Which parameters does LoRA train?", "parameter efficient Transformer adaptation", "低秩适配是否冻结预训练权重", "LoRA 的低秩分解矩阵", "low rank fine tuning method"],
  },
  {
    id: "retrieval-augmented-generation",
    chunks: [chunk("rag", "rag-memory", "Retrieval-Augmented Generation", "Non-parametric memory", 2, "Retrieval augmented generation combines parametric language generation with a non parametric memory of retrieved passages.")],
    relevantChunkIds: ["rag-memory"],
    queries: ["retrieval augmented generation", "parametric and non parametric memory", "retrieved passages language generation", "What external memory does RAG use?", "combine retrieval with generation", "检索增强生成与非参数记忆", "RAG 如何使用检索段落", "retrieval grounded language model"],
  },
  {
    id: "causal-inference",
    chunks: [chunk("causal", "causal-confounding", "Causal Inference", "Identification", 6, "Causal inference requires identification assumptions such as conditional exchangeability to adjust for measured confounding.")],
    relevantChunkIds: ["causal-confounding"],
    queries: ["causal inference confounding", "conditional exchangeability", "causal identification assumptions", "How can measured confounding be adjusted?", "identification under exchangeability", "因果推断中的混杂调整", "条件可交换性假设", "causal effect identification"],
  },
  {
    id: "federated-learning",
    chunks: [chunk("federated", "federated-aggregation", "Communication-Efficient Federated Learning", "Federated averaging", 5, "Federated learning trains across decentralized devices by aggregating local model updates without centralizing raw data.")],
    relevantChunkIds: ["federated-aggregation"],
    queries: ["federated learning aggregation", "decentralized devices local updates", "without centralizing raw data", "How does federated averaging preserve data locality?", "aggregate local model updates", "联邦学习如何聚合本地更新", "联邦学习不集中原始数据", "communication efficient federated averaging"],
  },
  {
    id: "reinforcement-learning",
    chunks: [chunk("rl", "rl-policy", "Reinforcement Learning", "Policy optimization", 7, "Reinforcement learning optimizes a policy from rewards; policy gradients estimate expected return derivatives from sampled trajectories.")],
    relevantChunkIds: ["rl-policy"],
    queries: ["reinforcement learning policy gradients", "expected return derivatives", "sampled trajectories rewards", "How are policy gradients estimated?", "optimize a policy from rewards", "强化学习的策略梯度", "如何从轨迹估计期望回报", "policy optimization trajectories"],
  },
  {
    id: "scaling-conflict",
    chunks: [
      chunk("scaling-large", "scaling-benefit", "Scaling Laws", "Results", 8, "Scaling model parameters and training data reduces validation loss predictably when compute is balanced."),
      chunk("scaling-small", "scaling-risk", "Small Data Regimes", "Limitations", 5, "Scaling model parameters with limited training data increases overfitting risk and can worsen validation performance."),
    ],
    relevantChunkIds: ["scaling-benefit", "scaling-risk"],
    queries: ["conflicting evidence scaling model parameters validation", "scaling laws versus limited training data", "model size validation loss and overfitting", "When does scaling help or hurt validation?", "compare balanced compute with small data", "模型扩展对验证性能的矛盾证据", "大模型在有限训练数据下是否过拟合", "parameter scaling benefits and risks"],
  },
  {
    id: "reproducibility-cross-paragraph",
    chunks: [
      chunk("repro", "repro-seeds", "Reproducible Machine Learning", "Experimental protocol", 3, "The protocol reports random seeds, dataset splits, and preprocessing decisions for every experiment.", 0),
      chunk("repro", "repro-variance", "Reproducible Machine Learning", "Experimental protocol", 3, "Results include variance across repeated runs and confidence intervals rather than a single best score.", 1),
    ],
    relevantChunkIds: ["repro-seeds", "repro-variance"],
    queries: ["reproducibility random seeds variance repeated runs", "dataset splits and confidence intervals", "experimental protocol preprocessing variance", "What should a reproducible evaluation report?", "seeds splits repeated run uncertainty", "可复现实验需要随机种子和方差", "数据划分与置信区间如何报告", "cross paragraph reproducibility evidence"],
  },
]

export type LibraryRagBenchmarkCase = {
  id: string
  category: "exact" | "synonym" | "cross-paragraph" | "zh-en" | "conflict" | "no-answer"
  query: string
  relevantChunkIds: string[]
  humanRelevance: Record<string, 1 | 2 | 3>
}

const categoryFor = (topic: BenchmarkTopic, index: number): LibraryRagBenchmarkCase["category"] => {
  if (topic.id === "scaling-conflict") return "conflict"
  if (topic.id === "reproducibility-cross-paragraph") return "cross-paragraph"
  if (index === 5 || index === 6) return "zh-en"
  return index === 0 || index === 2 ? "exact" : "synonym"
}

export const libraryRagBenchmarkChunks = topics.flatMap((topic) => topic.chunks)

export const libraryRagBenchmarkCases: LibraryRagBenchmarkCase[] = [
  ...topics.flatMap((topic) => topic.queries.map((query, index) => ({
    id: `${topic.id}-${index + 1}`,
    category: categoryFor(topic, index),
    query,
    relevantChunkIds: topic.relevantChunkIds,
    humanRelevance: Object.fromEntries(topic.relevantChunkIds.map((id) => [id, 3])) as Record<string, 3>,
  }))),
  ...[
    "volcanic seismology magma chamber tomography", "medieval manuscript pigment spectroscopy", "marine coral spawning lunar cycles",
    "quantum Hall edge states cryogenic transport", "archaeological pollen records bronze age", "avian migration magnetic field sensing",
    "battery electrolyte dendrite suppression", "Martian regolith perchlorate chemistry", "ocean salinity thermohaline circulation",
    "superconducting qubit microwave resonator calibration",
  ].map((query, index) => ({ id: `no-answer-${index + 1}`, category: "no-answer" as const, query, relevantChunkIds: [], humanRelevance: {} })),
]
