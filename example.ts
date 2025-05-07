import { DORM, createClient, DBConfig, jsonSchemaToSql } from "./DORM";
export { DORM };
const dbConfig: DBConfig = {
  statements: [
    // SQL statement for users table
    `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    `,
    ...jsonSchemaToSql({
      $id: "items",
      type: "object",
      required: ["id"],
      properties: {
        id: {
          type: "string",
          "x-dorm-auto-increment": true,
          "x-dorm-primary-key": true,
          "x-dorm-unique": true,
        },
        description: { type: "string" },
        created_at: {
          type: "string",
          format: "date-time",
          "x-dorm-default": "CURRENT_TIMESTAMP",
        },
      },
    }),
  ],
  version: "v1",
};

type Env = {
  MY_EXAMPLE_DO: DurableObjectNamespace<DORM>;
};

export default {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    // Initialize the client
    const client = createClient<DBConfig>(env.MY_EXAMPLE_DO, dbConfig, { ctx });

    const url = new URL(request.url);
    const method = request.method;

    // Common response headers
    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Handle CORS preflight requests
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers,
      });
    }

    // Use DORM middleware for raw DB access
    const middlewareResponse = await client.middleware(request, {
      prefix: "/api/db",
      //  secret: "my-secret-key",
    });

    if (middlewareResponse) return middlewareResponse;

    // Database size endpoint
    if (url.pathname === "/api/db-size") {
      const size = client.getDatabaseSize();
      const mirrorSize = await client.getMirrorDatabaseSize?.();
      return new Response(JSON.stringify({ size, mirrorSize }), { headers });
    }

    // API Routes
    if (url.pathname.startsWith("/api/")) {
      try {
        // Users endpoints
        if (url.pathname === "/api/users" && method === "GET") {
          // Get all users
          const cursor = await client.exec(
            "SELECT * FROM users ORDER BY created_at DESC",
          );
          return new Response(JSON.stringify(cursor.toArray()), { headers });
        }

        // Get user by ID
        else if (url.pathname.startsWith("/api/users/") && method === "GET") {
          const userId = url.pathname.substring(11);
          const cursor = await client.exec(
            "SELECT * FROM users WHERE id = ?",
            userId,
          );
          const user = cursor.toArray()[0];

          if (!user) {
            return new Response(JSON.stringify({ error: "User not found" }), {
              status: 404,
              headers,
            });
          }

          return new Response(JSON.stringify(user), { headers });
        }

        // Create a new user
        else if (url.pathname === "/api/users" && method === "POST") {
          const body = (await request.json()) as {
            id?: string;
            name: string;
            email: string;
          };

          if (!body.name || !body.email) {
            return new Response(
              JSON.stringify({ error: "Name and email are required" }),
              { status: 400, headers },
            );
          }

          const userId = body.id || crypto.randomUUID();
          const cursor = await client.exec(
            "INSERT INTO users (id, name, email) VALUES (?, ?, ?) RETURNING *",
            userId,
            body.name,
            body.email,
          );

          return new Response(JSON.stringify(cursor.toArray()[0]), {
            status: 201,
            headers,
          });
        }

        // Update a user
        else if (url.pathname.startsWith("/api/users/") && method === "PUT") {
          const userId = url.pathname.substring(11);
          const body = (await request.json()) as {
            name?: string;
            email?: string;
          };

          if (!body.name && !body.email) {
            return new Response(
              JSON.stringify({
                error: "At least one field (name or email) is required",
              }),
              { status: 400, headers },
            );
          }

          // Check if user exists
          const checkCursor = await client.exec(
            "SELECT * FROM users WHERE id = ?",
            userId,
          );

          if (checkCursor.toArray().length === 0) {
            return new Response(JSON.stringify({ error: "User not found" }), {
              status: 404,
              headers,
            });
          }

          // Build update query dynamically
          let updateQuery = "UPDATE users SET ";
          const updateParams: any[] = [];

          if (body.name) {
            updateQuery += "name = ?";
            updateParams.push(body.name);

            if (body.email) {
              updateQuery += ", email = ?";
              updateParams.push(body.email);
            }
          } else if (body.email) {
            updateQuery += "email = ?";
            updateParams.push(body.email);
          }

          updateQuery += " WHERE id = ? RETURNING *";
          updateParams.push(userId);

          const cursor = await client.exec(updateQuery, ...updateParams);

          return new Response(JSON.stringify(cursor.toArray()[0]), { headers });
        }

        // Delete a user
        else if (
          url.pathname.startsWith("/api/users/") &&
          method === "DELETE"
        ) {
          const userId = url.pathname.substring(11);

          // Check if user exists
          const checkCursor = await client.exec(
            "SELECT * FROM users WHERE id = ?",
            userId,
          );

          if (checkCursor.toArray().length === 0) {
            return new Response(JSON.stringify({ error: "User not found" }), {
              status: 404,
              headers,
            });
          }

          const cursor = await client.exec(
            "DELETE FROM users WHERE id = ? RETURNING *",
            userId,
          );

          return new Response(
            JSON.stringify({
              message: "User deleted successfully",
              user: cursor.toArray()[0],
            }),
            { headers },
          );
        }

        // Items endpoints

        // Get all items
        else if (url.pathname === "/api/items" && method === "GET") {
          const cursor = await client.exec(
            "SELECT * FROM items ORDER BY created_at DESC",
          );
          return new Response(JSON.stringify(Array.from(cursor)), { headers });
        }

        // Get item by ID
        else if (url.pathname.startsWith("/api/items/") && method === "GET") {
          const itemId = url.pathname.substring(11);
          const cursor = await client.exec(
            "SELECT * FROM items WHERE id = ?",
            itemId,
          );
          const item = cursor.toArray()[0];

          if (!item) {
            return new Response(JSON.stringify({ error: "Item not found" }), {
              status: 404,
              headers,
            });
          }

          return new Response(JSON.stringify(item), { headers });
        }

        // Create a new item
        else if (url.pathname === "/api/items" && method === "POST") {
          const body = (await request.json()) as {
            description: string;
          };

          if (!body.description) {
            return new Response(
              JSON.stringify({ error: "Description is required" }),
              { status: 400, headers },
            );
          }

          const cursor = await client.exec(
            "INSERT INTO items (description) VALUES (?) RETURNING *",
            body.description,
          );

          return new Response(JSON.stringify(cursor.toArray()[0]), {
            status: 201,
            headers,
          });
        }

        // Update an item
        else if (url.pathname.startsWith("/api/items/") && method === "PUT") {
          const itemId = url.pathname.substring(11);
          const body = (await request.json()) as {
            description: string;
          };

          if (!body.description) {
            return new Response(
              JSON.stringify({ error: "Description is required" }),
              { status: 400, headers },
            );
          }

          // Check if item exists
          const checkCursor = await client.exec(
            "SELECT * FROM items WHERE id = ?",
            itemId,
          );

          if (checkCursor.toArray().length === 0) {
            return new Response(JSON.stringify({ error: "Item not found" }), {
              status: 404,
              headers,
            });
          }

          const cursor = await client.exec(
            "UPDATE items SET description = ? WHERE id = ? RETURNING *",
            body.description,
            itemId,
          );

          return new Response(JSON.stringify(cursor.toArray()[0]), { headers });
        }

        // Delete an item
        else if (
          url.pathname.startsWith("/api/items/") &&
          method === "DELETE"
        ) {
          const itemId = url.pathname.substring(11);

          // Check if item exists
          const checkCursor = await client.exec(
            "SELECT * FROM items WHERE id = ?",
            itemId,
          );

          if (checkCursor.toArray().length === 0) {
            return new Response(JSON.stringify({ error: "Item not found" }), {
              status: 404,
              headers,
            });
          }

          const cursor = await client.exec(
            "DELETE FROM items WHERE id = ? RETURNING *",
            itemId,
          );

          return new Response(
            JSON.stringify({
              message: "Item deleted successfully",
              item: cursor.toArray()[0],
            }),
            { headers },
          );
        }
      } catch (error) {
        console.error("API error:", error);
        return new Response(
          JSON.stringify({ error: "Server error", details: error.message }),
          { status: 500, headers },
        );
      }
    }

    // Default response for unmatched routes
    return new Response("Not found", { status: 404 });
  },
};
