//@ts-check
/// <reference types="@cloudflare/workers-types" />
// package name: "dormroom"
import { env } from "cloudflare:workers";
import { RemoteSqlStorageCursor, exec, DatabaseDO } from "remote-sql-cursor";
export { RemoteSqlStorageCursor };
export class DORM extends DatabaseDO {}

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

export type DORMClient = {
  exec: <
    T extends {
      [x: string]: SqlStorageValue;
    } = {
      [x: string]: SqlStorageValue;
    },
  >(
    sql: string,
    ...params: any[]
  ) => RemoteSqlStorageCursor<T>;
  middleware: (
    request: Request,
    options?: MiddlewareOptions,
  ) => Promise<Response | undefined>;
  getDatabaseSize: () => Promise<number>;
  getMirrorDatabaseSize: () => Promise<number | undefined>;
};

/**
 * Developer-friendly setup message for DORM users
 */
function showDeveloperMessage() {
  const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    green: "\x1b[32m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
  };

  const box = {
    topLeft: "╔",
    topRight: "╗",
    bottomLeft: "╚",
    bottomRight: "╝",
    horizontal: "═",
    vertical: "║",
  };

  const width = 70;
  const horizontalLine = box.horizontal.repeat(width - 2);

  console.log("");
  console.log(
    `${colors.cyan}${box.topLeft}${horizontalLine}${box.topRight}${colors.reset}`,
  );
  console.log(
    `${colors.cyan}${box.vertical}${colors.reset} ${colors.bright}${colors.green}🚀 DORM (Durable ORM) - Ready to Use!${colors.reset}                             ${colors.cyan}${box.vertical}${colors.reset}`,
  );
  console.log(
    `${colors.cyan}${box.vertical}${colors.reset}                                                                      ${colors.cyan}${box.vertical}${colors.reset}`,
  );
  console.log(
    `${colors.cyan}${box.vertical}${colors.reset} ${colors.bright}${colors.yellow}📊 View your data with Outerbase Studio:${colors.reset}                        ${colors.cyan}${box.vertical}${colors.reset}`,
  );
  console.log(
    `${colors.cyan}${box.vertical}${colors.reset}                                                                      ${colors.cyan}${box.vertical}${colors.reset}`,
  );
  console.log(
    `${colors.cyan}${box.vertical}${colors.reset} ${colors.bright}Local Development:${colors.reset}                                             ${colors.cyan}${box.vertical}${colors.reset}`,
  );
  console.log(
    `${colors.cyan}${box.vertical}${colors.reset}   1. Install: ${colors.blue}https://github.com/outerbase/studio${colors.reset}              ${colors.cyan}${box.vertical}${colors.reset}`,
  );
  console.log(
    `${colors.cyan}${box.vertical}${colors.reset}   2. Connect to: ${colors.magenta}http://localhost:8787/db${colors.reset}          ${colors.cyan}${box.vertical}${colors.reset}`,
  );
  console.log(
    `${colors.cyan}${box.vertical}${colors.reset}                                                                      ${colors.cyan}${box.vertical}${colors.reset}`,
  );
  console.log(
    `${colors.cyan}${box.vertical}${colors.reset} ${colors.bright}Production:${colors.reset}                                                    ${colors.cyan}${box.vertical}${colors.reset}`,
  );
  console.log(
    `${colors.cyan}${box.vertical}${colors.reset}   Use: ${colors.blue}https://studio.outerbase.com${colors.reset}                           ${colors.cyan}${box.vertical}${colors.reset}`,
  );
  console.log(
    `${colors.cyan}${box.vertical}${colors.reset}                                                                      ${colors.cyan}${box.vertical}${colors.reset}`,
  );
  console.log(
    `${colors.cyan}${box.vertical}${colors.reset} ${colors.dim}💡 Tip: Set up middleware with your desired prefix!${colors.reset}              ${colors.cyan}${box.vertical}${colors.reset}`,
  );
  console.log(
    `${colors.cyan}${box.bottomLeft}${horizontalLine}${box.bottomRight}${colors.reset}`,
  );
  console.log("");
}

// Alternative simpler message if ANSI codes are not supported
function showSimpleMessage() {
  console.log("\n========== DORM (Durable ORM) - Ready to Use! ==========");
  console.log("\n📊 View your data with Outerbase Studio:\n");
  console.log("Local Development:");
  console.log("  1. Install: https://github.com/outerbase/studio");
  console.log(`  2. Connect to: http://localhost:${env.PORT || "8787"}/db\n`);
  console.log("Production:");
  console.log("  Use: https://studio.outerbase.com\n");
  console.log("💡 Tip: Set up middleware with your desired prefix!");
  console.log("======================================================\n");
}

let hasInitialized = false;

if (!hasInitialized) {
  showSimpleMessage();
  hasInitialized = true;
}

/**
 * Creates a client for interacting with DORM
 * This is now an async function that initializes storage upfront
 */
export function createClient(context: {
  doNamespace: DurableObjectNamespace<DORM>;
  version?: string;
  migrations?: { [version: number]: string[] };
  name?: string;
  locationHint?: DurableObjectLocationHint;
  mirrorName?: string;
  ctx?: ExecutionContext;
  mirrorLocationHint?: DurableObjectLocationHint;
}): DORMClient {
  const {
    doNamespace,
    migrations,
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
   * Execute SQL query in the client's DO, with mirroring support.
   * This is now synchronous but handles mirroring in the background.
   */
  function execWithMirroring<
    T extends {
      [x: string]: SqlStorageValue;
    } = {
      [x: string]: SqlStorageValue;
    },
  >(sql: string, ...params: any[]): RemoteSqlStorageCursor<T> {
    // Execute query on main stub
    const cursor = exec<T>(stub, migrations, sql, ...params);

    // Execute on mirror if configured and initialized
    if (mirrorStub && ctx) {
      const mirrorPromise = async () => {
        try {
          // Execute the same query on the mirror
          for await (const _ of exec(mirrorStub, migrations, sql, ...params)) {
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
              ? exec(stub, migrations, data.sql, ...(data.params || []))
              : execWithMirroring(data.sql, ...(data.params || []));

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

            // Begin transaction
            //   await exec(stub, "BEGIN TRANSACTION").toArray();

            const results: any[] = [];
            let success = true;

            try {
              // Execute each statement in the transaction
              for (const txQuery of data.transaction) {
                if (!txQuery || !txQuery.sql) {
                  throw new Error("Invalid transaction statement format");
                }

                const cursor = data.skipMirror
                  ? exec(
                      stub,
                      migrations,
                      txQuery.sql,
                      ...(txQuery.params || []),
                    )
                  : execWithMirroring(txQuery.sql, ...(txQuery.params || []));

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

              // Commit transaction on success
              //  await exec(stub, "COMMIT").toArray();

              // Handle mirroring of the transaction if needed
              if (!data.skipMirror && mirrorStub && ctx) {
                const mirrorPromise = async () => {
                  try {
                    //   await exec(mirrorStub, "BEGIN TRANSACTION").toArray();

                    for (const txQuery of data.transaction!) {
                      await exec(
                        mirrorStub,
                        migrations,
                        txQuery.sql,
                        ...(txQuery.params || []),
                      ).toArray();
                    }

                    //   await exec(mirrorStub, "COMMIT").toArray();
                  } catch (error) {
                    console.error("Mirror transaction error:", error);
                    try {
                      //  await exec(mirrorStub, "ROLLBACK").toArray();
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
                //   await exec(stub, "ROLLBACK").toArray();
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
          if (!data.skipMirror && mirrorStub && ctx) {
            const mirrorPromise = async () => {
              try {
                await exec(
                  mirrorStub,
                  migrations,
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
