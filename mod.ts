//@ts-check
/// <reference types="@cloudflare/workers-types" />
import { RemoteSqlStorageCursor, SqlStorageRow, exec } from "remote-sql-cursor";
import { getMultiStub, getStubs, MultiStubConfig } from "multistub";
import { multistubQuery } from "multistub-query";
// Simple TypeScript types for JSON Schema (no dependency)
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  format?: string;
  enum?: string[];
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

export type SqlStorageValue = ArrayBuffer | string | number | null;

export type Records = {
  [x: string]: SqlStorageValue;
};

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
  exec: <
    R extends {
      [x: string]: SqlStorageValue;
    },
  >(
    sql: string,
    ...params: any[]
  ) => RemoteSqlStorageCursor<R>,
) => T;

export type DORMClient<T extends Rpc.DurableObjectBranded> = {
  /** Remote SQL query that executes any query in both your main DO and the mirror */
  exec: <T extends SqlStorageRow>(
    sql: string,
    ...params: any[]
  ) => RemoteSqlStorageCursor<T>;
  /** A stub linked to both your main DO and mirror DO for executing any RPC function on both and retrieving the response only from the first */
  stub: DurableObjectStub<T>;
  /** Middleware to expose exec to be browsable (e.g. for Outerbase) */
  middleware: (
    request: Request,
    options?: MiddlewareOptions,
  ) => Promise<Response | undefined>;
};

/**
 * Creates a client for interacting with DORM
 * This is now an async function that initializes storage upfront
 */
export function createClient<T extends Rpc.DurableObjectBranded>(context: {
  doNamespace: DurableObjectNamespace<T>;
  ctx: ExecutionContext;
  configs: MultiStubConfig[];
}): DORMClient<T> {
  const { doNamespace, ctx, configs } = context;
  if (!configs || configs.length === 0) {
    throw new Error("At least one DO configuration is required");
  }
  const multistub = getMultiStub<T>(doNamespace, configs, ctx);
  const [mainStub, ...mirrorStubs] = getStubs(doNamespace, configs);
  const execWithMirroring = <T extends SqlStorageRow>(
    sql: string,
    ...params: any[]
  ) => multistubQuery<T>(doNamespace, ctx, configs, sql, ...params);

  /**
   * HTTP middleware for database access.
   *
   * NB: although it's async you can safely insert this as the async part only applies in the /query/raw endpoint
   */
  async function middleware(
    request: Request,
    options: MiddlewareOptions = {},
  ): Promise<Response | undefined> {
    const url = new URL(request.url);
    const prefix = options.prefix || "/db";

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, X-Starbase-Source, X-Data-Source",
      "Access-Control-Max-Age": "86400",
    } as const;

    // Handle preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const subPath = url.pathname.substring(prefix.length);

    // Check if this middleware should handle the request
    if (subPath !== "/query/raw" && subPath !== "/query/stream") {
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

    if (subPath === "/query/stream" && request.method === "POST") {
      const data = (await request.json()) as {
        sql?: string;
        params?: any[];
        transaction?: { sql: string; params: any[] }[];
        skipMirror?: boolean;
      };
      // Check for transactions with streaming (not supported)
      if (data.transaction) {
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

      // For streaming responses
      if (!data.sql) {
        return new Response(JSON.stringify({ error: "Missing SQL query" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Forward the request to the DO and pipe the response directly
      const doResponse = await mainStub.fetch(
        new Request("http://internal/query/stream", {
          method: "POST",
          body: JSON.stringify({
            query: data.sql,
            bindings: data.params || [],
          }),
        }),
      );

      // Handle mirroring if needed
      if (!data.skipMirror && mirrorStubs.length > 0 && ctx) {
        const mirrorPromise = async () => {
          try {
            await Promise.all(
              mirrorStubs.map(async (mirrorStub) => {
                try {
                  await exec(
                    mirrorStub,
                    data.sql!,
                    ...(data.params || []),
                  ).toArray();
                } catch (error) {
                  console.error("Mirror execution error in streaming:", error);
                }
              }),
            );
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

    // Handle SQL query with appropriate response format
    // TODO: Potentially can be replaced by Browsable to stay 1:1 with Cloudflare Outerbase Implementation/standard
    if (subPath === "/query/raw" && request.method === "POST") {
      try {
        const data = (await request.json()) as {
          sql?: string;
          params?: any[];
          transaction?: { sql: string; params: any[] }[];
        };

        // For standard JSON responses
        if (data.sql) {
          // Single query
          const cursor = execWithMirroring(data.sql, ...(data.params || []));

          const rows = Array.from(await cursor.raw());

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

          const results: any[] = [];
          let success = true;

          try {
            // Execute each statement in the transaction
            for (const txQuery of data.transaction) {
              if (!txQuery || !txQuery.sql) {
                throw new Error("Invalid transaction statement format");
              }

              const cursor = execWithMirroring(
                txQuery.sql,
                ...(txQuery.params || []),
              );

              const rows = Array.from(await cursor.raw());

              results.push({
                columns: cursor.columnNames,
                rows,
                meta: {
                  rows_read: cursor.rowsRead,
                  rows_written: cursor.rowsWritten,
                },
              });
            }

            // Handle mirroring of the transaction if needed
            if (mirrorStubs.length > 0 && ctx) {
              const mirrorPromise = async () => {
                try {
                  await Promise.all(
                    mirrorStubs.map(async (mirrorStub) => {
                      try {
                        for (const txQuery of data.transaction!) {
                          await exec(
                            mirrorStub,
                            txQuery.sql,
                            ...(txQuery.params || []),
                          ).toArray();
                        }
                      } catch (error) {
                        console.error("Mirror transaction error:", error);
                      }
                    }),
                  );
                } catch (error) {
                  console.error("Mirror transaction error:", error);
                }
              };

              ctx.waitUntil(mirrorPromise());
            }
          } catch (error) {
            // Rollback on any error
            success = false;
            throw error;
          }

          return new Response(
            JSON.stringify({ result: results, transaction: { success } }),
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
      } catch (error: any) {
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

  return {
    stub: multistub,
    exec: execWithMirroring,
    middleware,
  };
}
