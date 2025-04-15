import { ORMDO, createDBClient, DBConfig, DBClient } from "./queryState";
import { adminHtml } from "./adminHtml";
export { ORMDO };

const dbConfig: DBConfig = {
  /** Put your CREATE TABLE queries here */
  schema: [
    `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    `,
  ],
  /** Updating this if you have breaking schema changes. */
  version: "v1",
  authSecret: "my-secret-key", // Optional: used for authenticating requests
};

type Env = {
  MY_EXAMPLE_DO: DurableObjectNamespace;
};

export default {
  fetch: async (request: Request, env: Env, ctx: any) => {
    const client = createDBClient(env.MY_EXAMPLE_DO, dbConfig);

    // First try to handle the request with the middleware
    const middlewareResponse = await client.middleware(request, {
      prefix: "/api/db",
      secret: dbConfig.authSecret,
    });

    // If middleware handled the request, return its response
    if (middlewareResponse) {
      return middlewareResponse;
    }

    // Get URL and method for routing
    const url = new URL(request.url);
    const method = request.method;

    // Admin UI route
    if (url.pathname === "/" || url.pathname === "/admin") {
      return new Response(adminHtml, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Handle API routes based on method
    if (url.pathname.startsWith("/api/")) {
      if (method === "GET") {
        return handleGet(request, env, { client, ctx });
      } else if (method === "POST") {
        return handlePost(request, env, { client, ctx });
      } else if (method === "PUT") {
        return handlePut(request, env, { client, ctx });
      } else if (method === "DELETE") {
        return handleDelete(request, env, { client, ctx });
      }
    }

    // Default 404 response
    return new Response("Not found", { status: 404 });
  },
};

// Handle GET requests
export const handleGet = async (
  request: Request,
  env: Env,
  { client, ctx }: { client: DBClient; ctx: ExecutionContext },
) => {
  const url = new URL(request.url);

  // Get all users
  if (url.pathname === "/api/users") {
    const result = await client.standardQuery(
      "SELECT * FROM users ORDER BY created_at DESC",
    );

    if (!result.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch users" }), {
        status: result.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response(JSON.stringify(result.json), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Get user by ID
  if (url.pathname.startsWith("/api/users/") && url.pathname.length > 11) {
    const userId = url.pathname.substring(11);

    const result = await client.standardQuery(
      "SELECT * FROM users WHERE id = ?",
      userId,
    );

    if (!result.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch user" }), {
        status: result.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    if (!result.json || result.json.length === 0) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response(JSON.stringify(result.json[0]), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Default 404 response
  return new Response("Not found", { status: 404 });
};

// Handle POST requests
export const handlePost = async (
  request: Request,
  env: Env,
  { client, ctx }: { client: DBClient; ctx: ExecutionContext },
) => {
  const url = new URL(request.url);

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
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      // Generate random ID if not provided
      const userId = body.id || crypto.randomUUID();

      const result = await client.standardQuery(
        "INSERT INTO users (id, name, email) VALUES (?, ?, ?) RETURNING *",
        userId,
        body.name,
        body.email,
      );

      if (!result.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to create user" }),
          {
            status: result.status,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      return new Response(JSON.stringify(result.json?.[0]), {
        status: 201,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }

  // Default 404 response
  return new Response("Not found", { status: 404 });
};

// Handle PUT requests
export const handlePut = async (
  request: Request,
  env: Env,
  { client, ctx }: { client: DBClient; ctx: ExecutionContext },
) => {
  const url = new URL(request.url);

  // Update a user
  if (url.pathname.startsWith("/api/users/") && url.pathname.length > 11) {
    try {
      const userId = url.pathname.substring(11);
      const body = (await request.json()) as { name?: string; email?: string };

      if (!body.name && !body.email) {
        return new Response(
          JSON.stringify({
            error: "At least one field (name or email) is required",
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      // Check if user exists
      const checkResult = await client.standardQuery(
        "SELECT * FROM users WHERE id = ?",
        userId,
      );

      if (
        !checkResult.ok ||
        !checkResult.json ||
        checkResult.json.length === 0
      ) {
        return new Response(JSON.stringify({ error: "User not found" }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // Build update query dynamically based on provided fields
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

      const result = await client.standardQuery(updateQuery, ...updateParams);

      if (!result.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to update user" }),
          {
            status: result.status,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      return new Response(JSON.stringify(result.json?.[0]), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }

  // Default 404 response
  return new Response("Not found", { status: 404 });
};

// Handle DELETE requests
export const handleDelete = async (
  request: Request,
  env: Env,
  { client, ctx }: { client: DBClient; ctx: ExecutionContext },
) => {
  const url = new URL(request.url);

  // Delete a user
  if (url.pathname.startsWith("/api/users/") && url.pathname.length > 11) {
    const userId = url.pathname.substring(11);

    // Check if user exists
    const checkResult = await client.standardQuery(
      "SELECT * FROM users WHERE id = ?",
      userId,
    );

    if (!checkResult.ok || !checkResult.json || checkResult.json.length === 0) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const result = await client.standardQuery(
      "DELETE FROM users WHERE id = ? RETURNING *",
      userId,
    );

    if (!result.ok) {
      return new Response(JSON.stringify({ error: "Failed to delete user" }), {
        status: result.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response(
      JSON.stringify({
        message: "User deleted successfully",
        user: result.json?.[0],
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  // Default 404 response
  return new Response("Not found", { status: 404 });
};
