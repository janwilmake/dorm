declare module "DORM" {
    import { DurableObject } from "cloudflare:workers";
    export interface JSONSchema {
        type?: string | string[];
        properties?: Record<string, JSONSchema>;
        required?: string[];
        format?: string;
        additionalProperties?: boolean;
        "x-dorm-primary-key"?: boolean;
        "x-dorm-auto-increment"?: boolean;
        "x-dorm-index"?: boolean | string;
        "x-dorm-unique"?: boolean;
        "x-dorm-references"?: {
            table: string;
            column: string;
            onDelete?: "CASCADE" | "SET NULL" | "RESTRICT";
            onUpdate?: "CASCADE" | "SET NULL" | "RESTRICT";
        };
        "x-dorm-default"?: any;
        minimum?: number;
        maximum?: number;
        minLength?: number;
        maxLength?: number;
        pattern?: string;
        description?: string;
    }
    export interface TableSchema {
        $id: string;
        title?: string;
        description?: string;
        type: string;
        properties: Record<string, JSONSchema>;
        required?: string[];
        additionalProperties?: boolean;
    }
    export function jsonSchemaToSql(schema: TableSchema): string[];
    /**
     * DB Config for DORM 2.0
     *
     * @param version - Optional version to prefix your DO names
     * @param schemas - JSON schema definitions for tables
     * @param statements - Raw SQL statements to execute during initialization
     */
    export interface DBConfig {
        version?: string;
        statements: string | string[];
    }
    /**
     * Middleware configuration options
     */
    export interface MiddlewareOptions {
        secret?: string;
        prefix?: string;
    }
    /**
     * Result type for SQL queries
     */
    export interface SqlResult {
        columns: string[];
        rows: any[][];
        meta: {
            rows_read: number;
            rows_written: number;
        };
    }
    /**
     * Durable Object implementation with RPC-compatible methods
     */
    export class DORM extends DurableObject {
        sql: SqlStorage;
        constructor(state: DurableObjectState, env: any);
        getDatabaseSize(): Promise<number>;
        exec(query: string, ...bindings: any[]): Promise<SqlResult>;
        execStream(request: Request): Promise<Response>;
        fetch(request: Request): Promise<Response>;
    }
    /**
     * Client-side cursor that implements the expected SqlStorageCursor interface
     */
    export class ClientSqlCursor<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>> {
        private _columnNames;
        private _rows;
        private _rowsRead;
        private _rowsWritten;
        private _currentIndex;
        constructor(result: SqlResult);
        get columnNames(): string[];
        get rowsRead(): number;
        get rowsWritten(): number;
        raw(): Generator<any[]>;
        results(): Generator<T>;
        first(): T | null;
        next(): IteratorResult<T>;
        toArray(): T[];
        [Symbol.iterator](): Iterator<T>;
    }
    /**
     * Type for ORM provider function
     */
    export type OrmProviderFn<T> = (exec: <R extends Record<string, SqlStorageValue>>(sql: string, ...params: any[]) => Promise<ClientSqlCursor<R>>) => T;
    /**
     * Creates a client for interacting with DORM
     */
    export function createClient<T extends DBConfig>(doNamespace: DurableObjectNamespace<DORM>, dbConfig: T, doConfig?: {
        name?: string;
        locationHint?: DurableObjectLocationHint;
        mirrorName?: string;
        ctx?: ExecutionContext;
        mirrorLocationHint?: DurableObjectLocationHint;
    }): {
        exec: <T_1 extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(sql: string, ...params: any[]) => Promise<ClientSqlCursor<T_1>>;
        execStream: (sql: string, ...params: any[]) => Promise<ReadableStream>;
        middleware: (request: Request, options?: MiddlewareOptions) => Promise<Response | undefined>;
        getDatabaseSize: () => Promise<number>;
        getMirrorDatabaseSize: () => Promise<number | undefined>;
    };
}
