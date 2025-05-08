import { createClient, DBConfig } from "./src/createClient";
import { DORM } from "./src/DORM";

// Define the database schema
const dbSchema: DBConfig = {
  version: "v1", // Set a version for your database
  statements: [
    `CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`,
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
      name: "simple-example", // Name for this database instance
      ctx: ctx, // Pass execution context for waitUntil
    });

    // Handle database middleware (this enables direct DB access via /db/* endpoints)
    const middlewareResponse = await client.middleware(request, {
      prefix: "/db",
      // Uncomment to add auth: secret: 'your-secret-key'
    });

    if (middlewareResponse) {
      return middlewareResponse;
    }

    // GET /insert - Insert a new item
    if (url.pathname === "/insert" && request.method === "GET") {
      try {
        const itemName = `Item ${new Date().toISOString()}`;

        // Insert the item
        const result = await client.exec(
          "INSERT INTO items (name) VALUES (?)",
          itemName,
        );

        return new Response(
          JSON.stringify({
            success: true,
            message: `Created item: ${itemName}`,
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

    // GET /stream - Stream items with 100ms delay between each item
    if (url.pathname === "/stream" && request.method === "GET") {
      try {
        // Query all items, ordered by id for consistent streaming
        const result = await client.exec("SELECT * FROM items ORDER BY id ASC");

        // Check for initial errors
        if (result.error) {
          throw new Error(result.error);
        }

        // Create a stream that processes items as they come from the cursor
        const stream = new ReadableStream({
          async start(controller) {
            // Using for...of to stream directly from the cursor as items arrive
            try {
              // We use the results() generator to get structured objects
              while (true) {
                const { done, value: item } = result.next();
                if (done) {
                  break;
                }
                // Create event with current timestamp and the item
                const event = {
                  timestamp: new Date().toISOString(),
                  item: item,
                };

                // Encode and send the event
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify(event) + "\n"),
                );

                // Wait 100ms before processing the next item
                await new Promise((resolve) => setTimeout(resolve, 100));
              }

              // All items processed, close the stream
              controller.close();
            } catch (error) {
              // Handle any errors during streaming
              controller.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({
                    error: `Streaming error: ${error.message}`,
                  }) + "\n",
                ),
              );
              controller.close();
            }
          },
        });

        // Return the streaming response
        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain",
            "Content-Encoding": "chunked",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
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

    // GET / - Get all items
    if (url.pathname === "/" && request.method === "GET") {
      try {
        // Query all items, ordered by newest first
        const result = await client.exec(
          "SELECT * FROM items ORDER BY created_at DESC",
        );

        // Wait for results to be fully loaded
        await result.waitForStreamingComplete();

        // Check for errors
        if (result.error) {
          throw new Error(result.error);
        }

        // Convert result to array of objects
        const items = Array.from(result.results());

        return new Response(
          JSON.stringify({
            success: true,
            count: items.length,
            items: items,
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

    // Return 404 for any other routes
    return new Response("Not found", { status: 404 });
  },
};

// Export the DORM Durable Object class
export { DORM };
