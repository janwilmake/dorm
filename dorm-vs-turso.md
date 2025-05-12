# Turso vs DORM Feature Comparison

## Overview

**Turso** is a distributed SQLite database platform built on libSQL (a fork of SQLite), focused on low query latency and global distribution.

**DORM** (Durable Object Relational Mapping) is a Cloudflare Workers-based solution that provides unlimited SQLite databases directly within workers using Durable Objects.

## Feature Comparison

| Feature                     | Turso                                           | DORM                                     | Description                                                                                                          |
| --------------------------- | ----------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Platform Architecture**   | Distributed SQLite platform built on libSQL     | Cloudflare Durable Objects wrapper       | Turso runs on its own infrastructure with global edge locations, while DORM leverages Cloudflare's DO infrastructure |
| **Multi-tenancy**           | Limited on free plan, scalable on paid plans    | ✅ Unlimited databases (up to 10GB each) | DORM excels at multi-tenancy with unlimited DB creation, while Turso requires paid plans for extensive multi-tenancy |
| **Query Location**          | From anywhere via SDK/API                       | ✅ Directly from Workers                 | DORM allows queries from anywhere in your worker, Turso requires SDK/API calls                                       |
| **Data Explorer**           | ✅ Built-in web UI and CLI shell                | ✅ Outerbase integration                 | Both offer data exploration tools - Turso has native tools, DORM integrates with Outerbase                           |
| **Database Migrations**     | ✅ Schema migrations, branching                 | ✅ JIT migrations with versioning        | Both support migrations - Turso offers more advanced features like branching, DORM uses just-in-time migrations      |
| **Edge Performance**        | Global edge locations (30+)                     | Closest to user (Cloudflare edge)        | Both offer edge performance - Turso has specific locations, DORM uses Cloudflare's extensive network                 |
| **Embedded Replicas**       | ✅ Local replicas with sync                     | ❌ Not available                         | Turso offers embedded replicas for zero-latency reads, DORM doesn't have this feature                                |
| **Vector Search**           | ✅ Native vector support                        | ❌ Not mentioned                         | Turso has built-in vector search capabilities for AI applications                                                    |
| **Branching**               | ✅ Database branching for development           | ❌ Not available                         | Turso allows creating database branches for testing and development                                                  |
| **Point-in-Time Recovery**  | ✅ Up to 90 days (plan dependent)               | ❌ Not mentioned                         | Turso offers PITR with retention based on plan tier                                                                  |
| **SDK Support**             | Multiple languages (JS, Rust, Go, Python, etc.) | JavaScript/TypeScript only               | Turso has broader language support, DORM is JS/TS specific for Workers                                               |
| **Pricing Model**           | Usage-based (reads, writes, storage)            | Cloudflare Workers pricing               | Turso has specific database pricing, DORM uses CF Workers pricing model                                              |
| **Database Size Limit**     | Plan-dependent (up to 100GB)                    | 10GB per database                        | Turso can scale larger with paid plans, DORM has a fixed 10GB limit                                                  |
| **Authentication**          | Token-based with fine-grained permissions       | Secret key for REST API                  | Turso has more sophisticated auth, DORM uses simple secret keys                                                      |
| **REST API**                | ✅ Comprehensive Platform API                   | ✅ Built-in middleware                   | Both offer REST APIs - Turso's is more comprehensive, DORM's is simpler                                              |
| **SQL Compatibility**       | libSQL (SQLite fork) with extensions            | Standard SQLite                          | Turso uses enhanced libSQL, DORM uses standard SQLite                                                                |
| **Streaming Results**       | ✅ Cursor-based streaming                       | ✅ Cursor implementation                 | Both support streaming large result sets                                                                             |
| **Data Mirroring**          | ❌ Not mentioned                                | ✅ Mirror to aggregate DBs               | DORM offers built-in mirroring to aggregate databases                                                                |
| **Cloud Provider**          | Turso infrastructure (AWS & Fly)                | Cloudflare only                          | Turso has multi-cloud support, DORM is Cloudflare-specific                                                           |
| **Local Development**       | SQLite file, Turso CLI, or remote DB            | Local Workers dev environment            | Turso offers more local dev options, DORM uses Workers dev env                                                       |
| **Organization Management** | ✅ Teams, members, roles                        | ❌ Not available                         | Turso has built-in organization features, DORM relies on CF account management                                       |
| **Audit Logs**              | ✅ Available on paid plans                      | ❌ Not mentioned                         | Turso offers audit logging for compliance                                                                            |
| **Extensions**              | ✅ SQLite extensions (JSON, FTS5, etc.)         | ❌ Standard SQLite only                  | Turso includes many SQLite extensions, DORM uses vanilla SQLite                                                      |
| **Scale to Zero**           | ✅ Free plan only (deprecated)                  | ✅ Inherent with Durable Objects         | Both can scale to zero - Turso deprecated this, DORM has it naturally                                                |
| **JSON Schema Support**     | ❌ Not mentioned                                | ✅ JSON Schema to SQL conversion         | DORM offers JSON Schema table definitions, Turso uses SQL                                                            |
| **Platform Maturity**       | Production-ready, established platform          | Beta status                              | Turso is more mature, DORM is in beta                                                                                |

## Key Differentiators

### Turso Advantages

- **Mature platform** with production-ready features
- **Multiple language SDKs** for broader application support
- **Advanced features** like embedded replicas, vector search, and branching
- **Better authentication** and organization management
- **Point-in-time recovery** for data protection
- **Larger databases** possible with paid plans

### DORM Advantages

- **Unlimited databases** for true multi-tenancy
- **Zero configuration** - works directly in Cloudflare Workers
- **Lower latency** for Worker-based applications
- **Built-in data mirroring** to aggregate databases
- **Simpler setup** for Cloudflare-native applications
- **JSON Schema support** for easier table definitions
- **No additional costs** beyond Cloudflare Workers pricing

## Best Use Cases

### Choose Turso when:

- You need a production-ready, mature database platform
- Your application isn't exclusively on Cloudflare Workers
- You require advanced features like vector search or embedded replicas
- You need larger databases (>10GB)
- You want comprehensive SDK support across multiple languages
- You need enterprise features like audit logs and team management

### Choose DORM when:

- You're building exclusively on Cloudflare Workers
- You need unlimited multi-tenant databases
- You want the lowest possible latency in Workers
- You prefer JSON Schema for table definitions
- You need simple data aggregation across tenants
- You want to avoid additional database costs
