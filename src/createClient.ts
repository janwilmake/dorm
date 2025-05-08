//@ts-check
/// <reference types="@cloudflare/workers-types" />
import { exec, DatabaseDO, RemoteSqlStorageCursor } from "./exec";

/**
 * DB Config for DORM 2.0
 *
 * @param version - Optional version to prefix your DO names
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
 * Type for ORM provider function
 */
export type OrmProviderFn<T> = (
  exec: <R extends Record<string, SqlStorageValue>>(
    sql: string,
    ...params: any[]
  ) => Promise<RemoteSqlStorageCursor<R>>,
) => T;

/**
 * Creates a client for interacting with DORM
 */
export function createClient<T extends DBConfig>(
  doNamespace: DurableObjectNamespace<DatabaseDO>,
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
    targetStub: DurableObjectStub<DatabaseDO>,
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

  /**
   * Execute SQL query in the client's DO, with mirroring support.
   */
  async function execWithMirroring<
    T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
  >(sql: string, ...params: any[]): Promise<RemoteSqlStorageCursor<T>> {
    // Initialize if needed
    if (!initialized) {
      initialized = await initializeStorage(stub);
      if (!initialized) {
        throw new Error("Failed to initialize database");
      }
    }

    // Execute query on main stub
    const cursor = exec<T>(stub, sql, ...params);

    // Execute on mirror if configured
    if (mirrorStub && doConfig?.mirrorName) {
      if (!mirrorInitialized) {
        mirrorInitialized = await initializeStorage(mirrorStub);
      }

      if (mirrorInitialized) {
        const mirrorPromise = async () => {
          for await (const item of exec(mirrorStub, sql, ...params)) {
            //do nothing, just walk it down
          }
        };

        // Use waitUntil if context provided
        if (doConfig?.ctx?.waitUntil) {
          doConfig.ctx.waitUntil(Promise.resolve(mirrorPromise));
        } else {
          // Fire and forget
          Promise.resolve(mirrorPromise).catch((err) =>
            console.error("Mirror query execution error:", err),
          );
        }
      }
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
    if (
      subPath !== "/query/raw" &&
      !subPath.startsWith("/query/raw/") &&
      subPath !== "/exec"
    ) {
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

    // Handle direct stream execution - forward to DO
    if (subPath === "/exec" && request.method === "POST") {
      try {
        // Initialize if needed
        if (!initialized) {
          initialized = await initializeStorage(stub);
          if (!initialized) {
            throw new Error("Failed to initialize database");
          }
        }

        // Forward the request directly to the DO for streaming
        // This allows the browser to use the `exec` utility function

        const response = await stub.fetch(
          //@ts-ignore
          request.clone(),
        );

        // Add CORS headers to the response
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([key, value]) => {
          headers.set(key, value);
        });

        // Return the streaming response
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Handle raw SQL query with JSON response
    if (subPath === "/query/raw" && request.method === "POST") {
      try {
        const data = (await request.json()) as {
          sql?: string;
          params?: any[];
          transaction?: { sql: string; params: any[] }[];
        };

        const sql = data.sql || data.transaction?.[0]?.sql;
        const params = data.sql ? data.params : data.transaction?.[0]?.params;

        if (!sql) {
          return new Response(JSON.stringify({ error: "Missing SQL query" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Execute the query
        const cursor = await execWithMirroring(sql, ...(params || []));

        if (cursor.error) {
          return new Response(JSON.stringify({ error: cursor.error }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Return as JSON
        const result = {
          columns: cursor.columnNames,
          rows: await cursor.toArray(),
          meta: {
            rows_read: cursor.rowsRead,
            rows_written: cursor.rowsWritten,
          },
        };

        const isTransaction = !data.sql;
        return new Response(
          JSON.stringify({ result: isTransaction ? [result] : result }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
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

        // Execute the query
        const cursor = await execWithMirroring(queryString, ...params);

        if (cursor.error) {
          return new Response(JSON.stringify({ error: cursor.error }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Return as JSON
        const result = {
          columns: cursor.columnNames,
          rows: await cursor.toArray(),
          meta: {
            rows_read: cursor.rowsRead,
            rows_written: cursor.rowsWritten,
          },
        };

        return new Response(JSON.stringify(result, undefined, 2), {
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
