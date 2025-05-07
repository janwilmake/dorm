import { DurableObject } from "cloudflare:workers";

/**
 * Simplified Durable Object implementation focusing on streaming SQL results
 * with back-pressure support
 */
export class DORM extends DurableObject {
  public sql: SqlStorage;

  constructor(state: DurableObjectState, env: any) {
    super(state, env);
    this.sql = state.storage.sql;
  }

  // Method to get database size
  async getDatabaseSize() {
    return this.sql.databaseSize;
  }

  // HTTP handler for the Durable Object
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Handle SQL execution
      if (path === "/exec" && request.method === "POST") {
        const data = (await request.json()) as { sql: string; params?: any[] };

        if (!data.sql) {
          return new Response(JSON.stringify({ error: "Missing SQL query" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Execute the SQL query
        const cursor = this.sql.exec(data.sql, ...(data.params || []));
        const encoder = new TextEncoder();

        // Create a stream with back-pressure support
        const stream = new ReadableStream({
          // Store state for the stream
          start(controller) {
            // We'll store these properties on 'this' to track state between pulls
            this.rowIterator = null;
            this.columnsSent = false;
            this.metaSent = false;
            this.cursorComplete = false;

            // Make cursor available for pull
            this.cursor = cursor;
          },

          // This gets called whenever the consumer is ready for more data
          pull(controller) {
            try {
              // Step 1: Send column names if not sent yet
              if (!this.columnsSent) {
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({
                      type: "columns",
                      data: this.cursor.columnNames,
                    }) + "\n",
                  ),
                );
                this.columnsSent = true;
                return; // Return early to let consumer process this
              }

              // Step 2: Get row iterator if we don't have it yet
              if (!this.rowIterator) {
                this.rowIterator = this.cursor.raw()[Symbol.iterator]();
              }

              // Step 3: If we have rows to send, send the next one
              if (!this.cursorComplete) {
                // Get next row
                const result = this.rowIterator.next();

                if (!result.done) {
                  // Send one row and return - this is key for back-pressure
                  controller.enqueue(
                    encoder.encode(
                      JSON.stringify({
                        type: "row",
                        data: result.value,
                      }) + "\n",
                    ),
                  );
                  return; // Return early to let consumer process this row
                } else {
                  // Mark that we've seen all rows
                  this.cursorComplete = true;
                }
              }

              // Step 4: If all rows processed and meta not sent, send meta
              if (this.cursorComplete && !this.metaSent) {
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({
                      type: "meta",
                      data: {
                        rows_read: this.cursor.rowsRead,
                        rows_written: this.cursor.rowsWritten,
                      },
                    }) + "\n",
                  ),
                );
                this.metaSent = true;
                controller.close(); // Close the stream as we're done
              }
            } catch (error) {
              // Handle any errors that occur during streaming
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    type: "error",
                    error: error.message,
                  }) + "\n",
                ),
              );
              controller.close();
            }
          },

          // Optional: Clean up resources when the stream is cancelled
          cancel() {
            // Nothing specific to clean up in this implementation
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "application/x-ndjson" },
        });
      }

      // For other paths, return a 404
      return new Response("Not found", { status: 404 });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
}
