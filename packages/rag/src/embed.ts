import { openaiPost } from '@sa/shared/openai';

export interface Embedder {
  readonly model: string;
  readonly dims: number;
  embed(texts: string[], signal?: AbortSignal): Promise<{ vectors: number[][]; tokens: number }>;
}

interface EmbeddingResponse { data: { index: number; embedding: number[] }[]; usage: { prompt_tokens: number } }

export function openaiEmbedder(model = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small'): Embedder {
  return {
    model,
    dims: 1536,
    async embed(texts, signal) {
      const vectors: number[][] = [];
      let tokens = 0;
      for (let i = 0; i < texts.length; i += 96) {
        const batch = texts.slice(i, i + 96);
        const r = await openaiPost<EmbeddingResponse>('/embeddings', { model, input: batch }, { signal, timeoutMs: 15_000 });
        for (const d of r.data.sort((a, b) => a.index - b.index)) vectors.push(d.embedding);
        tokens += r.usage.prompt_tokens;
      }
      return { vectors, tokens };
    },
  };
}

export const toPgVector = (v: number[]) => `[${v.join(',')}]`;
