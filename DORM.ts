/// <reference types="@cloudflare/workers-types" />
//@ts-check

import { jsonSchemaToSql, TableSchema } from "./jsonSchemaToSql";

/**
 * DB Config
 *
 * - Put a version to prefix your DO names. this won't delete previous versions, but they will not be accessible anymore through this ORM
 * - either use schemas, statements, or both to define your tables.
 * - put a secret to make the database accessible only with this authorization header
 */
export interface DBConfig {
  version?: string;
  schemas?: TableSchema[];
  statements?: string | string[];
  authSecret?: string;
}

// Middleware options
export interface MiddlewareOptions {
  secret?: string;
  prefix?: string;
}

// Query options for individual queries
interface QueryOptions {
  isRaw?: boolean;
  isTransaction?: boolean;
}

// Define specific return types based on raw vs regular format
type RawQueryResult = {
  columns: string[];
  rows: any[][];
  meta: {
    rows_read: number;
    rows_written: number;
  };
};

type ArrayQueryResult<T = Record<string, any>> = T[];

// Type that depends on isRaw parameter
type QueryResponseType<T extends QueryOptions> = T["isRaw"] extends true
  ? RawQueryResult
  : ArrayQueryResult;

interface QueryResult<T> {
  json: T | null;
  status: number;
  ok: boolean;
}

// Helper to generate DO name with version
function getNameWithVersion(name: string = "root", version?: string): string {
  return version ? `${version}-${name}` : name;
}

// Get CORS headers for responses
function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-Starbase-Source, X-Data-Source",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * factory function that returns:
 * - the query function for raw queries
 * - the middleware to perform raw queries over api
 * - (TODO) - orm functionality
 */
export function createDBClient<T extends DBConfig>(
  doNamespace: DurableObjectNamespace,
  config: T,
  name?: string,
) {
  const nameWithVersion = getNameWithVersion(name, config.version);
  const id = doNamespace.idFromName(nameWithVersion);
  const obj = doNamespace.get(id);
  let initialized = false;

  // Convert schema to array if it's a string
  const statementsSql = Array.isArray(config.statements)
    ? config.statements
    : config.statements
    ? [config.statements]
    : [];

  const schemaSql =
    config.schemas
      ?.map((schema) => {
        const { createTableStatement, indexStatements } =
          jsonSchemaToSql(schema);
        return [createTableStatement, ...indexStatements];
      })
      .flat() || [];

  const schema = statementsSql.concat(schemaSql);

  // The query function returned by the factory
  async function query<O extends QueryOptions>(
    sql: string,
    options?: O,
    ...params: any[]
  ): Promise<QueryResult<QueryResponseType<O>>> {
    try {
      // Initialize if not already done
      if (!initialized) {
        const initResponse = await obj.fetch("https://dummy-url/init", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ schema }),
        });

        if (!initResponse.ok) {
          return {
            json: null,
            status: initResponse.status,
            ok: false,
          };
        }

        initialized = true;
      }

      // Format the request based on whether we want a transaction or a single query
      const body = options?.isTransaction
        ? JSON.stringify({
            transaction: [{ sql, params }],
          })
        : JSON.stringify({
            sql,
            params,
            isRaw: options?.isRaw,
          });

      // Determine the appropriate endpoint based on format
      const endpoint = options?.isRaw ? "/query/raw" : "/query";

      const response = await obj.fetch(`https://dummy-url${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      });

      if (!response.ok) {
        return {
          json: null,
          status: response.status,
          ok: false,
        };
      }

      const responseData: any = await response.json();

      const result =
        options?.isRaw && responseData.result
          ? responseData.result
          : responseData;

      return {
        json: result as QueryResponseType<O>,
        status: response.status,
        ok: true,
      };
    } catch (error) {
      console.error(`Error querying state: ${error}`);
      return {
        json: null,
        status: 500,
        ok: false,
      };
    }
  }

  // Middleware function to handle HTTP requests
  async function middleware(
    request: Request,
    options: MiddlewareOptions = {},
  ): Promise<Response | undefined> {
    const url = new URL(request.url);
    const prefix = options.prefix || "/db";

    // Check if the request path starts with the prefix
    if (!url.pathname.startsWith(prefix)) {
      return undefined; // Not handled by this middleware
    }

    // Handle CORS preflight request
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(),
      });
    }

    // Check authentication if a secret is provided
    if (options.secret) {
      const authHeader = request.headers.get("Authorization");
      const expectedHeader = `Bearer ${options.secret}`;

      if (!authHeader || authHeader !== expectedHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: {
            ...getCorsHeaders(),
            "Content-Type": "application/json",
          },
        });
      }
    }

    // Extract the sub-path
    const subPath = url.pathname.substring(prefix.length);

    // Initialize the database if needed
    if (subPath === "/init" && request.method === "POST") {
      // Initialize if not already done
      if (!initialized) {
        const initResponse = await obj.fetch("https://dummy-url/init", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ schema }),
        });

        if (!initResponse.ok) {
          return new Response(
            JSON.stringify({ error: "Initialization failed" }),
            {
              status: initResponse.status,
              headers: {
                ...getCorsHeaders(),
                "Content-Type": "application/json",
              },
            },
          );
        }

        initialized = true;
        return new Response(JSON.stringify({ initialized: true }), {
          headers: {
            ...getCorsHeaders(),
            "Content-Type": "application/json",
          },
        });
      }
    }

    // Handle raw SQL query
    if (subPath === "/query/raw" && request.method === "POST") {
      try {
        const data = (await request.json()) as any;
        let result;

        // Handle transaction if present
        if (data.transaction) {
          const queryOptions: QueryOptions = {
            isRaw: true,
            isTransaction: true,
          };
          const result = await query(
            data.transaction[0].sql,
            queryOptions,
            ...(data.transaction[0].params || []),
          );

          return new Response(JSON.stringify({ result: result.json }), {
            status: result.status,
            headers: {
              ...getCorsHeaders(),
              "Content-Type": "application/json",
            },
          });
        } else {
          // Single query
          const queryOptions: QueryOptions = {
            isRaw: true,
            isTransaction: false,
          };
          const result = await query(
            data.sql,
            queryOptions,
            ...(data.params || []),
          );

          return new Response(JSON.stringify({ result: result.json }), {
            status: result.status,
            headers: {
              ...getCorsHeaders(),
              "Content-Type": "application/json",
            },
          });
        }
      } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: {
            ...getCorsHeaders(),
            "Content-Type": "application/json",
          },
        });
      }
    }

    // Handle SQL query
    if (subPath === "/query" && request.method === "POST") {
      try {
        const data = (await request.json()) as {
          sql: string;
          params?: any[];
          isRaw?: boolean;
          isTransaction?: boolean;
        };

        if (!data.sql) {
          return new Response(JSON.stringify({ error: "Missing SQL query" }), {
            status: 400,
            headers: {
              ...getCorsHeaders(),
              "Content-Type": "application/json",
            },
          });
        }

        const queryOptions: QueryOptions = {
          isRaw: data.isRaw || false,
          isTransaction: data.isTransaction || false,
        };

        const result = await query(
          data.sql,
          queryOptions,
          ...(data.params || []),
        );

        return new Response(JSON.stringify(result.json), {
          status: result.status,
          headers: {
            ...getCorsHeaders(),
            "Content-Type": "application/json",
          },
        });
      } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: {
            ...getCorsHeaders(),
            "Content-Type": "application/json",
          },
        });
      }
    }

    // If we get here, the path wasn't recognized
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: {
        ...getCorsHeaders(),
        "Content-Type": "application/json",
      },
    });
  }

  return {
    query,
    middleware,
  };
}

// Durable Object implementation with Browsable compatibility
export class DORM {
  private state: DurableObjectState;
  public sql: SqlStorage; // Public for Browsable compatibility
  private initialized: boolean = false;

  // CORS headers for responses
  private corsHeaders = getCorsHeaders();

  constructor(state: DurableObjectState) {
    this.state = state;
    this.sql = state.storage.sql;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight request
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: this.corsHeaders,
      });
    }

    // Handle schema initialization
    if (path === "/init" && request.method === "POST") {
      try {
        const { schema } = (await request.json()) as {
          schema: string[];
        };

        // Create schema_info table if not exists
        this.sql.exec(`
          CREATE TABLE IF NOT EXISTS schema_info (
            key TEXT PRIMARY KEY,
            value TEXT
          )
        `);

        // Execute all schema statements
        for (const statement of schema) {
          this.sql.exec(statement);
        }

        // Update initialization timestamp
        const timestamp = new Date().toISOString();
        this.sql.exec(
          "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('initialized_at', ?)",
          timestamp,
        );

        this.initialized = true;

        return new Response(JSON.stringify({ initialized_at: timestamp }), {
          headers: {
            ...this.corsHeaders,
            "Content-Type": "application/json",
          },
        });
      } catch (error: any) {
        console.error("Schema initialization error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: {
            ...this.corsHeaders,
            "Content-Type": "application/json",
          },
        });
      }
    }

    // Standard query endpoint
    if (path === "/query" && request.method === "POST") {
      try {
        const {
          sql,
          params = [],
          isRaw = false,
        } = (await request.json()) as {
          sql: string;
          params?: any[];
          isRaw?: boolean;
        };

        // Execute the query
        const cursor = this.sql.exec(sql, ...params);

        // Return the appropriate format
        const result = isRaw
          ? {
              rows: Array.from(cursor.raw()),
              columns: cursor.columnNames,
              meta: {
                rows_read: cursor.rowsRead,
                rows_written: cursor.rowsWritten,
              },
            }
          : cursor.toArray();

        return new Response(JSON.stringify(result), {
          headers: {
            ...this.corsHeaders,
            "Content-Type": "application/json",
          },
        });
      } catch (error: any) {
        console.error("SQL execution error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: {
            ...this.corsHeaders,
            "Content-Type": "application/json",
          },
        });
      }
    }

    // Raw query endpoint (Browsable compatible)
    if (path === "/query/raw" && request.method === "POST") {
      try {
        const data = (await request.json()) as any;
        let result;

        // Handle transaction if present
        if (data.transaction) {
          const results: RawQueryResult[] = [];
          for (const query of data.transaction) {
            const cursor = this.sql.exec(query.sql, ...(query.params || []));
            results.push({
              columns: cursor.columnNames,
              rows: Array.from(cursor.raw()),
              meta: {
                rows_read: cursor.rowsRead,
                rows_written: cursor.rowsWritten,
              },
            });
          }
          result = results;
        } else {
          // Single query
          const cursor = this.sql.exec(data.sql, ...(data.params || []));
          result = {
            columns: cursor.columnNames,
            rows: Array.from(cursor.raw()),
            meta: {
              rows_read: cursor.rowsRead,
              rows_written: cursor.rowsWritten,
            },
          };
        }

        return new Response(JSON.stringify({ result }), {
          headers: {
            ...this.corsHeaders,
            "Content-Type": "application/json",
          },
        });
      } catch (error: any) {
        console.error("SQL execution error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: {
            ...this.corsHeaders,
            "Content-Type": "application/json",
          },
        });
      }
    }

    return new Response("Not found", { status: 404 });
  }
}
