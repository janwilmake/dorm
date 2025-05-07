//@ts-check
// TODO: Ensure we can evaludate speed IN the DO for the query.
// Publish this as `@next` (figure out how)
/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from "cloudflare:workers";
// Simple TypeScript types for JSON Schema (no dependency)
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  format?: string;
  additionalProperties?: boolean;
  // Custom SQLite extensions
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
  // Standard JSON Schema fields we'll use
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

export function jsonSchemaToSql(schema: TableSchema): string[] {
  const columnDefinitions: string[] = [];
  const constraints: string[] = [];
  const indexStatements: string[] = [];

  // Map JSON Schema types to SQLite types
  function mapType(propSchema: JSONSchema): string {
    // Handle union types (e.g., ["string", "null"])
    const type = Array.isArray(propSchema.type)
      ? propSchema.type.find((t) => t !== "null") || "string"
      : propSchema.type || "string";

    // Map based on type and format
    if (type === "integer" || propSchema.format === "integer") return "INTEGER";
    if (type === "number") return "REAL";
    if (type === "boolean") return "BOOLEAN";
    if (type === "object" || type === "array") return "TEXT"; // Store as JSON
    if (propSchema.format === "date-time" || propSchema.format === "date")
      return "TIMESTAMP";

    // Default to TEXT for strings and anything else
    return "TEXT";
  }

  // Format default values for SQLite
  function formatDefaultValue(value: any, type: string): string {
    if (value === undefined || value === null) return "NULL";
    if (typeof value === "string") return `'${value}'`;
    if (typeof value === "object") return `'${JSON.stringify(value)}'`;
    return value.toString();
  }

  // Process each property in the schema
  for (const [propName, propSchema] of Object.entries(schema.properties)) {
    const sqliteType = mapType(propSchema);
    let columnDef = `"${propName}" ${sqliteType}`;

    // Add constraints directly to column
    if (propSchema["x-dorm-primary-key"]) {
      columnDef += " PRIMARY KEY";
      if (propSchema["x-dorm-auto-increment"] && sqliteType === "INTEGER") {
        columnDef += " AUTOINCREMENT";
      }
    }

    if (propSchema["x-dorm-unique"]) {
      columnDef += " UNIQUE";
    }

    if (schema.required?.includes(propName)) {
      columnDef += " NOT NULL";
    }

    if (propSchema["x-dorm-default"] !== undefined) {
      columnDef += ` DEFAULT ${formatDefaultValue(
        propSchema["x-dorm-default"],
        sqliteType,
      )}`;
    }

    columnDefinitions.push(columnDef);

    // Handle references (foreign keys)
    if (propSchema["x-dorm-references"]) {
      const ref = propSchema["x-dorm-references"];
      let constraintDef = `FOREIGN KEY ("${propName}") REFERENCES "${ref.table}"("${ref.column}")`;

      if (ref.onDelete) constraintDef += ` ON DELETE ${ref.onDelete}`;
      if (ref.onUpdate) constraintDef += ` ON UPDATE ${ref.onUpdate}`;

      constraints.push(constraintDef);
    }

    // Handle indexes
    if (propSchema["x-dorm-index"]) {
      const indexName =
        typeof propSchema["x-dorm-index"] === "string"
          ? propSchema["x-dorm-index"]
          : `idx_${schema.$id}_${propName}`;

      indexStatements.push(
        `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${schema.$id}"("${propName}");`,
      );
    }
  }

  // Combine column definitions and constraints
  const allDefinitions = [...columnDefinitions, ...constraints];

  // Create the final CREATE TABLE statement
  const createTableStatement = `CREATE TABLE IF NOT EXISTS "${schema.$id}" (
      ${allDefinitions.join(",\n  ")}
    );`;

  return [createTableStatement, ...indexStatements];
}

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
  public sql: SqlStorage;

  constructor(state: DurableObjectState, env: any) {
    super(state, env);
    this.sql = state.storage.sql;
  }

  // Method to get database size
  async getDatabaseSize() {
    return this.sql.databaseSize;
  }

  // Execute SQL and return serializable result
  async exec(query: string, ...bindings: any[]): Promise<SqlResult> {
    try {
      const cursor = this.sql.exec(query, ...bindings);

      return {
        columns: cursor.columnNames,
        rows: Array.from(cursor.raw()),
        meta: {
          rows_read: cursor.rowsRead,
          rows_written: cursor.rowsWritten,
        },
      };
    } catch (error) {
      throw new Error(`SQL execution error: ${error.message}`);
    }
  }

  // Execute SQL and return as a stream (for larger datasets)
  async execStream(request: Request): Promise<Response> {
    try {
      const data = (await request.json()) as { sql: string; params?: any[] };

      if (!data.sql) {
        return new Response(JSON.stringify({ error: "Missing SQL query" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const cursor = this.sql.exec(data.sql, ...(data.params || []));
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        start(controller) {
          try {
            // Send column names first
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "columns",
                  data: cursor.columnNames,
                }) + "\n",
              ),
            );

            // Stream each row
            for (const row of cursor.raw()) {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    type: "row",
                    data: row,
                  }) + "\n",
                ),
              );
            }

            // Send meta information
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "meta",
                  data: {
                    rows_read: cursor.rowsRead,
                    rows_written: cursor.rowsWritten,
                  },
                }) + "\n",
              ),
            );

            controller.close();
          } catch (error) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "error",
                  error: error.message,
                }) + "\n",
              ),
            );
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson" },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // HTTP handler for the Durable Object
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle streaming SQL execution
    if (path === "/exec-stream" && request.method === "POST") {
      return await this.execStream(request);
    }

    // For other paths, return a 404
    return new Response("Not found", { status: 404 });
  }
}

/**
 * Client-side cursor that implements the expected SqlStorageCursor interface
 */
export class ClientSqlCursor<
  T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
> {
  private _columnNames: string[];
  private _rows: any[][];
  private _rowsRead: number;
  private _rowsWritten: number;
  private _currentIndex: number = 0;

  constructor(result: SqlResult) {
    this._columnNames = result.columns;
    this._rows = result.rows;
    this._rowsRead = result.meta.rows_read;
    this._rowsWritten = result.meta.rows_written;
  }

  get columnNames(): string[] {
    return this._columnNames;
  }

  get rowsRead(): number {
    return this._rowsRead;
  }

  get rowsWritten(): number {
    return this._rowsWritten;
  }

  *raw(): Generator<any[]> {
    for (const row of this._rows) {
      yield row;
    }
  }

  *results(): Generator<T> {
    for (const row of this._rows) {
      const result = {} as T;
      for (let i = 0; i < this._columnNames.length; i++) {
        const columnName = this._columnNames[i];
        //@ts-ignore
        result[columnName] = row[i];
      }
      yield result;
    }
  }

  first(): T | null {
    if (this._rows.length === 0) {
      return null;
    }

    const result = {} as T;
    for (let i = 0; i < this._columnNames.length; i++) {
      const columnName = this._columnNames[i];
      //@ts-ignore

      result[columnName] = this._rows[0][i];
    }
    return result;
  }

  next(): IteratorResult<T> {
    if (this._currentIndex >= this._rows.length) {
      return { done: true, value: undefined };
    }

    const row = this._rows[this._currentIndex++];
    const result = {} as T;
    for (let i = 0; i < this._columnNames.length; i++) {
      const columnName = this._columnNames[i];
      //@ts-ignore

      result[columnName] = row[i];
    }

    return {
      done: false,
      value: result,
    };
  }

  toArray(): T[] {
    return Array.from(this.results());
  }

  [Symbol.iterator](): Iterator<T> {
    return {
      next: () => this.next(),
    };
  }
}

/**
 * Type for ORM provider function
 */
export type OrmProviderFn<T> = (
  exec: <R extends Record<string, SqlStorageValue>>(
    sql: string,
    ...params: any[]
  ) => Promise<ClientSqlCursor<R>>,
) => T;

/**
 * Creates a client for interacting with DORM
 */
export function createClient<T extends DBConfig>(
  doNamespace: DurableObjectNamespace<DORM>,
  dbConfig: T,
  doConfig?: {
    name?: string;
    locationHint?: DurableObjectLocationHint;
    mirrorName?: string;
    ctx?: ExecutionContext;
    mirrorLocationHint?: DurableObjectLocationHint;
  },
) {
  // Generate name with optional version
  const getName = (name: string = "root"): string =>
    dbConfig.version ? `${dbConfig.version}-${name}` : name;

  // Get main stub
  const stub = doNamespace.get(
    doNamespace.idFromName(getName(doConfig?.name)),
    { locationHint: doConfig?.locationHint },
  );

  // Get mirror stub if configured
  const mirrorStub = doConfig?.mirrorName
    ? doNamespace.get(doNamespace.idFromName(getName(doConfig.mirrorName)), {
        locationHint: doConfig?.mirrorLocationHint,
      })
    : undefined;

  // Initialization state tracking
  let initialized = false;
  let mirrorInitialized = false;

  // Prepare SQL statements from schemas and raw statements
  const statements = Array.isArray(dbConfig.statements)
    ? dbConfig.statements
    : [dbConfig.statements];

  /**
   * Initialize storage with schema
   */
  async function initializeStorage(
    targetStub: DurableObjectStub<DORM>,
  ): Promise<boolean> {
    try {
      // Create schema_info table if not exists
      await targetStub.exec(`
        CREATE TABLE IF NOT EXISTS schema_info (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `);

      // Execute all schema statements
      for (const statement of statements) {
        await targetStub.exec(statement);
      }

      // Update initialization timestamp
      const timestamp = new Date().toISOString();
      await targetStub.exec(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('initialized_at', ?)",
        timestamp,
      );

      return true;
    } catch (error) {
      console.error("Schema initialization error:", error);
      return false;
    }
  }

  /** Execute SQL query in the client's DO, with mirroring support. */
  async function exec<
    T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
  >(sql: string, ...params: any[]): Promise<ClientSqlCursor<T>> {
    // Initialize if needed
    if (!initialized) {
      initialized = await initializeStorage(stub);
      if (!initialized) {
        throw new Error("Failed to initialize database");
      }
    }

    // Execute query on main stub
    const result = await stub.exec(sql, ...params);
    //@ts-ignore
    const cursor = new ClientSqlCursor<T>(result);

    // Execute on mirror if configured
    if (mirrorStub && doConfig?.mirrorName) {
      if (!mirrorInitialized) {
        mirrorInitialized = await initializeStorage(mirrorStub);
      }

      if (mirrorInitialized) {
        const mirrorPromise = mirrorStub.exec(sql, ...params);

        // Use waitUntil if context provided
        if (doConfig?.ctx?.waitUntil) {
          doConfig.ctx.waitUntil(Promise.resolve(mirrorPromise));
        } else {
          // Fire and forget
          await Promise.resolve(mirrorPromise).catch((err) =>
            console.error("Mirror query execution error:", err),
          );
        }
      }
    }

    return cursor;
  }

  /**
   * Execute a query and stream the results
   */
  async function execStream(
    sql: string,
    ...params: any[]
  ): Promise<ReadableStream> {
    // Initialize if needed
    if (!initialized) {
      initialized = await initializeStorage(stub);
      if (!initialized) {
        throw new Error("Failed to initialize database");
      }
    }

    // Create streaming request
    const req = new Request("https://internal-rpc/exec-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });

    const response = await stub.fetch(req);

    if (!response.ok) {
      const error: any = await response.json();
      throw new Error(
        `Stream execution error: ${error.error || "Unknown error"}`,
      );
    }

    return response.body!;
  }

  /**
   * HTTP middleware for database access
   */
  async function middleware(
    request: Request,
    options: MiddlewareOptions = {},
  ): Promise<Response | undefined> {
    const url = new URL(request.url);
    const prefix = options.prefix || "/db";

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
      "Access-Control-Max-Age": "86400",
    };

    // Handle preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Check authentication if a secret is provided
    if (options.secret) {
      const authHeader = request.headers.get("Authorization");
      if (authHeader !== `Bearer ${options.secret}`) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Extract subpath
    const subPath = url.pathname.substring(prefix.length);

    // Check if streaming is requested
    const acceptHeader = request.headers.get("Accept") || "";
    const wantsStream = acceptHeader.includes("application/x-ndjson");

    // Handle raw SQL query
    if (subPath === "/query/raw" && request.method === "POST") {
      try {
        const data = (await request.json()) as { sql: string; params?: any[] };

        if (!data.sql) {
          return new Response(JSON.stringify({ error: "Missing SQL query" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Use stream if requested
        if (wantsStream) {
          const stream = await execStream(data.sql, ...(data.params || []));

          return new Response(stream, {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/x-ndjson",
            },
          });
        }

        // Otherwise use standard exec
        const cursor = await exec(data.sql, ...(data.params || []));

        // Return as JSON
        const result = {
          columns: cursor.columnNames,
          rows: Array.from(cursor.raw()),
          meta: {
            rows_read: cursor.rowsRead,
            rows_written: cursor.rowsWritten,
          },
        };

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Handle GET interface for raw SQL
    if (subPath.startsWith("/query/raw/") && request.method === "GET") {
      try {
        const queryString = decodeURIComponent(
          subPath.substring("/query/raw/".length),
        );
        const params: string[] = [];

        // Extract parameters from URL query params
        for (const [key, value] of url.searchParams.entries()) {
          if (key === "params") {
            params.push(value);
          }
        }

        // Use stream if requested
        if (wantsStream) {
          const stream = await execStream(queryString, ...params);

          return new Response(stream, {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/x-ndjson",
            },
          });
        }

        // Otherwise use standard exec
        const cursor = await exec(queryString, ...params);

        // Return as JSON
        const result = {
          columns: cursor.columnNames,
          rows: Array.from(cursor.raw()),
          meta: {
            rows_read: cursor.rowsRead,
            rows_written: cursor.rowsWritten,
          },
        };

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // If no matching routes, return undefined
    return undefined;
  }

  /**
   * Get database size
   */
  async function getDatabaseSize(): Promise<number> {
    return stub.getDatabaseSize();
  }

  /**
   * Get mirror database size if available
   */
  async function getMirrorDatabaseSize(): Promise<number | undefined> {
    if (mirrorStub) {
      return mirrorStub.getDatabaseSize();
    }
    return undefined;
  }

  return {
    exec,
    execStream,
    middleware,
    getDatabaseSize,
    getMirrorDatabaseSize,
  };
}
