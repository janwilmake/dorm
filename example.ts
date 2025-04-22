import { DORM, createClient, DBConfig } from "./DORM";
export { DORM };

const dbConfig: DBConfig = {
  // either use sql statements
  statements: [
    `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    `,
  ],
  // or use json schemas to define your tables!
  schemas: [
    {
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
      },
    },
  ],
  version: "v1",
};

type Env = {
  MY_EXAMPLE_DO: DurableObjectNamespace;
};

export default {
  fetch: async (request: Request, env: Env, ctx: any) => {
    const client = createClient(env.MY_EXAMPLE_DO, dbConfig);
    const url = new URL(request.url);
    const method = request.method;

    // This middleware allows the DO state be accessible through outerbase;
    // https://studio.outerbase.com/local/new-base/starbase?url=https://ormdo.wilmake.com/api/db&type=internal&access-key=my-secret-key
    const middlewareResponse = await client.middleware(request, {
      prefix: "/api/db",
      secret: "my-secret-key",
    });
    if (middlewareResponse) return middlewareResponse;

    // API routes
    if (url.pathname.startsWith("/api/")) {
      // Common response headers
      const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      };

      // GET endpoints
      if (method === "GET") {
        // Get all users
        if (url.pathname === "/api/users") {
          const result = await client.select("users", undefined, {
            orderBy: [{ column: "created_at", direction: "DESC" }],
          });

          if (!result.ok) {
            return new Response(
              JSON.stringify({ error: "Failed to fetch users" }),
              { status: result.status, headers },
            );
          }

          return new Response(JSON.stringify(result.json), { headers });
        }

        // Get user by ID
        if (
          url.pathname.startsWith("/api/users/") &&
          url.pathname.length > 11
        ) {
          const userId = url.pathname.substring(11);
          const result = await client.query(
            "SELECT * FROM users WHERE id = ?",
            undefined,
            userId,
          );

          if (!result.ok) {
            return new Response(
              JSON.stringify({ error: "Failed to fetch user" }),
              { status: result.status, headers },
            );
          }

          if (!result.json || result.json.length === 0) {
            return new Response(JSON.stringify({ error: "User not found" }), {
              status: 404,
              headers,
            });
          }

          return new Response(JSON.stringify(result.json[0]), { headers });
        }
      }

      // POST endpoints
      else if (method === "POST") {
        // Create a new user
        if (url.pathname === "/api/users") {
          try {
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
            const result = await client.query(
              "INSERT INTO users (id, name, email) VALUES (?, ?, ?) RETURNING *",
              undefined,
              userId,
              body.name,
              body.email,
            );

            if (!result.ok) {
              return new Response(
                JSON.stringify({ error: "Failed to create user" }),
                { status: result.status, headers },
              );
            }

            return new Response(JSON.stringify(result.json?.[0]), {
              status: 201,
              headers,
            });
          } catch (error) {
            return new Response(
              JSON.stringify({ error: "Invalid request body" }),
              { status: 400, headers },
            );
          }
        }
      }

      // PUT endpoints
      else if (method === "PUT") {
        // Update a user
        if (
          url.pathname.startsWith("/api/users/") &&
          url.pathname.length > 11
        ) {
          try {
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
            const checkResult = await client.query(
              "SELECT * FROM users WHERE id = ?",
              undefined,
              userId,
            );

            if (
              !checkResult.ok ||
              !checkResult.json ||
              checkResult.json.length === 0
            ) {
              return new Response(JSON.stringify({ error: "User not found" }), {
                status: 404,
                headers,
              });
            }

            // Build update query dynamically
            let updateQuery = "UPDATE users SET ";
            const updateParams: string[] = [];

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

            const result = await client.query(
              updateQuery,
              undefined,
              ...updateParams,
            );

            if (!result.ok) {
              return new Response(
                JSON.stringify({ error: "Failed to update user" }),
                { status: result.status, headers },
              );
            }

            return new Response(JSON.stringify(result.json?.[0]), { headers });
          } catch (error) {
            return new Response(
              JSON.stringify({ error: "Invalid request body" }),
              { status: 400, headers },
            );
          }
        }
      }

      // DELETE endpoints
      else if (method === "DELETE") {
        // Delete a user
        if (
          url.pathname.startsWith("/api/users/") &&
          url.pathname.length > 11
        ) {
          const userId = url.pathname.substring(11);

          // Check if user exists
          const checkResult = await client.query(
            "SELECT * FROM users WHERE id = ?",
            undefined,
            userId,
          );

          if (
            !checkResult.ok ||
            !checkResult.json ||
            checkResult.json.length === 0
          ) {
            return new Response(JSON.stringify({ error: "User not found" }), {
              status: 404,
              headers,
            });
          }

          const result = await client.query(
            "DELETE FROM users WHERE id = ? RETURNING *",
            undefined,
            userId,
          );

          if (!result.ok) {
            return new Response(
              JSON.stringify({ error: "Failed to delete user" }),
              { status: result.status, headers },
            );
          }

          return new Response(
            JSON.stringify({
              message: "User deleted successfully",
              user: result.json?.[0],
            }),
            { headers },
          );
        }
      }
    }

    // Default 404 response
    return new Response("Not found", { status: 404 });
  },
};
