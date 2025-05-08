//@ts-check
/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from "cloudflare:workers";

export class DatabaseDO extends DurableObject {
  private storage: DurableObjectStorage;
  static env: any;

  constructor(state: DurableObjectState, env: any) {
    super(state, env);
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/exec" && request.method === "POST") {
      return await this.handleExecRequest(request);
    }

    // Handle other endpoints...
    return new Response(String(this.storage.sql.databaseSize), { status: 404 });
  }

  handleExecRequest = async (request: Request): Promise<Response> => {
    try {
      // Parse the request body
      const { query, bindings = [] } = (await request.json()) as {
        query: string;
        bindings: any[];
      };

      if (!query || typeof query !== "string") {
        return new Response(JSON.stringify({ error: "Query is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Create a TransformStream to stream the results
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Execute the query and stream results asynchronously
      (async () => {
        try {
          // Execute the SQL query
          const cursor = this.storage.sql.exec(query, ...bindings);

          // Send column names as metadata first
          await writer.write(
            encoder.encode(
              JSON.stringify({
                metadata: { columnNames: cursor.columnNames },
              }) + "\n",
            ),
          );

          // Stream each row as it comes
          for (const row of cursor) {
            await writer.write(encoder.encode(JSON.stringify({ row }) + "\n"));
          }

          // Send final metadata with stats
          await writer.write(
            encoder.encode(
              JSON.stringify({
                metadata: {
                  rowsRead: cursor.rowsRead,
                  rowsWritten: cursor.rowsWritten,
                },
              }) + "\n",
            ),
          );
        } catch (error) {
          console.error("SQL execution error:", error);
          // Send error information
          await writer.write(
            encoder.encode(JSON.stringify({ error: error.message }) + "\n"),
          );
        } finally {
          // Always close the writer when done
          await writer.close();
        }
      })();

      // Return the readable stream immediately
      return new Response(readable, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Transfer-Encoding": "chunked",
        },
      });
    } catch (error) {
      console.error("Request handling error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  // Other methods for your Durable Object...
}

type SqlStorageValue = ArrayBuffer | string | number | null;

// Client-side implementation of SqlStorageCursor
export class RemoteSqlStorageCursor<T extends Record<string, SqlStorageValue>> {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null;
  private buffer: string = "";
  private cachedResults: T[] | null = null;
  private currentIndex: number = 0;
  private _columnNames: string[] = [];
  private _rowsRead: number = 0;
  private _rowsWritten: number = 0;
  private done: boolean = false;
  private pendingChunk: Promise<
    { done?: boolean; value: T } | { done: true; value?: never }
  > | null = null;
  private pendingNextChunk: boolean = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
    // Start reading the first chunk immediately
    this.prepareNextChunk();
  }

  private prepareNextChunk(): void {
    if (this.done || this.pendingNextChunk) return;

    this.pendingNextChunk = true;
    this.pendingChunk = this.readNextChunk();
  }

  private async readNextChunk(): Promise<
    { done?: boolean; value: T } | { done: true; value?: never }
  > {
    if (this.done) {
      return { done: true };
    }

    try {
      const { done, value } = await this.reader!.read();

      if (done) {
        this.done = true;
        this.reader = null;

        // Process any remaining data in buffer
        if (this.buffer.trim()) {
          try {
            const data = JSON.parse(this.buffer) as any;
            if (data.row) {
              this._rowsRead++;
              return { value: data.row as T };
            } else if (data.metadata) {
              // Handle metadata
              this.processMetadata(data.metadata);
            }
          } catch (e) {
            console.error("Error parsing final buffer:", e);
          }
        }

        return { done: true };
      }

      // Decode and add to buffer
      const text = new TextDecoder().decode(value);
      this.buffer += text;

      // Process complete JSON objects
      const results: { value: T; done?: false }[] = [];

      // Look for complete JSON objects separated by newlines
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || ""; // Keep the last potentially incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const data = JSON.parse(line) as any;
          if (data.row) {
            this._rowsRead++;
            results.push({ value: data.row as T });
          } else if (data.metadata) {
            this.processMetadata(data.metadata);
          }
        } catch (e) {
          console.error("Error parsing JSON:", e, "Line:", line);
        }
      }

      if (results.length > 0) {
        // Reset the pending flag as we're about to return
        this.pendingNextChunk = false;
        return results[0]; // Return the first result
      } else {
        // No complete objects yet, read more
        return await this.readNextChunk();
      }
    } catch (error) {
      console.error("Error reading from stream:", error);
      this.done = true;
      return { done: true };
    }
  }

  private processMetadata(metadata: any): void {
    if (metadata.columnNames) {
      this._columnNames = metadata.columnNames;
    }
    if (metadata.rowsWritten !== undefined) {
      this._rowsWritten = metadata.rowsWritten;
    }
  }

  // This method is used for iterator protocol
  next(): Promise<{ done?: false; value: T } | { done: true }> {
    if (this.cachedResults) {
      if (this.currentIndex < this.cachedResults.length) {
        return Promise.resolve({
          value: this.cachedResults[this.currentIndex++],
        });
      }
      return Promise.resolve({ done: true });
    }

    if (!this.pendingChunk) {
      this.prepareNextChunk();
    }

    const result = this.pendingChunk!;
    this.pendingChunk = null;

    // Prepare next chunk if this wasn't the end
    result
      .then((r) => {
        if (!r.done) {
          this.prepareNextChunk();
        }
      })
      .catch((err) => {
        console.error("Error preparing next chunk:", err);
      });

    return result;
  }

  async toArray(): Promise<T[]> {
    if (this.cachedResults) {
      return this.cachedResults;
    }

    const results: T[] = [];

    // Use iterator to collect all rows
    let nextResult = await this.next();
    while (!nextResult.done) {
      results.push(nextResult.value);
      nextResult = await this.next();
    }

    this.cachedResults = results;
    return results;
  }

  async one(): Promise<T> {
    if (this.cachedResults) {
      if (this.cachedResults.length === 0) {
        throw new Error("No rows returned");
      }
      return this.cachedResults[0];
    }

    const result = await this.next();
    if (result.done || !("value" in result)) {
      throw new Error("No rows returned");
    }

    return result.value;
  }

  async *raw<U extends SqlStorageValue[]>(): AsyncIterableIterator<U> {
    let nextResult = await this.next();
    while (!nextResult.done) {
      yield Object.values(nextResult.value) as unknown as U;
      nextResult = await this.next();
    }
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

  // Make it iterable
  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return {
      //@ts-expect-error
      next: () => this.next(),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
}

// Non-async wrapper function to return cursor immediately
export function exec<T extends Record<string, SqlStorageValue>>(
  stub: any,
  query: string,
  ...bindings: any[]
): RemoteSqlStorageCursor<T> {
  // Start the fetch but don't await it
  const fetchPromise = stub.fetch(
    new Request("http://internal/exec", {
      method: "POST",
      body: JSON.stringify({ query, bindings }),
    }),
  );

  // Create a ReadableStream and writer that we control
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // Process the fetch in the background
  (async () => {
    try {
      const response = await fetchPromise;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SQL execution failed: ${errorText}`);
      }

      if (!response.body) {
        throw new Error("Response has no body");
      }

      // Pipe the response body to our transform stream
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
    } catch (error) {
      console.error("Error in fetch:", error);
      const encoder = new TextEncoder();
      await writer.write(
        encoder.encode(JSON.stringify({ error: error.message }) + "\n"),
      );
    } finally {
      await writer.close();
    }
  })();

  // Return cursor immediately with our controlled stream
  return new RemoteSqlStorageCursor<T>(readable);
}
