import type { IEmbeddingsProvider } from "./interfaces";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

/** Voyage AI embeddings over HTTPS. Thin wrapper — no business logic. */
export class VoyageEmbeddings implements IEmbeddingsProvider {
  /** voyage-3.5 output dimensionality. */
  readonly dimensions = 1024;

  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = "voyage-3.5") {
    this.apiKey = apiKey;
    this.model = model;
  }

  /** Embed a batch of documents. */
  async embed(texts: string[]): Promise<number[][]> {
    return this.request(texts, "document");
  }

  /** Embed a search query. */
  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.request([text], "query");
    if (!vector) throw new Error("Voyage returned no embedding for query");
    return vector;
  }

  private async request(
    input: string[],
    inputType: "document" | "query",
  ): Promise<number[][]> {
    const response = await fetch(VOYAGE_URL, {
      body: JSON.stringify({ input, input_type: inputType, model: this.model }),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(
        `Voyage API ${response.status}: ${await response.text()}`,
      );
    }
    const payload = (await response.json()) as {
      data: { embedding: number[]; index: number }[];
    };
    return payload.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
}
