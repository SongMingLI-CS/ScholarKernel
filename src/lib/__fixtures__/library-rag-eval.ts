import type { LibraryChunkCandidate } from "@/lib/library-rag"

export type LibraryRagEvalCase = {
  id: string
  query: string
  relevantChunkIds: string[]
}

export const libraryRagEvalChunks: LibraryChunkCandidate[] = [
  { documentId: "transformer", chunkId: "t-intro", documentTitle: "Attention Is All You Need", chunkIndex: 0, section: "Introduction", headingPath: ["Introduction"], page: 1, paragraphStart: 0, paragraphEnd: 0, content: "The Transformer replaces recurrence with self-attention for sequence transduction." },
  { documentId: "transformer", chunkId: "t-complexity", documentTitle: "Attention Is All You Need", chunkIndex: 1, section: "Complexity", headingPath: ["Methods", "Complexity"], page: 6, paragraphStart: 12, paragraphEnd: 13, content: "Self-attention has constant sequential operations and per-layer complexity quadratic in sequence length." },
  { documentId: "transformer", chunkId: "t-results", documentTitle: "Attention Is All You Need", chunkIndex: 2, section: "Results", headingPath: ["Experiments", "Translation"], page: 8, paragraphStart: 20, paragraphEnd: 21, content: "The model improves BLEU on English to German translation while training faster." },
  { documentId: "bert", chunkId: "b-pretrain", documentTitle: "BERT", chunkIndex: 0, section: "Pre-training", headingPath: ["Methods", "Pre-training"], page: 3, paragraphStart: 4, paragraphEnd: 5, content: "BERT uses masked language modeling and next sentence prediction for bidirectional pretraining." },
  { documentId: "bert", chunkId: "b-results", documentTitle: "BERT", chunkIndex: 1, section: "Results", headingPath: ["Experiments"], page: 7, paragraphStart: 16, paragraphEnd: 17, content: "Fine-tuning BERT achieves strong results on question answering and natural language inference." },
  { documentId: "vit", chunkId: "v-patches", documentTitle: "Vision Transformer", chunkIndex: 0, section: "Method", headingPath: ["Method", "Patch embeddings"], page: 3, paragraphStart: 5, paragraphEnd: 6, content: "An image is split into fixed-size patches which are linearly embedded as Transformer tokens." },
  { documentId: "vit", chunkId: "v-data", documentTitle: "Vision Transformer", chunkIndex: 1, section: "Experiments", headingPath: ["Experiments", "Data requirements"], page: 6, paragraphStart: 14, paragraphEnd: 15, content: "Vision Transformers benefit from large-scale pretraining and transfer well to image classification." },
  { documentId: "biology", chunkId: "bio-culture", documentTitle: "Cell Culture Protocol", chunkIndex: 0, section: "Methods", headingPath: ["Methods"], page: 2, paragraphStart: 2, paragraphEnd: 3, content: "Cells were cultured at controlled temperature and inspected with fluorescence microscopy." },
]

export const libraryRagEvalCases: LibraryRagEvalCase[] = [
  { id: "self-attention-complexity", query: "self attention sequential complexity", relevantChunkIds: ["t-complexity"] },
  { id: "masked-language-model", query: "masked language model bidirectional pretraining", relevantChunkIds: ["b-pretrain"] },
  { id: "image-patches", query: "image patch embedding transformer tokens", relevantChunkIds: ["v-patches"] },
  { id: "translation-quality", query: "English German translation BLEU", relevantChunkIds: ["t-results"] },
]
