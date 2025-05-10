/**
 * DORM (Durable Object Relational Mapping) TODO Application
 *
 * A simple, user-friendly demo of DORM capabilities using a TODO application.
 *
 * This template demonstrates:
 * - Easy database creation with JSON Schema
 * - Multi-tenant database support
 * - Streaming query results
 * - Simple REST API with query parameter-based operations
 * - Data mirroring to an aggregate database
 * - Integration with Outerbase for data exploration
 *
 *
 */

import {
  createClient,
  DORM,
  DORMClient,
  jsonSchemaToSql,
  TableSchema,

  /*
//Represents a value that can be stored in the SQLite database
export type SqlStorageValue = ArrayBuffer | string | number | null;

//Base interface for database records
export type Records = {
  [x: string]: SqlStorageValue;
};

//A cursor for remotely accessing SQL query results
export interface RemoteSqlStorageCursor<T extends Records = Records> {
  // Get all query results as an array
  toArray(): Promise<T[]>;
  // Get the first query result, or throw if no results
  one(): Promise<T>;
 // Get raw values as iterable
  raw<U extends SqlStorageValue[]>(): Promise<Iterable<U>>;
  // Column names from the query
  readonly columnNames: string[];
  // Number of rows read by the query
  readonly rowsRead: number;
  // Number of rows written by the query (for INSERT/UPDATE/DELETE)
  readonly rowsWritten: number;
  // Get the next result from the cursor
  next(): Promise<{ done?: false; value: T } | { done: true }>;
  //Async iterator implementation
  [Symbol.asyncIterator](): AsyncIterableIterator<T>;
}
  */
  type Records,
  // NB: package name is: "dormroom" when installing as package
} from "./mod";

// Ensure to export your DO for it to be accessible
export { DORM };

export interface Env {
  DORM_NAMESPACE: DurableObjectNamespace<DORM>;
  // Optional environment variable for database authentication
  DB_SECRET?: string;
}

// Either use interface extending records or just use a bare type (without extending) to ensure type-safety
interface Todo extends Records {
  id: string;
  text: string;
  // SQLite doesn't have native boolean, so we use 0/1
  completed: number;
  created_at: string;
  tenant_id: string;
}

interface Tenant extends Records {
  id: string;
}

// JSON Schema definition for tenants table
const tenantSchema: TableSchema = {
  $id: "tenants", // Table name
  type: "object",
  properties: {
    id: {
      type: "string",
      "x-dorm-primary-key": true, // Primary key constraint
    },
  },
  required: ["id"], // NOT NULL constraints
};

// JSON Schema definition for Todo table
const todoSchema: TableSchema = {
  $id: "todos", // Table name
  type: "object",
  properties: {
    id: {
      type: "string",
      "x-dorm-primary-key": true, // Primary key constraint
    },
    text: {
      type: "string",
      maxLength: 500,
    },
    completed: {
      type: "integer",
      "x-dorm-default": 0,
    },
    created_at: {
      type: "string",
      format: "date-time",
    },
    tenant_id: {
      type: "string",
    },
  },
  required: ["id", "text", "tenant_id"], // NOT NULL constraints
};

// Convert JSON schema to SQL statements
const todoSqlStatements = jsonSchemaToSql(todoSchema);
const tenantSqlStatements = jsonSchemaToSql(tenantSchema);

// All SQL statements for database initialization
const initStatements = [...tenantSqlStatements, ...todoSqlStatements];

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const pathSegments = path
      .split("/")
      .filter((segment) => segment.length > 0);

    // Error if no tenant is provided in the path
    if (pathSegments.length === 0) {
      return new Response(
        JSON.stringify(
          {
            error:
              "No tenant specified. Please use /{tenantId} to specify a tenant.",
            example: "/default - for default tenant",
          },
          null,
          2,
        ),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    try {
      // Get tenant ID from the first segment of the path
      const tenantId = pathSegments[0];

      const connection =
        tenantId === "aggregate"
          ? // Show the aggregate DB. Warning: Writes won't be mirrored to tenant dbs for this connection
            { name: "aggregate" }
          : {
              // Shard by tenant ID
              name: `tenant:${tenantId}`,
              // Query execution mirroring to a central aggregate database.
              mirrorName: "aggregate",
            };

      // Create a database client for the specified tenant
      const client: DORMClient = await createClient({
        doNamespace: env.DORM_NAMESPACE,
        version: "v2", // Version prefix for migrations
        statements: initStatements, // Initialize with our schema
        ctx: ctx, // Pass execution context for waitUntil
        ...connection,
      });

      // Ensure tenant exists in the tenants table
      if (tenantId !== "aggregate") {
        await client
          .exec("INSERT OR IGNORE INTO tenants (id) VALUES (?)", tenantId)
          .toArray();
      }

      // Handle database REST API access (needed for Outerbase integration)
      // Explore your database by adding it in the studio at: https://studio.outerbase.com/local/new-base/starbase?url=https://dorm.username.workers.dev/default/api/db&type=internal&access-key=my-secret-key
      if (path.startsWith(`/${tenantId}/api/db`)) {
        const middlewareResponse = await client.middleware(request, {
          prefix: `/${tenantId}/api/db`,
          // Optional authentication secret
          secret: env.DB_SECRET || "my-secret-key", // Default to "my-secret-key" if not provided
        });

        if (middlewareResponse) {
          return middlewareResponse;
        }
      }

      // Extract the subpath (path without tenant)
      const subPath =
        pathSegments.length > 1 ? "/" + pathSegments.slice(1).join("/") : "/";

      // If subPath is specifically /stats or /api/db, handle those routes
      if (subPath === "/stats") {
        // Get database size
        const dbSize = await client.getDatabaseSize();

        // Get mirror database size if available
        const mirrorSize = await client.getMirrorDatabaseSize();

        // Get tenant info
        const tenantInfo = await client
          .exec<{ tenant_id: string; todos_count: number }>(
            `SELECT ? as tenant_id, COUNT(*) as todos_count FROM todos WHERE tenant_id = ?`,
            tenantId,
            tenantId,
          )
          .one();

        return new Response(
          JSON.stringify(
            {
              tenant: tenantId,
              dbSize: `${(dbSize / 1024 / 1024).toFixed(2)} MB`,
              mirrorSize: mirrorSize
                ? `${(mirrorSize / 1024 / 1024).toFixed(2)} MB`
                : "N/A",
              tenantInfo,
            },
            null,
            2,
          ),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      if (tenantId === "aggregate") {
        return new Response("Not allowed", { status: 401 });
      }

      // Stream todos as a pure JSON array (for API use)
      if (subPath === "/todos") {
        // Create a TransformStream to stream results
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // Process in background
        ctx.waitUntil(
          (async () => {
            try {
              // NB: client.exec is sync, and returns the cursor immediately, but ensure to apply a function or iterate over the cursor, for the query to be executed.
              const cursor = client.exec<Todo>(
                "SELECT * FROM todos WHERE tenant_id = ? ORDER BY created_at DESC",
                tenantId,
              );

              // Write opening JSON array bracket
              await writer.write(encoder.encode("["));

              let first = true;
              // Stream each todo as it comes
              for await (const todo of cursor) {
                if (!first) await writer.write(encoder.encode(","));
                await writer.write(encoder.encode(JSON.stringify(todo)));
                first = false;
              }

              // Write closing JSON bracket
              await writer.write(encoder.encode("]"));
            } catch (error) {
              console.error("Streaming error:", error);
              // Write error info if something goes wrong mid-stream
              await writer.write(
                encoder.encode(`{"error":"${error.message}"}`),
              );
            } finally {
              await writer.close();
            }
          })(),
        );

        // Return the readable stream immediately
        return new Response(readable, {
          headers: {
            "Content-Type": "application/json",
            "Transfer-Encoding": "chunked",
          },
        });
      }

      // Handle actions from query parameters
      const newTodo = url.searchParams.get("new");
      const deleteTodo = url.searchParams.get("delete");
      const toggleTodo = url.searchParams.get("toggle");

      // Handle adding a new todo
      if (newTodo) {
        const id = crypto.randomUUID();
        await client
          .exec(
            "INSERT INTO todos (id, text, created_at, tenant_id) VALUES (?, ?, ?, ?)",
            id,
            newTodo,
            new Date().toISOString(),
            tenantId,
          )
          .toArray();

        // Redirect to clear the query parameter
        return new Response(null, {
          status: 302,
          headers: {
            Location: `/${tenantId}${subPath}`,
          },
        });
      }

      // Handle deleting a todo
      if (deleteTodo) {
        await client
          .exec(
            "DELETE FROM todos WHERE id = ? AND tenant_id = ?",
            deleteTodo,
            tenantId,
          )
          .toArray();

        // Redirect to clear the query parameter
        return new Response(null, {
          status: 302,
          headers: {
            Location: `/${tenantId}${subPath}`,
          },
        });
      }

      // Handle toggling a todo's completion status
      if (toggleTodo) {
        await client
          .exec(
            "UPDATE todos SET completed = CASE WHEN completed = 1 THEN 0 ELSE 1 END WHERE id = ? AND tenant_id = ?",
            toggleTodo,
            tenantId,
          )
          .toArray();

        // Redirect to clear the query parameter
        return new Response(null, {
          status: 302,
          headers: {
            Location: `/${tenantId}${subPath}`,
          },
        });
      }

      // Get all todos for the current tenant
      const cursor = client.exec<Todo>(
        "SELECT * FROM todos WHERE tenant_id = ? ORDER BY created_at DESC",
        tenantId,
      );
      const todos = await cursor.toArray();

      // Default to UI response regardless of path
      // Create HTML UI response
      const html = `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>DORM TODO Demo - ${tenantId}</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                color: #333;
                background-color: #f9fafb;
              }
              h1 {
                color: #2563eb;
                border-bottom: 2px solid #e5e7eb;
                padding-bottom: 10px;
              }
              .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
              }
              .tenant-badge {
                background: #2563eb;
                color: white;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 0.9rem;
                font-weight: bold;
              }
              form {
                display: flex;
                margin-bottom: 20px;
                gap: 10px;
              }
              input[type="text"] {
                flex-grow: 1;
                padding: 12px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                font-size: 1rem;
              }
              button {
                background: #2563eb;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 500;
                transition: background-color 0.2s;
              }
              button:hover {
                background: #1d4ed8;
              }
              .todo-list {
                list-style: none;
                padding: 0;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                overflow: hidden;
              }
              .todo-item {
                display: flex;
                align-items: center;
                padding: 16px;
                border-bottom: 1px solid #e5e7eb;
                transition: background-color 0.2s;
              }
              .todo-item:hover {
                background-color: #f3f4f6;
              }
              .todo-item:last-child {
                border-bottom: none;
              }
              .todo-status {
                margin-right: 12px;
                cursor: pointer;
                font-size: 1.2rem;
              }
              .todo-text {
                flex-grow: 1;
                font-size: 1.1rem;
                transition: color 0.2s;
              }
              .todo-text.completed {
                text-decoration: line-through;
                color: #9ca3af;
              }
              .todo-buttons {
                display: flex;
                gap: 8px;
              }
              .todo-toggle {
                background: #10b981;
              }
              .todo-toggle:hover {
                background: #059669;
              }
              .todo-delete {
                background: #ef4444;
                font-size: 0.9rem;
              }
              .todo-delete:hover {
                background: #dc2626;
              }
              .todo-count {
                margin: 20px 0;
                color: #6b7280;
                font-size: 0.9rem;
              }
              .tenant-form {
                margin-top: 30px;
                padding: 20px;
                border-top: 1px solid #e5e7eb;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
              }
              .tenant-form h2 {
                margin-top: 0;
                color: #4b5563;
                font-size: 1.2rem;
              }
              .links {
                margin-top: 30px;
                padding: 20px;
                border-top: 1px solid #e5e7eb;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
              }
              .links h2 {
                margin-top: 0;
                color: #4b5563;
                font-size: 1.2rem;
              }
              .links-container {
                display: flex;
                flex-wrap: wrap;
                gap: 12px;
                margin-top: 12px;
              }
              .links a {
                display: inline-flex;
                align-items: center;
                padding: 8px 16px;
                background: #f3f4f6;
                color: #2563eb;
                text-decoration: none;
                border-radius: 6px;
                transition: background-color 0.2s;
              }
              .links a:hover {
                background: #e5e7eb;
              }
              .empty-state {
                text-align: center;
                padding: 40px 20px;
                color: #6b7280;
              }
              .empty-state p {
                margin: 10px 0 0;
              }
              .live-indicator {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: #ecfdf5;
                color: #059669;
                padding: 6px 12px;
                border-radius: 6px;
                font-size: 0.8rem;
                font-weight: 500;
                margin-bottom: 20px;
              }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>DORM TODO Demo</h1>
              <div class="tenant-badge">Tenant: ${tenantId}</div>
            </div>
            
            <div class="live-indicator">
              <span>●</span> Live Data | Last Updated: ${new Date().toLocaleTimeString()}
            </div>
            
            <form action="/${tenantId}" method="get">
              <input type="text" name="new" placeholder="Add a new todo..." required autofocus>
              <button type="submit">Add Todo</button>
            </form>
            
            <div class="todo-count">
              ${todos.length} item${todos.length !== 1 ? "s" : ""} total • 
              ${todos.filter((t) => t.completed).length} completed • 
              ${todos.filter((t) => !t.completed).length} active
            </div>
            
            <ul class="todo-list">
              ${
                todos.length > 0
                  ? todos
                      .map(
                        (todo) => `
                  <li class="todo-item">
                    <span class="todo-status">
                      ${todo.completed ? "✅" : "⬜️"}
                    </span>
                    <span class="todo-text ${
                      todo.completed ? "completed" : ""
                    }">${todo.text}</span>
                    <div class="todo-buttons">
                      <a href="/${tenantId}?toggle=${todo.id}">
                        <button class="todo-toggle">${
                          todo.completed ? "Mark Active" : "Mark Complete"
                        }</button>
                      </a>
                      <a href="/${tenantId}?delete=${todo.id}">
                        <button class="todo-delete">Delete</button>
                      </a>
                    </div>
                  </li>
                `,
                      )
                      .join("")
                  : `<li class="empty-state">
                     <h3>No todos yet</h3>
                     <p>Add your first todo using the form above!</p>
                   </li>`
              }
            </ul>
            
            <div class="tenant-form">
              <h2>Switch to Another Tenant</h2>
              <form action="/" method="get" onsubmit="window.location.href='/' + this.tenant.value; return false;">
                <input type="text" name="tenant" placeholder="Enter tenant name..." value="${tenantId}" required>
                <button type="submit">Switch</button>
              </form>
            </div>
            
            <div class="links">
              <h2>Resources & Tools</h2>
              <div class="links-container">
                <a href="/${tenantId}/stats" target="_blank">Database Stats</a>
                <a href="${`https://studio.outerbase.com/local/new-base/starbase?url=${encodeURIComponent(
                  new URL(`/${tenantId}/api/db`, request.url).href,
                )}&type=internal&access-key=my-secret-key`}" target="_blank">Open in Outerbase</a>
                <a href="${`https://studio.outerbase.com/local/new-base/starbase?url=${encodeURIComponent(
                  new URL(`/aggregate/api/db`, request.url).href,
                )}&type=internal&access-key=my-secret-key`}" target="_blank">Open aggregate in Outerbase</a>
              </div>
            </div>
            
            <script>
              // Auto-refresh every 30 seconds to show live data
              setTimeout(() => {
                window.location.reload();
              }, 30000);
            </script>
          </body>
          </html>
        `;

      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      console.error("Error handling request:", error);
      return new Response(JSON.stringify({ error: error.message }, null, 2), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};

/**
 * Example wrangler.toml configuration:
 *
 * name = "dorm-todo-demo"
 * main = "src/index.ts"
 * compatibility_date = "2023-05-18"
 *
 * [[durable_objects.bindings]]
 * name = "DORM_NAMESPACE"
 * class_name = "DORM"
 *
 * [vars]
 * DB_SECRET = "my-secret-key"  # Optional, defaults to "my-secret-key" if not set
 *
 * [[migrations]]
 * tag = "v1"
 * new_sqlite_classes = ["DORM"]
 */
