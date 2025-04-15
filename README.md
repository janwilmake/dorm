# ORM DO - Unlimited SQLite DBs Directly In Your Worker

Functionality

- 🔥 Abstracts away from the DO so you can just perform SQL queries to state from unlimited SQLite DBs, directly from your workers.
- 🔥 Compatible and linked with outerbase to easily explore the state of the DO or DOs
- 🔥 Does not support streaming or cursors, always responds Promises immediate from the query. This makes working with it a lot simpler.

# Usage

In your `wrangler.toml`

```toml
[[durable_objects.bindings]]
name = "MY_EXAMPLE_DO"
class_name = "ORMDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ORMDO"]
```

In your worker:

```ts
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
  // Optional: used for authenticating requests
  authSecret: "my-secret-key",
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

    ///... YOUR ENDPOINTS HERE USING DB CLIENT
  },
};
```

Made by [janwilmake](https://x.com/janwilmake).
