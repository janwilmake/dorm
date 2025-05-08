# 🛏️ DORM - Unlimited SQLite DBs Directly In Your Worker

[![janwilmake/dorm context](https://badge.forgithub.com/janwilmake/dorm/tree/main)](https://uithub.com/janwilmake/dorm) [![](https://badge.xymake.com/janwilmake/status/1915415919335006432)](https://xymake.com/janwilmake/status/1915415919335006432)

> **DORM = Durable Object Relational Mapping**: A developer-friendly interface to SQLite databases in Cloudflare Workers

## 🔍 What & Why

DORM makes building multi-tenant applications on Cloudflare **ridiculously easy** by letting you:

1. **Create unlimited SQLite DBs on the fly** (up to 10GB each)
2. **Query them directly from anywhere** in your worker (not just inside DOs)
3. **Explore and manage your data** with built-in [Outerbase](https://outerbase.com) integration

Perfect for SaaS applications, user profiles, rate limiting, or any case where you need isolated data stores that are **lightning fast** at the edge.

[Demo app: https://dorm.wilmake.com](https://dorm.wilmake.com) | [Give me a like/share on X](https://x.com/janwilmake/status/1915123176754888929)

## ⚡ Key Benefits vs Alternatives

| Approach    | Multi-tenant | Query Anywhere | Data Explorer | Edge Performance | Developer Experience    |
| ----------- | ------------ | -------------- | ------------- | ---------------- | ----------------------- |
| **DORM**    | ✅ Unlimited | ✅ From worker | ✅ Outerbase  | Closest to user  | ✅ Clean, low verbosity |
| D1          | ❌ Single DB | ✅ From worker | ✅ Dashboard  | Global edge      | ✅ Good                 |
| Turso       | ✅ Multi-DB  | ✅ From worker | ✅ CLI tools  | Global edge      | Good, not CF native     |
| Vanilla DOs | ✅ Unlimited | ❌ Only in DO  | ❌            | Closest to user  | ❌ Verbose, complex     |
| Drizzle     | ORM only     | Depends        | ❌            | Depends          | Good                    |

## 🚀 Quick Start

Check out the [live TODO app demo](https://dorm.wilmake.com) showing multi-tenant capabilities.

Install `dormroom` as dependency...

```bash
npm i dormroom
```

...or fork this repo, and use [template.ts](https://github.com/janwilmake/dorm/blob/main/template.ts) as a starting point.

## 🔥 Top Use Cases

### 1. Multi-tenant SaaS applications

Create a separate database for each customer/organization:

```typescript
const client = await createClient({
  doNamespace: env.MY_DO_NAMESPACE,
  version: "v1",
  name: `tenant:${tenantId}`, // One DB per tenant
  statements: [
    /* Your schema */
  ],
});
```

### 2. Global user profiles with edge latency

Store user data closest to where they access it:

```typescript
const client = await createClient({
  doNamespace: env.MY_DO_NAMESPACE,
  version: "v1",
  name: `user:${userId}`, // One DB per user
});
```

### 3. Data aggregation with mirroring

Mirror tenant operations to a central database for analytics:

```typescript
const client = await createClient({
  doNamespace: env.MY_DO_NAMESPACE,
  name: `tenant:${tenantId}`,
  mirrorName: "aggregate", // Mirror operations to an aggregate DB
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
- **Transaction support**: Full ACID compliance for reliable operations
- **Data mirroring**: Mirror operations to aggregate databases for analytics
- **Low verbosity**: Clean API that hides Durable Object complexity

## 🛠️ Advanced Features

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
```

### REST API for Data Access

```typescript
// Access your database via REST API
const middlewareResponse = await client.middleware(request, {
  prefix: "/api/db",
  secret: "my-secret-key",
});
```

## 📊 Performance & Limitations

- ✅ **Nearly zero overhead**: Thin abstraction over DO's SQLite
- ✅ **Edge-localized**: Data stored closest to where it's accessed
- ✅ **Up to 10GB per DB**: Sufficient for most application needs
- ❓ **No built-in migrations**: Beyond version-based creation. If you don't mind removing away all your data when migrating, the easiest way to migrate is to simply change the version in the config, which will be prefixed to the DO name such that you have a fresh database created. However, if this isn't an option, the current best way is to write migrations yourself with SQLite queries, for example, https://www.techonthenet.com/sqlite/tables/alter_table.php. Cloudflare may be improving this in the future, but these are the options right now.

## 🔗 Links & Resources

- [X-OAuth Template using DORM](https://github.com/janwilmake/x-oauth-template)
- [Follow me on X](https://x.com/janwilmake) for updates
- [Original project: ORM-DO](https://github.com/janwilmake/orm-do)
- [Inspiration/used work - The convention outerbase uses](https://x.com/BraydenWilmoth/status/1902738849630978377) is reapplied to make the integration with outerbase work!
- [Original idea](https://x.com/janwilmake/status/1884548509723983938) for mirroring

## 🚧 Status: Beta

DORM is currently in beta. API may change, but core functionality is stable.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/janwilmake/dorm)
