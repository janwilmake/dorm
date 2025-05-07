/**
 * @fileoverview SQL Client implementation for streaming SQL results
 * This module provides a client-side implementation for handling SQL streaming responses
 * that can be used both from TypeScript and vanilla JavaScript.
 * @module sql-client
 */

"use strict";

/** @constant {number} The maximum time to wait for a response in milliseconds */
const TIMEOUT = 30000;

/** @constant {number} Maximum number of retry attempts for failed requests */
const MAX_RETRIES = 1;

/**
 * @typedef {Object} StreamMessage
 * @property {"columns"|"row"|"meta"|"error"} type - The type of message in the stream
 * @property {any} [data] - The data payload of the message
 * @property {string} [error] - Error message if type is "error"
 */

/**
 * @typedef {string|number|boolean|null|Array<any>|Object<string, any>} SqlStorageValue
 * A value that can be stored in SQL storage
 */

/**
 * Client-side cursor that implements the expected SqlStorageCursor interface
 * @template {Object.<string, import('./types').SqlStorageValue>} T
 */
class ClientSqlCursor {
  /**
   * Creates a new instance of ClientSqlCursor
   */
  constructor() {
    /** @private @type {string[]} */
    this._columnNames = [];

    /** @private @type {any[][]} */
    this._rows = [];

    /** @private @type {number} */
    this._rowsRead = 0;

    /** @private @type {number} */
    this._rowsWritten = 0;

    /** @private @type {number} */
    this._currentIndex = 0;

    /** @private @type {boolean} */
    this._initialized = false;

    /** @private @type {string|null} */
    this._error = null;

    /** @private @type {boolean} */
    this._streamingComplete = false;

    /** @private @type {Promise<void>|null} */
    this._streamingPromise = null;

    /** @private @type {(() => void)|null} */
    this._resolveStreamingPromise = null;

    // Initialize the streaming promise
    this._streamingPromise = new Promise((resolve) => {
      this._resolveStreamingPromise = resolve;
    });
  }

  /**
   * Method to update cursor with stream data
   * @private
   * @param {StreamMessage} message - The message from the stream
   */
  _processStreamMessage(message) {
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

  /**
   * Mark streaming as complete and resolve the promise
   * @private
   */
  _completeStreaming() {
    if (!this._streamingComplete && this._resolveStreamingPromise) {
      this._streamingComplete = true;
      this._resolveStreamingPromise();
      this._resolveStreamingPromise = null;
    }
  }

  /**
   * Wait for streaming to complete
   * @returns {Promise<void>} Promise that resolves when streaming is complete
   */
  async waitForStreamingComplete() {
    if (this._streamingComplete) {
      return Promise.resolve();
    }
    return this._streamingPromise;
  }

  /**
   * Check if an error occurred during streaming
   * @type {string|null}
   */
  get error() {
    return this._error;
  }

  /**
   * Get the column names from the query result
   * @type {string[]}
   */
  get columnNames() {
    return this._columnNames;
  }

  /**
   * Get the number of rows read from storage
   * @type {number}
   */
  get rowsRead() {
    return this._rowsRead;
  }

  /**
   * Get the number of rows written to storage
   * @type {number}
   */
  get rowsWritten() {
    return this._rowsWritten;
  }

  /**
   * Check if the cursor has been initialized
   * @type {boolean}
   */
  get initialized() {
    return this._initialized;
  }

  /**
   * Generator that yields raw row data as arrays
   * @yields {any[]} Raw row data
   */
  *raw() {
    for (const row of this._rows) {
      yield row;
    }
  }

  /**
   * Generator that yields structured result objects
   * @yields {T} Structured result object
   * @template T
   */
  *results() {
    for (const row of this._rows) {
      const result = {};
      for (let i = 0; i < this._columnNames.length; i++) {
        const columnName = this._columnNames[i];
        result[columnName] = row[i];
      }
      yield result;
    }
  }

  /**
   * Returns the first result or null if no results
   * @returns {T|null} First result or null
   * @template T
   */
  one() {
    if (this._rows.length === 0) {
      return null;
    }

    const result = {};
    for (let i = 0; i < this._columnNames.length; i++) {
      const columnName = this._columnNames[i];
      result[columnName] = this._rows[0][i];
    }
    return result;
  }

  /**
   * Iterator protocol implementation
   * @returns {IteratorResult<T, undefined>} Iterator result
   * @template T
   */
  next() {
    if (this._currentIndex >= this._rows.length) {
      return { done: true, value: undefined };
    }

    const row = this._rows[this._currentIndex++];
    const result = {};
    for (let i = 0; i < this._columnNames.length; i++) {
      const columnName = this._columnNames[i];
      result[columnName] = row[i];
    }

    return {
      done: false,
      value: result,
    };
  }

  /**
   * Returns all results as an array, waiting for streaming to complete first
   * @returns {Promise<T[]>} Promise that resolves to an array of all results
   * @template T
   */
  async toArray() {
    // Wait for streaming to complete before returning results
    await this.waitForStreamingComplete();

    // Now convert results to array
    return Array.from(this.results());
  }

  /**
   * Makes the cursor iterable
   * @returns {Iterator<T, any, undefined>} Iterator
   * @template T
   */
  [Symbol.iterator]() {
    return {
      next: () => this.next(),
    };
  }
}

/**
 * Creates a client-side exec function that works with a DORM instance
 * with improved error handling and timeout support
 * @param {Object} stub - Durable Object stub for a DORM instance
 * @param {string} sql - The SQL query to execute
 * @param {...any} params - Parameters for the SQL query
 * @returns {Promise<ClientSqlCursor<T>>} A cursor for accessing the results
 * @template {Object.<string, import('./types').SqlStorageValue>} T
 */
async function exec(stub, sql, ...params) {
  // Create a new cursor to populate
  const cursor = new ClientSqlCursor();

  // Track retries
  let retries = 0;
  let lastError = null;

  while (retries <= MAX_RETRIES) {
    try {
      // In a cloudflare worker, use the DO. In browser, use the worker backend
      const origin =
        typeof window === "undefined" ? "https://internal-rpc" : "";

      // Create streaming request
      const req = new Request(`${origin}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params }),
      });

      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error(`Request timed out after ${TIMEOUT}ms`)),
          TIMEOUT,
        );
      });

      // Race between the request and timeout
      const response = await Promise.race([stub.fetch(req), timeoutPromise]);

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
                      const message = JSON.parse(line);
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
                  const message = JSON.parse(line);
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

// Export for CommonJS
module.exports = {
  ClientSqlCursor,
  exec,
};

// Export for ES modules (will be ignored in CommonJS environment)
if (typeof exports !== "undefined") {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.ClientSqlCursor = ClientSqlCursor;
  exports.exec = exec;
}
