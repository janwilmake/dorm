import { createClient, DBConfig } from "./src/createClient";
import { DORM } from "./src/DORM";

// Define the database schema
const dbSchema: DBConfig = {
  version: "v3",
  statements: [
    `CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value REAL NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_records_name ON records(name);`,
  ],
};

export interface Env {
  DB: DurableObjectNamespace<DORM>;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Create client for the database
    const client = createClient(env.DB, dbSchema, {
      name: "demo-db",
      ctx: ctx, // Pass execution context for waitUntil
    });

    // Handle database middleware
    const middlewareResponse = await client.middleware(request, {
      prefix: "/db",
      // Uncomment to add auth: secret: 'your-db-secret-key'
    });

    if (middlewareResponse) {
      return middlewareResponse;
    }

    // API endpoint to insert records
    if (url.pathname === "/api/generate" && request.method === "POST") {
      try {
        const { count = 10 }: { count?: number } = await request.json();
        const safeCount = Math.min(Math.max(1, count), 1000); // Limit between 1-1000

        // Create batch insert query
        let values: string[] = [];
        let placeholders: string[] = [];

        for (let i = 0; i < safeCount; i++) {
          values.push(`Record ${i}`, String(Math.random() * 100));
          placeholders.push(`(?, ?)`);
        }

        const sql = `INSERT INTO records (name, value) VALUES ${placeholders.join(
          ", ",
        )}`;
        const result = await client.exec(sql, ...values);

        return new Response(
          JSON.stringify({
            success: true,
            count: safeCount,
            rowsWritten: result.rowsWritten,
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            error: error.message,
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    // API endpoint to get database size
    if (url.pathname === "/api/db-size") {
      try {
        const size = await client.getDatabaseSize();
        return new Response(
          JSON.stringify({
            success: true,
            size: size,
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            error: error.message,
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    // Return 404 for anything else
    return new Response("Not found", { status: 404 });
  },
};

// Register the DORM Durable Object class
export { DORM };
