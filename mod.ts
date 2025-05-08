//@ts-check
/// <reference types="@cloudflare/workers-types" />
// package name: "dormroom"

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

export class DORM extends DurableObject {
  private storage: DurableObjectStorage;
  static env: any;

  constructor(state: DurableObjectState, env: any) {
    super(state, env);
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/query/raw" && request.method === "POST") {
      return await this.handleExecRequest(request);
    }

    // Handle other endpoints...
    return new Response(String(this.storage.sql.databaseSize), { status: 404 });
  }

  handleExecRequest = async (request: Request): Promise<Response> => {
    try {
      // Parse the request body
      const { query, bindings = [] } = (await request.json()) as {
        query: string;
        bindings: any[];
      };

      if (!query || typeof query !== "string") {
        return new Response(JSON.stringify({ error: "Query is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Create a TransformStream to stream the results
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Execute the query and stream results asynchronously
      (async () => {
        try {
          // Execute the SQL query
          const cursor = this.storage.sql.exec(query, ...bindings);

          // Send column names as metadata first
          await writer.write(
            encoder.encode(
              JSON.stringify({
                metadata: { columnNames: cursor.columnNames },
              }) + "\n",
            ),
          );

          // Stream each row as it comes
          for (const row of cursor) {
            await writer.write(encoder.encode(JSON.stringify({ row }) + "\n"));
          }

          // Send final metadata with stats
          await writer.write(
            encoder.encode(
              JSON.stringify({
                metadata: {
                  rowsRead: cursor.rowsRead,
                  rowsWritten: cursor.rowsWritten,
                },
              }) + "\n",
            ),
          );
        } catch (error) {
          console.error("SQL execution error:", error);
          // Send error information
          await writer.write(
            encoder.encode(JSON.stringify({ error: error.message }) + "\n"),
          );
        } finally {
          // Always close the writer when done
          await writer.close();
        }
      })();

      // Return the readable stream immediately
      return new Response(readable, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Transfer-Encoding": "chunked",
        },
      });
    } catch (error) {
      console.error("Request handling error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  // Other methods for your Durable Object...
}

export type SqlStorageValue = ArrayBuffer | string | number | null;

export type Records = {
  [x: string]: SqlStorageValue;
};

// Client-side implementation of SqlStorageCursor
export class RemoteSqlStorageCursor<T extends Records> {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null;
  private buffer: string = "";
  private cachedResults: T[] | null = null;
  private currentIndex: number = 0;
  private _columnNames: string[] = [];
  private _rowsRead: number = 0;
  private _rowsWritten: number = 0;
  private done: boolean = false;
  private pendingChunk: Promise<
    { done?: boolean; value: T } | { done: true; value?: never }
  > | null = null;
  private pendingNextChunk: boolean = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
    // Start reading the first chunk immediately
    this.prepareNextChunk();
  }

  private prepareNextChunk(): void {
    if (this.done || this.pendingNextChunk) return;

    this.pendingNextChunk = true;
    this.pendingChunk = this.readNextChunk();
  }

  private async readNextChunk(): Promise<
    { done?: boolean; value: T } | { done: true; value?: never }
  > {
    if (this.done) {
      return { done: true };
    }

    try {
      const { done, value } = await this.reader!.read();

      if (done) {
        this.done = true;
        this.reader = null;

        // Process any remaining data in buffer
        if (this.buffer.trim()) {
          try {
            const data = JSON.parse(this.buffer) as any;
            if (data.row) {
              this._rowsRead++;
              return { value: data.row as T };
            } else if (data.metadata) {
              // Handle metadata
              this.processMetadata(data.metadata);
            }
          } catch (e) {
            console.error("Error parsing final buffer:", e);
          }
        }

        return { done: true };
      }

      // Decode and add to buffer
      const text = new TextDecoder().decode(value);
      this.buffer += text;

      // Process complete JSON objects
      const results: { value: T; done?: false }[] = [];

      // Look for complete JSON objects separated by newlines
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || ""; // Keep the last potentially incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const data = JSON.parse(line) as any;
          if (data.row) {
            this._rowsRead++;
            results.push({ value: data.row as T });
          } else if (data.metadata) {
            this.processMetadata(data.metadata);
          }
        } catch (e) {
          console.error("Error parsing JSON:", e, "Line:", line);
        }
      }

      if (results.length > 0) {
        // Reset the pending flag as we're about to return
        this.pendingNextChunk = false;
        return results[0]; // Return the first result
      } else {
        // No complete objects yet, read more
        return await this.readNextChunk();
      }
    } catch (error) {
      console.error("Error reading from stream:", error);
      this.done = true;
      return { done: true };
    }
  }

  private processMetadata(metadata: any): void {
    if (metadata.columnNames) {
      this._columnNames = metadata.columnNames;
    }
    if (metadata.rowsWritten !== undefined) {
      this._rowsWritten = metadata.rowsWritten;
    }
  }

  // This method is used for iterator protocol
  next(): Promise<{ done?: false; value: T } | { done: true }> {
    if (this.cachedResults) {
      if (this.currentIndex < this.cachedResults.length) {
        return Promise.resolve({
          value: this.cachedResults[this.currentIndex++],
        });
      }
      return Promise.resolve({ done: true });
    }

    if (!this.pendingChunk) {
      this.prepareNextChunk();
    }

    const result = this.pendingChunk!;
    this.pendingChunk = null;

    // Prepare next chunk if this wasn't the end
    result
      .then((r) => {
        if (!r.done) {
          this.prepareNextChunk();
        }
      })
      .catch((err) => {
        console.error("Error preparing next chunk:", err);
      });

    return result;
  }

  async toArray(): Promise<T[]> {
    if (this.cachedResults) {
      return this.cachedResults;
    }

    const results: T[] = [];

    // Use iterator to collect all rows
    let nextResult = await this.next();
    while (!nextResult.done) {
      results.push(nextResult.value);
      nextResult = await this.next();
    }

    this.cachedResults = results;
    return results;
  }

  async one(): Promise<T> {
    if (this.cachedResults) {
      if (this.cachedResults.length === 0) {
        throw new Error("No rows returned");
      }
      return this.cachedResults[0];
    }

    const result = await this.next();
    if (result.done || !("value" in result)) {
      throw new Error("No rows returned");
    }

    return result.value;
  }

  async *raw<U extends SqlStorageValue[]>(): AsyncIterableIterator<U> {
    let nextResult = await this.next();
    while (!nextResult.done) {
      yield Object.values(nextResult.value) as unknown as U;
      nextResult = await this.next();
    }
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

  // Make it iterable
  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return {
      //@ts-expect-error
      next: () => this.next(),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
}

// Non-async wrapper function to return cursor immediately
export function exec<T extends Records>(
  stub: any,
  query: string,
  ...bindings: any[]
): RemoteSqlStorageCursor<T> {
  // Start the fetch but don't await it
  const fetchPromise = stub.fetch(
    new Request("http://internal/query/raw", {
      method: "POST",
      body: JSON.stringify({ query, bindings }),
    }),
  );

  // Create a ReadableStream and writer that we control
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // Process the fetch in the background
  (async () => {
    try {
      const response = await fetchPromise;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SQL execution failed: ${errorText}`);
      }

      if (!response.body) {
        throw new Error("Response has no body");
      }

      // Pipe the response body to our transform stream
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
    } catch (error) {
      console.error("Error in fetch:", error);
      const encoder = new TextEncoder();
      await writer.write(
        encoder.encode(JSON.stringify({ error: error.message }) + "\n"),
      );
    } finally {
      await writer.close();
    }
  })();

  // Return cursor immediately with our controlled stream
  return new RemoteSqlStorageCursor<T>(readable);
}

/**
 * Middleware configuration options
 */
export interface MiddlewareOptions {
  secret?: string;
  prefix?: string;
}

/**
 * Type for ORM provider function
 */
export type OrmProviderFn<T> = (
  exec: <R extends Records>(
    sql: string,
    ...params: any[]
  ) => RemoteSqlStorageCursor<R>,
) => T;

/**
 * Creates a client for interacting with DORM
 * This is now an async function that initializes storage upfront
 */
export async function createClient(context: {
  doNamespace: DurableObjectNamespace<DORM>;
  version?: string;
  statements: string[];
  name?: string;
  locationHint?: DurableObjectLocationHint;
  mirrorName?: string;
  ctx?: ExecutionContext;
  mirrorLocationHint?: DurableObjectLocationHint;
}) {
  const {
    doNamespace,
    statements,
    ctx,
    locationHint,
    mirrorLocationHint,
    mirrorName,
    name,
    version,
  } = context;
  // Generate name with optional version
  const getName = (name: string = "root"): string =>
    version ? `${version}-${name}` : name;

  // Get main stub
  const stub = doNamespace.get(doNamespace.idFromName(getName(name)), {
    locationHint: locationHint,
  });

  // Get mirror stub if configured
  const mirrorStub = mirrorName
    ? doNamespace.get(doNamespace.idFromName(getName(mirrorName)), {
        locationHint: mirrorLocationHint,
      })
    : undefined;

  /**
   * Initialize storage with schema
   */
  async function initializeStorage(
    targetStub: DurableObjectStub<DORM>,
  ): Promise<boolean> {
    try {
      // Create schema_info table if not exists
      await exec(
        targetStub,
        `CREATE TABLE IF NOT EXISTS schema_info (key TEXT PRIMARY KEY, value TEXT)`,
      ).toArray();

      // Execute all schema statements
      for (const statement of statements) {
        await exec(targetStub, statement).toArray();
      }

      // Update initialization timestamp
      const timestamp = new Date().toISOString();
      await exec(
        targetStub,
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('initialized_at', ?)",
        timestamp,
      ).toArray();

      return true;
    } catch (error) {
      console.error("Schema initialization error:", error);
      return false;
    }
  }

  // Initialize main storage immediately
  const initialized = await initializeStorage(stub);
  if (!initialized) {
    throw new Error("Failed to initialize main database");
  }

  // Initialize mirror if provided
  let mirrorInitialized = false;
  if (mirrorStub) {
    if (ctx) {
      mirrorInitialized = await initializeStorage(mirrorStub);
    }
    if (!mirrorInitialized && mirrorName) {
      console.warn(`Failed to initialize mirror database: ${mirrorName}`);
      if (!ctx) {
        console.warn(`Please provide a 'ctx'`);
      }
    }
  }

  /**
   * Execute SQL query in the client's DO, with mirroring support.
   * This is now synchronous but handles mirroring in the background.
   */
  function execWithMirroring<T extends Records = Records>(
    sql: string,
    ...params: any[]
  ): RemoteSqlStorageCursor<T> {
    // Execute query on main stub
    const cursor = exec<T>(stub, sql, ...params);

    // Execute on mirror if configured and initialized
    if (mirrorStub && mirrorInitialized && ctx) {
      const mirrorPromise = async () => {
        try {
          // Execute the same query on the mirror
          for await (const _ of exec(mirrorStub, sql, ...params)) {
            // Do nothing, just ensure it's processed
          }
        } catch (error) {
          console.error("Mirror execution error:", error);
        }
      };

      // Use waitUntil if context provided, otherwise fire and forget
      ctx.waitUntil(mirrorPromise());
    }

    return cursor;
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

    const subPath = url.pathname.substring(prefix.length);

    // Check if this middleware should handle the request
    if (subPath !== "/query/raw") {
      // not this middleware
      return;
    }

    // Check authentication if a secret is provided
    if (options.secret) {
      const authHeader = request.headers.get("Authorization");
      const token = !authHeader
        ? undefined
        : authHeader.startsWith("Basic ")
        ? atob(authHeader.slice("Basic ".length))
        : authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length)
        : undefined;

      const unauthorizedHeaders = {
        ...corsHeaders,
        "Content-Type": "application/json",
        // This requests basic auth when accessed in the browser
        "WWW-Authenticate":
          'Basic realm="DORM SQL Access",' +
          'error="Invalid auth token",' +
          'error_description="Please Authorize with your basic credentials"',
      };

      if (!token) {
        return new Response(
          JSON.stringify({
            error: "Unauthorized. Please provide a Bearer or Basic auth token.",
          }),
          {
            status: 401,
            headers: unauthorizedHeaders,
          },
        );
      }

      if (token !== options.secret) {
        return new Response(
          JSON.stringify({
            error: "Unauthorized. Authorization Bearer Token Required",
          }),
          {
            status: 401,
            headers: unauthorizedHeaders,
          },
        );
      }
    }

    // Handle SQL query with appropriate response format
    if (subPath === "/query/raw" && request.method === "POST") {
      try {
        const data = (await request.json()) as {
          sql?: string;
          params?: any[];
          transaction?: { sql: string; params: any[] }[];
          skipMirror?: boolean;
        };

        const acceptHeader =
          request.headers.get("Accept") || "application/json";
        const wantsStreaming = acceptHeader.includes("application/x-ndjson");

        // Check for transactions with streaming (not supported)
        if (wantsStreaming && data.transaction) {
          return new Response(
            JSON.stringify({
              error: "Transactions are not supported with streaming responses",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        // For standard JSON responses
        if (!wantsStreaming) {
          if (data.sql) {
            // Single query
            const cursor = data.skipMirror
              ? exec(stub, data.sql, ...(data.params || []))
              : execWithMirroring(data.sql, ...(data.params || []));

            const rows = await cursor.toArray();
            const result = {
              columns: cursor.columnNames,
              rows,
              meta: {
                rows_read: cursor.rowsRead,
                rows_written: cursor.rowsWritten,
              },
            };

            return new Response(JSON.stringify({ result }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          } else if (data.transaction) {
            // Properly handle full transaction
            if (
              !Array.isArray(data.transaction) ||
              data.transaction.length === 0
            ) {
              return new Response(
                JSON.stringify({
                  error: "Invalid transaction format or empty transaction",
                }),
                {
                  status: 400,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                },
              );
            }

            // Begin transaction
            await exec(stub, "BEGIN TRANSACTION").toArray();

            const results: any[] = [];
            let success = true;

            try {
              // Execute each statement in the transaction
              for (const txQuery of data.transaction) {
                if (!txQuery || !txQuery.sql) {
                  throw new Error("Invalid transaction statement format");
                }

                const cursor = data.skipMirror
                  ? exec(stub, txQuery.sql, ...(txQuery.params || []))
                  : execWithMirroring(txQuery.sql, ...(txQuery.params || []));

                const rows = await cursor.toArray();
                results.push({
                  columns: cursor.columnNames,
                  rows,
                  meta: {
                    rows_read: cursor.rowsRead,
                    rows_written: cursor.rowsWritten,
                  },
                });
              }

              // Commit transaction on success
              await exec(stub, "COMMIT").toArray();

              // Handle mirroring of the transaction if needed
              if (!data.skipMirror && mirrorStub && mirrorInitialized && ctx) {
                const mirrorPromise = async () => {
                  try {
                    await exec(mirrorStub, "BEGIN TRANSACTION").toArray();

                    for (const txQuery of data.transaction!) {
                      await exec(
                        mirrorStub,
                        txQuery.sql,
                        ...(txQuery.params || []),
                      ).toArray();
                    }

                    await exec(mirrorStub, "COMMIT").toArray();
                  } catch (error) {
                    console.error("Mirror transaction error:", error);
                    try {
                      await exec(mirrorStub, "ROLLBACK").toArray();
                    } catch (rollbackError) {
                      console.error("Mirror rollback error:", rollbackError);
                    }
                  }
                };

                ctx.waitUntil(mirrorPromise());
              }
            } catch (error) {
              // Rollback on any error
              success = false;
              try {
                await exec(stub, "ROLLBACK").toArray();
              } catch (rollbackError) {
                console.error("Rollback error:", rollbackError);
              }
              throw error;
            }

            return new Response(
              JSON.stringify({
                result: results,
                transaction: { success },
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          } else {
            return new Response(
              JSON.stringify({ error: "Missing SQL query or transaction" }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
        }

        // For streaming responses
        if (wantsStreaming) {
          if (!data.sql) {
            return new Response(
              JSON.stringify({ error: "Missing SQL query" }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }

          // Forward the request to the DO and pipe the response directly
          const doResponse = await stub.fetch(
            new Request("http://internal/query/raw", {
              method: "POST",
              body: JSON.stringify({
                query: data.sql,
                bindings: data.params || [],
              }),
            }),
          );

          // Handle mirroring if needed
          if (!data.skipMirror && mirrorStub && mirrorInitialized && ctx) {
            const mirrorPromise = async () => {
              try {
                await exec(
                  mirrorStub,
                  data.sql!,
                  ...(data.params || []),
                ).toArray();
              } catch (error) {
                console.error("Mirror execution error in streaming:", error);
              }
            };

            ctx.waitUntil(mirrorPromise());
          }

          // Return the streaming response
          return new Response(doResponse.body, {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/x-ndjson",
              "Transfer-Encoding": "chunked",
            },
          });
        }
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error.message,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // If no matching routes, return undefined
    return undefined;
  }

  /**
   * Get database size
   */
  async function getDatabaseSize(): Promise<number> {
    return Number(
      await stub.fetch("http://internal/").then((res) => res.text()),
    );
  }

  /**
   * Get mirror database size if available
   */
  async function getMirrorDatabaseSize(): Promise<number | undefined> {
    if (mirrorStub) {
      return Number(
        await mirrorStub.fetch("http://internal/").then((res) => res.text()),
      );
    }
    return undefined;
  }

  return {
    exec: execWithMirroring,
    middleware,
    getDatabaseSize,
    getMirrorDatabaseSize,
  };
}
