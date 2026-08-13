import type { Connection, Table } from "@lancedb/lancedb";

import { connect } from "@lancedb/lancedb";

import type { ChunkRecord, SearchFilters, SearchResult } from "../model";
import type { IChunkStore } from "./interfaces";

const TABLE = "chunks";

interface StoredRow extends Omit<ChunkRecord, "embedding" | "metadata"> {
  metadataJson: string;
  vector: number[];
}

const toRow = (chunk: ChunkRecord): StoredRow => {
  const { embedding, metadata, ...rest } = chunk;
  return { ...rest, metadataJson: JSON.stringify(metadata), vector: embedding };
};

const fromRow = (row: StoredRow): ChunkRecord => {
  const { metadataJson, vector, ...rest } = row;
  return {
    ...rest,
    embedding: Array.from(vector),
    metadata: JSON.parse(metadataJson) as Record<string, string>,
  };
};

const escapeSql = (value: string): string => value.replaceAll("'", "''");

/**
 * LanceDB-backed chunk store. Thin adapter — no business logic. The table is
 * created from the first upserted batch; until then every read reports an
 * empty store.
 */
export class LanceDbChunkStore implements IChunkStore {
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /** Total number of stored chunks. */
  async count(): Promise<number> {
    const table = await this.openIfExists();
    return table ? table.countRows() : 0;
  }

  /** Remove every chunk for one source file. */
  async deleteByPath(source: string, path: string): Promise<void> {
    const table = await this.openIfExists();
    if (!table) return;
    await table.delete(
      `source = '${escapeSql(source)}' AND path = '${escapeSql(path)}'`,
    );
  }

  /** Distinct indexed file paths for a source. */
  async listPaths(source: string): Promise<string[]> {
    const table = await this.openIfExists();
    if (!table) return [];
    const rows = (await table
      .query()
      .where(`source = '${escapeSql(source)}'`)
      .select(["path"])
      .toArray()) as { path: string }[];
    return [...new Set(rows.map((row) => row.path))].sort();
  }

  /** All chunks for one file, ordered by ordinal. */
  async readPath(source: string, path: string): Promise<ChunkRecord[]> {
    const table = await this.openIfExists();
    if (!table) return [];
    const rows = (await table
      .query()
      .where(`source = '${escapeSql(source)}' AND path = '${escapeSql(path)}'`)
      .toArray()) as unknown as StoredRow[];
    return rows.map(fromRow).sort((a, b) => a.ordinal - b.ordinal);
  }

  /** Vector search with metadata filters. */
  async search(
    queryVector: number[],
    filters: SearchFilters,
    limit: number,
  ): Promise<SearchResult[]> {
    const table = await this.openIfExists();
    if (!table) return [];
    const clauses: string[] = [];
    if (filters.tier) clauses.push(`tier = '${escapeSql(filters.tier)}'`);
    if (filters.source) clauses.push(`source = '${escapeSql(filters.source)}'`);
    let query = table.vectorSearch(queryVector).limit(limit * 3);
    if (clauses.length > 0) query = query.where(clauses.join(" AND "));
    const rows = (await query.toArray()) as unknown as (StoredRow & {
      _distance: number;
    })[];

    return rows
      .map((row) => ({ chunk: fromRow(row), score: 1 / (1 + row._distance) }))
      .filter((hit) => {
        const meta = hit.chunk.metadata;
        if (!filters.includeArchived && meta["status"] === "archived")
          return false;
        if (filters.client && meta["client"] !== filters.client) return false;
        if (filters.type && meta["type"] !== filters.type) return false;
        return true;
      })
      .slice(0, limit);
  }

  /** Insert or replace chunks by ID; creates the table on first use. */
  async upsert(chunks: ChunkRecord[]): Promise<void> {
    if (chunks.length === 0) return;
    const rows = chunks.map(toRow) as unknown as Record<string, unknown>[];
    const db = await this.connection();
    const names = await db.tableNames();
    if (!names.includes(TABLE)) {
      await db.createTable(TABLE, rows);
      return;
    }
    const table = await db.openTable(TABLE);
    await table
      .mergeInsert("id")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(rows);
  }

  private async connection(): Promise<Connection> {
    return connect(this.dataDir);
  }

  private async openIfExists(): Promise<Table | null> {
    const db = await this.connection();
    const names = await db.tableNames();
    return names.includes(TABLE) ? db.openTable(TABLE) : null;
  }
}
