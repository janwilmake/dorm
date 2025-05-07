//@ts-check
/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from "cloudflare:workers";

const TIMEOUT = 30000;
const MAX_RETRIES = 1;

/**
 * Stream message types for the SQL stream protocol
 */
interface StreamMessage {
  type: "columns" | "row" | "meta" | "error";
  data?: any;
  error?: string;
}

/**
 * Client-side cursor that implements the expected SqlStorageCursor interface
 */
export class ClientSqlCursor<
  T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
> {
  private _columnNames: string[] = [];
  private _rows: any[][] = [];
  private _rowsRead: number = 0;
  private _rowsWritten: number = 0;
  private _currentIndex: number = 0;
  private _initialized: boolean = false;
  private _error: string | null = null;
  private _streamingComplete: boolean = false;
  private _streamingPromise: Promise<void> | null = null;
  private _resolveStreamingPromise: (() => void) | null = null;

  constructor() {
    // Initialize the streaming promise
    this._streamingPromise = new Promise((resolve) => {
      this._resolveStreamingPromise = resolve;
    });
  }

  // Method to update cursor with stream data
  _processStreamMessage(message: StreamMessage) {
    if (message.type === "columns") {
      this._columnNames = message.data;
    } else if (message.type === "row") {
      this._rows.push(message.data);
    } else if (message.type === "meta") {
      this._rowsRead = message.data.rows_read;
      this._rowsWritten = message.data.rows_written;
      this._initialized = true;
      this._completeStreaming();
    } else if (message.type === "error") {
      this._error = message.error || "Unknown error";
      this._completeStreaming();
    }
  }

  // Mark streaming as complete and resolve the promise
  _completeStreaming() {
    if (!this._streamingComplete && this._resolveStreamingPromise) {
      this._streamingComplete = true;
      this._resolveStreamingPromise();
      this._resolveStreamingPromise = null;
    }
  }

  // Wait for streaming to complete
  async waitForStreamingComplete(): Promise<void> {
    if (this._streamingComplete) {
      return Promise.resolve();
    }
    return this._streamingPromise as Promise<void>;
  }

  // Check if an error occurred during streaming
  get error(): string | null {
    return this._error;
  }

  get columnNames(): string[] {
    return this._columnNames;
  }

  get rowsRead(): number {
    return this._rowsRead;
  }

  get rowsWritten(): number {
    return this._rowsWritten;
  }

  get initialized(): boolean {
    return this._initialized;
  }

  *raw(): Generator<any[]> {
    for (const row of this._rows) {
      yield row;
    }
  }

  *results(): Generator<T> {
    for (const row of this._rows) {
      const result = {} as T;
      for (let i = 0; i < this._columnNames.length; i++) {
        const columnName = this._columnNames[i];
        //@ts-ignore
        result[columnName] = row[i];
      }
      yield result;
    }
  }

  one(): T | null {
    if (this._rows.length === 0) {
      return null;
    }

    const result = {} as T;
    for (let i = 0; i < this._columnNames.length; i++) {
      const columnName = this._columnNames[i];
      //@ts-ignore
      result[columnName] = this._rows[0][i];
    }
    return result;
  }

  next(): IteratorResult<T> {
    if (this._currentIndex >= this._rows.length) {
      return { done: true, value: undefined };
    }

    const row = this._rows[this._currentIndex++];
    const result = {} as T;
    for (let i = 0; i < this._columnNames.length; i++) {
      const columnName = this._columnNames[i];
      //@ts-ignore
      result[columnName] = row[i];
    }

    return {
      done: false,
      value: result,
    };
  }

  /**
   * Returns all results as an array, waiting for streaming to complete first
   * @returns Promise that resolves to an array of all results
   */
  async toArray(): Promise<T[]> {
    // Wait for streaming to complete before returning results
    await this.waitForStreamingComplete();

    // Now convert results to array
    return Array.from(this.results());
  }

  [Symbol.iterator](): Iterator<T> {
    return {
      next: () => this.next(),
    };
  }
}

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

/**
 * Creates a client-side exec function that works with a DORM instance
 * with improved error handling and timeout support
 * @param stub - Durable Object stub for a DORM instance
 * @param options - Options for the exec function
 * @returns An exec function that can run SQL queries and return results
 */
export async function exec<
  T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(stub: Fetcher, sql: string, ...params: any[]): Promise<ClientSqlCursor<T>> {
  // Create a new cursor to populate
  const cursor = new ClientSqlCursor<T>();

  // Track retries
  let retries = 0;
  let lastError: Error | null = null;

  while (retries <= MAX_RETRIES) {
    try {
      // Create streaming request
      const req = new Request("https://internal-rpc/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params }),
      });

      // Create timeout promise
      const timeoutPromise = new Promise<Response>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Request timed out after ${TIMEOUT}ms`)),
          TIMEOUT,
        );
      });

      // Race between the request and timeout
      const response = (await Promise.race([
        stub.fetch(req),
        timeoutPromise,
      ])) as Response;

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        throw new Error(`Stream execution error: ${errorText}`);
      }

      // Process the streamed response with improved buffer management
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB max buffer size

      // Use async processing to handle the stream
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              // Process any remaining data in the buffer
              if (buffer.trim()) {
                try {
                  const lines = buffer.trim().split("\n");
                  for (const line of lines) {
                    if (line.trim()) {
                      const message = JSON.parse(line) as StreamMessage;
                      cursor._processStreamMessage(message);
                    }
                  }
                } catch (e) {
                  console.error("Error parsing final buffer:", e);
                }
              }

              // Ensure streaming is marked as complete even if no meta message was received
              cursor._completeStreaming();
              break;
            }

            // Add new chunk to buffer
            buffer += decoder.decode(value, { stream: true });

            // Safety check for buffer size to prevent memory issues
            if (buffer.length > MAX_BUFFER_SIZE) {
              throw new Error("Buffer size exceeded maximum allowed size");
            }

            // Process complete lines from the buffer
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // Keep the last incomplete line in the buffer

            for (const line of lines) {
              if (line.trim()) {
                try {
                  const message = JSON.parse(line) as StreamMessage;
                  cursor._processStreamMessage(message);
                } catch (e) {
                  console.error("Error parsing line:", e, line);
                }
              }
            }
          }
        } catch (err) {
          cursor._processStreamMessage({
            type: "error",
            error: `Stream processing error: ${err.message}`,
          });
          cursor._completeStreaming();
        }
      })();

      // Successfully initiated the request, return the cursor
      return cursor;
    } catch (error) {
      lastError = error;

      // Increment retry counter
      retries++;

      // If we have retries left, wait before retrying
      if (retries <= MAX_RETRIES) {
        // Exponential backoff: wait 2^retries * 100ms
        const backoffMs = Math.min(100 * Math.pow(2, retries), 2000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        console.log(
          `Retrying SQL execution (${retries}/${MAX_RETRIES}) after ${backoffMs}ms`,
        );
      } else {
        // Out of retries, report the error
        cursor._processStreamMessage({
          type: "error",
          error: `Failed after ${MAX_RETRIES} retries: ${lastError?.message}`,
        });
        cursor._completeStreaming();
        break;
      }
    }
  }

  return cursor;
}
