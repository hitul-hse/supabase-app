declare module "pg" {
  export interface QueryResultRow {
    [column: string]: unknown;
  }

  export interface QueryResult<T extends QueryResultRow = QueryResultRow> {
    rows: T[];
    rowCount: number | null;
  }

  export interface PoolConfig {
    connectionString?: string;
    ssl?: { rejectUnauthorized?: boolean };
    max?: number;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<T>>;
  }
}

declare module "pg" {
  /**
   * Single connection, for work that needs a transaction to span statements.
   * Pool.query above hands each statement to whichever connection is free, so
   * begin/commit through it is a lie; Client is the honest tool. Added for the
   * factorial identity queue, same minimal-surface approach as Pool.
   */
  export class Client {
    constructor(config?: PoolConfig);
    connect(): Promise<void>;
    end(): Promise<void>;
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<T>>;
  }
}
