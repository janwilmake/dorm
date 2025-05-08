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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    const path = url.pathname;

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

    // Helper function to return JSON responses
    const jsonResponse = (data: any, status: number = 200) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      // CRUD API Routes

      // CREATE - Create a new record
      if (path === "/api/records" && request.method === "POST") {
        const { name, value }: { name: string; value: string } =
          await request.json();

        if (!name || value === undefined) {
          return jsonResponse(
            {
              success: false,
              error: "Name and value are required fields",
            },
            400,
          );
        }

        const sql = "INSERT INTO records (name, value) VALUES (?, ?)";
        const result = await client.exec(sql, name, value);

        if (result.error) {
          throw new Error(result.error);
        }

        // Get the last inserted ID
        const idResult = await client.exec("SELECT last_insert_rowid() as id");
        const id = idResult.one<{ id: string }>()?.id;

        return jsonResponse({
          success: true,
          id,
          message: "Record created successfully",
          rowsWritten: result.rowsWritten,
        });
      }

      // READ - Get all records or a specific record
      if (path.match(/^\/api\/records\/?(\d+)?$/) && request.method === "GET") {
        const match = path.match(/^\/api\/records\/(\d+)$/);
        const id = match ? match[1] : null;

        // Get filters from query params
        const filters = {
          name: url.searchParams.get("name"),
          minValue: url.searchParams.get("minValue"),
          maxValue: url.searchParams.get("maxValue"),
          limit: parseInt(url.searchParams.get("limit") || "100"),
          offset: parseInt(url.searchParams.get("offset") || "0"),
        };

        if (id) {
          // Get a specific record by ID
          const result = await client.exec(
            "SELECT * FROM records WHERE id = ?",
            id,
          );

          const record = result.one();

          if (!record) {
            return jsonResponse(
              {
                success: false,
                error: `Record with ID ${id} not found`,
              },
              404,
            );
          }

          return jsonResponse({
            success: true,
            record,
          });
        } else {
          // Get multiple records with optional filtering
          let sql = "SELECT * FROM records";
          const params: any[] = [];
          const whereClauses: string[] = [];

          if (filters.name) {
            whereClauses.push("name LIKE ?");
            params.push(`%${filters.name}%`);
          }

          if (filters.minValue !== null) {
            whereClauses.push("value >= ?");
            params.push(filters.minValue);
          }

          if (filters.maxValue !== null) {
            whereClauses.push("value <= ?");
            params.push(filters.maxValue);
          }

          if (whereClauses.length > 0) {
            sql += " WHERE " + whereClauses.join(" AND ");
          }

          sql += " ORDER BY id DESC LIMIT ? OFFSET ?";
          params.push(filters.limit, filters.offset);

          // Get count of total records for pagination
          let countSql = "SELECT COUNT(*) as count FROM records";
          if (whereClauses.length > 0) {
            countSql += " WHERE " + whereClauses.join(" AND ");
          }
          const countResult = await client.exec(
            countSql,
            ...params.slice(0, -2),
          );
          const totalCount = countResult.one<{ count: number }>()?.count || 0;

          // Get filtered records
          const result = await client.exec(sql, ...params);
          const records = Array.from(result.results());

          return jsonResponse({
            success: true,
            records,
            pagination: {
              total: totalCount,
              limit: filters.limit,
              offset: filters.offset,
              hasMore: totalCount > filters.offset + filters.limit,
            },
          });
        }
      }

      // UPDATE - Update an existing record
      if (path.match(/^\/api\/records\/\d+$/) && request.method === "PUT") {
        const id = path.match(/^\/api\/records\/(\d+)$/)![1];
        const updates: any = await request.json();

        // Check if record exists
        const checkResult = await client.exec(
          "SELECT id FROM records WHERE id = ?",
          id,
        );

        if (!checkResult.one()) {
          return jsonResponse(
            {
              success: false,
              error: `Record with ID ${id} not found`,
            },
            404,
          );
        }

        // Build update SQL dynamically based on provided fields
        const updateFields: string[] = [];
        const params: any[] = [];

        if (updates.name !== undefined) {
          updateFields.push("name = ?");
          params.push(updates.name);
        }

        if (updates.value !== undefined) {
          updateFields.push("value = ?");
          params.push(updates.value);
        }

        // Always update the updated_at timestamp
        updateFields.push("updated_at = CURRENT_TIMESTAMP");

        if (updateFields.length === 0) {
          return jsonResponse(
            {
              success: false,
              error: "No valid fields to update",
            },
            400,
          );
        }

        // Add ID as last parameter
        params.push(id);

        const sql = `UPDATE records SET ${updateFields.join(
          ", ",
        )} WHERE id = ?`;
        const result = await client.exec(sql, ...params);

        return jsonResponse({
          success: true,
          message: "Record updated successfully",
          rowsWritten: result.rowsWritten,
        });
      }

      // DELETE - Delete a record
      if (path.match(/^\/api\/records\/\d+$/) && request.method === "DELETE") {
        const id = path.match(/^\/api\/records\/(\d+)$/)![1];

        // Check if record exists
        const checkResult = await client.exec(
          "SELECT id FROM records WHERE id = ?",
          id,
        );

        if (!checkResult.one()) {
          return jsonResponse(
            {
              success: false,
              error: `Record with ID ${id} not found`,
            },
            404,
          );
        }

        const result = await client.exec(
          "DELETE FROM records WHERE id = ?",
          id,
        );

        return jsonResponse({
          success: true,
          message: "Record deleted successfully",
          rowsWritten: result.rowsWritten,
        });
      }

      // ORIGINAL API ENDPOINTS

      // API endpoint to insert records
      if (path === "/api/generate" && request.method === "POST") {
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

        return jsonResponse({
          success: true,
          count: safeCount,
          rowsWritten: result.rowsWritten,
        });
      }

      // API endpoint to get database size
      if (path === "/api/db-size") {
        const size = await client.getDatabaseSize();
        return jsonResponse({
          success: true,
          size: size,
        });
      }

      // Return 404 for anything else
      return new Response("Not found", { status: 404 });
    } catch (error) {
      return jsonResponse(
        {
          success: false,
          error: error.message,
        },
        500,
      );
    }
  },
};

// Register the DORM Durable Object class
export { DORM };
