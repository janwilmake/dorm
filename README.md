# 🛏️ DORM - Unlimited SQLite DBs Directly In Your Worker

[![janwilmake/dorm context](https://badge.forgithub.com/janwilmake/dorm/tree/main/template.ts)](https://uithub.com/janwilmake/dorm/tree/main/template.ts) [![](https://badge.xymake.com/janwilmake/status/1915415919335006432)](https://xymake.com/janwilmake/status/1915415919335006432)

DORM makes building multi-tenant applications on Cloudflare **ridiculously easy** by letting you:

1. **Create unlimited SQLite DBs on the fly** (up to 10GB each)
2. **Query them directly from anywhere** in your worker (not just inside DOs)
3. **Explore and manage your data** with built-in [Outerbase](https://outerbase.com) integration
4. **Migrate once, everywhere** with built-in JIT migration-support

Perfect for SaaS applications, user profiles, rate limiting, or any case where you need isolated data stores that are **lightning fast** at the edge.

[Demo app: https://dorm.wilmake.com](https://dorm.wilmake.com) | [Give me a like/share on X](https://x.com/janwilmake/status/1921932074581168337)

## ⚡ Key Benefits vs Alternatives

| Feature                  | Vanilla DOs         | **DORM** 🛏️             | D1          | Turso               |
| ------------------------ | ------------------- | ----------------------- | ----------- | ------------------- |
| **Multi-tenant**         | ✅ Unlimited        | ✅ Unlimited            | ❌ One DB   | Pricey              |
| **Query from worker**    | ❌ Only in DO       | ✅                      | ✅          | ✅                  |
| **Data Explorer**        | ❌                  | ✅ Outerbase            | ✅          | ✅                  |
| **Migrations**           | ❌                  | ✅                      | ✅          | ✅                  |
| **Edge Performance**     | Closest to user     | Closest to user         | Global edge | Global edge         |
| **Developer Experience** | ❌ Verbose, complex | ✅ Clean, low verbosity | ✅ Good     | Good, not CF native |

See [Turso vs DORM](turso-vs-dorm.md) and [DORM vs D1](dorm-vs-d1.md) for a more in-depth comparison with these alternatives. Also, see the [pricing comparison here](pricing-comparison.md)

## 🚀 Quick Start

Check out the [live TODO app demo](https://dorm.wilmake.com) showing multi-tenant capabilities.

Install `dormroom` as dependency...

```bash
npm i dormroom@next
```

...or fork this repo, and use [template.ts](https://github.com/janwilmake/dorm/blob/main/template.ts) as a starting point.

| Summary                                            | Prompt it                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Working example/template on how to use this        | [![](https://b.lmpify.com/guide)](https://letmeprompt.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fdorm%2Ftree%2Fmain%3FpathPatterns%3Dtemplate.ts%0A%0APlease%20create%20a%20new%20cloudflare%20typescript%20worker%20that%20uses%20DORM%20for%20storage%20with%20the%20following%20state%20and%20functionality%3A%20...)                                          |
| Entire implementation of the package               | [![](https://b.lmpify.com/source)](https://letmeprompt.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fdorm%2Ftree%2Fmain%3FpathPatterns%3Dmod.ts%26pathPatterns%3Dpackage.json%0A%0ACan%20you%20tell%20me%20more%20about%20the%20security%20considerations%20of%20using%20this%20package%3F)                                                                          |
| Create a customized guide for a particular usecase | [![](https://b.lmpify.com/create_guide)](https://letmeprompt.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fdorm%2Ftree%2Fmain%3FpathPatterns%3DREADME.md%26pathPatterns%3Dtemplate.ts%0A%0APlease%20create%20a%20new%20template%20for%20dorm%20similar%20to%20the%20provided%20template%2C%20for%20the%20following%20usecase%3A%20Multi-tenant%20Messaging%20System) |
| General information                                | [![](https://b.lmpify.com/general)](https://letmeprompt.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fdorm%2Ftree%2Fmain%3FpathPatterns%3DREADME.md%26pathPatterns%3DLICENSE.md%0A%0AWhat%20are%20the%20limitations%3F)                                                                                                                                              |

### View your data with Outerbase Studio:

Local Development:

1. Install: https://github.com/outerbase/studio
2. Create starbase connecting to: http://localhost:8787/{tenant}/api/db (or your port, your prefix)

Production: Use https://studio.outerbase.com

## 🔥 Top Use Cases

### 1. Multi-tenant SaaS applications

Create a separate database for each customer/organization:

```typescript
const client = createClient({
  doNamespace: env.DORM_NAMESPACE,
  ctx: ctx,
  configs: [
    { name: `tenant:${tenantId}` }, // One DB per tenant
    { name: "aggregate" }, // Optional: Mirror to aggregate DB
  ],
});
```

### 2. Global user profiles with edge latency

Store user data closest to where they access it:

```typescript
const client = createClient({
  doNamespace: env.DORM_NAMESPACE,
  ctx: ctx,
  configs: [
    { name: `user:${userId}` }, // One DB per user
  ],
});
```

### 3. Data aggregation with mirroring

Mirror tenant operations to a central database for analytics:

```typescript
const client = createClient({
  doNamespace: env.DORM_NAMESPACE,
  ctx: ctx,
  configs: [
    { name: `tenant:${tenantId}` }, // Main DB
    { name: "aggregate" }, // Mirror operations to aggregate DB
  ],
});
```

When creating mirrors, be wary of naming collisions and database size:

- **Unique id collisions**: when you use auto-increment and unique IDs (or columns in general), you may run into the issue that the value is unique in the main DB, but not in the mirror. This is currently not handled and your mirror query will silently fail! To prevent this issue I recommend not using auto increment or random in the query, and generate unique IDs beforehand when doing a query, so the data remains the same.

- **Size**: You have max 10GB. When executing a query, you can choose to use `skipMirror:true` to not perform the same query in the mirror db, to save on size for DBs with larger tables.

## ✨ Key Features

- **Direct SQL anywhere**: No need to write DO handler code - query from your worker
- **Outerbase integration**: Explore and manage your data with built-in tools
- **JSON Schema support**: Define tables using JSON Schema with automatic SQL translation
- **Streaming queries**: Efficient cursor implementation for large result sets
- **JIT Migrations**: Migrations are applied when needed, just once, right before a DO gets accessed (via `@Migratable`)
- **Data mirroring**: Mirror operations to aggregate databases for analytics
- **Low verbosity**: Clean API that hides Durable Object complexity

## 🛠️ Advanced Features

### Setting up your Durable Object with Migrations

```typescript
import { Migratable } from "migratable-object";
import { Streamable } from "remote-sql-cursor";
import { Transfer } from "transferable-object";

@Migratable({
  migrations: {
    1: [`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT)`],
    2: [`ALTER TABLE users ADD COLUMN email TEXT`],
  },
})
@Streamable()
export class DORM extends DurableObject {
  transfer = new Transfer(this);
  sql: SqlStorage;

  constructor(state: DurableObjectState, env: any) {
    super(state, env);
    this.sql = state.storage.sql;
  }

  getDatabaseSize() {
    return this.sql.databaseSize;
  }
}
```

### JSONSchema to SQL Conversion

```typescript
import { jsonSchemaToSql, TableSchema } from "dormroom";

const userSchema: TableSchema = {
  $id: "users",
  properties: {
    id: { type: "string", "x-dorm-primary-key": true },
    name: { type: "string", maxLength: 100 },
    email: { type: "string", "x-dorm-unique": true },
  },
  required: ["id", "name"],
};

const sqlStatements = jsonSchemaToSql(userSchema);
```

### Streaming Query Results

```typescript
// Get a cursor for working with large datasets
const cursor = client.exec<UserRecord>("SELECT * FROM users");

// Stream results without loading everything into memory
for await (const user of cursor) {
  // Process each user individually
}

// Or get all results at once
const allUsers = await cursor.toArray();
```

### REST API for Data Access

```typescript
// Access your database via REST API
const middlewareResponse = await client.middleware(request, {
  prefix: "/api/db",
  secret: "my-secret-key",
});

if (middlewareResponse) {
  return middlewareResponse;
}
```

### Extending DORM

You can extend DORM with your own DO implementation to circumvent limitations doing single queries remotely gives you.

```typescript
@Migratable({
  migrations: {
    1: [`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT)`],
  },
})
@Streamable()
export class YourDO extends DurableObject {
  transfer = new Transfer(this);
  sql: SqlStorage;

  constructor(state: DurableObjectState, env: any) {
    super(state, env);
    this.sql = state.storage.sql;
  }

  async myExtendedFunction() {
    // Multiple queries in one transaction
    const users = await this.sql.exec("SELECT * FROM users").toArray();
    const count = await this.sql
      .exec("SELECT COUNT(*) as count FROM users")
      .one();
    return { users, count };
  }

  getDatabaseSize() {
    return this.sql.databaseSize;
  }
}
```

This allows:

- Doing a multitude of SQL queries inside of your DO from a single API call
- Using alarms and other features
- Complex transactions

## 📊 Performance & Limitations

- ✅ **Nearly zero overhead**: Thin abstraction over DO's SQLite
- ✅ **Edge-localized**: Data stored closest to where it's accessed
- ✅ **Up to 10GB per DB**: Sufficient for most application needs
- ❌ Because you execute your SQL queries from a remote resource, you will more quickly run into the max subrequests limitation of 1000 max subrequests (50 on Cloudflare free). Also you can't benefit from other primitives in your Durable Object you'd normally have like alarms and an infinite amount of subrequests. If this is too big a limitation, you can [extend DORM](#extending-dorm) to still benefit from the dorm primitives while also have all abilities of raw Durable Objects.
- ❓ Localhost isn't easily accessible YET in https://studio.outerbase.com so you need to deploy first, [use a tunnel](https://dev.to/tahsin000/free-services-to-expose-localhost-to-https-a-comparison-5c19), or run the [outerbase client](https://github.com/outerbase/studio) on localhost.

## 🔗 Links & Resources

- [X-OAuth Template using DORM](https://github.com/janwilmake/x-dorm-template)
- [Follow me on X](https://x.com/janwilmake) for updates
- [Original project: ORM-DO](https://github.com/janwilmake/orm-do)
- [Inspiration/used work - The convention outerbase uses](https://x.com/BraydenWilmoth/status/1902738849630978377) is reapplied to make the integration with outerbase work!
- [Original idea](https://x.com/janwilmake/status/1884548509723983938) for mirroring
- [DORM uses a 'remote sql cursor' at its core - see repo+post here](https://x.com/janwilmake/status/1920274164889354247)

## 🚧 Status: Beta

DORM is currently in beta. API may change, but core functionality is stable.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/janwilmake/dorm)
