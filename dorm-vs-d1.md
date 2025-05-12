# D1 vs DORM: Comprehensive Feature Comparison

## Overview

**D1**: Cloudflare's native serverless SQL database built on SQLite with global read replication and built-in disaster recovery.

**DORM**: Unlimited SQLite databases directly in your Worker using Durable Objects, designed for multi-tenant applications.

## Feature Comparison Table

| Feature                    | D1                                       | DORM                                   | Description                                                                                                                                      |
| -------------------------- | ---------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Database Architecture**  | SQLite-based serverless database         | SQLite within Durable Objects          | D1 runs on Cloudflare's managed infrastructure with automatic scaling. DORM uses Durable Objects to create isolated SQLite instances.            |
| **Multi-tenancy**          | Single database with logical separation  | Unlimited separate databases           | D1 requires implementing multi-tenancy at the application level within one database. DORM creates completely isolated databases per tenant/user. |
| **Maximum Databases**      | 50,000 (Paid) / 10 (Free)                | Unlimited                              | D1 has account-level limits. DORM databases are only limited by Durable Object limits.                                                           |
| **Database Size**          | 10GB per database                        | 10GB per database                      | Both platforms support up to 10GB per individual database.                                                                                       |
| **Query Location**         | Anywhere in Worker                       | Anywhere in Worker + DO                | Both support querying from Worker code, but DORM can also query inside Durable Objects.                                                          |
| **Read Replication**       | Global read replicas                     | Edge-localized to user                 | D1 offers managed global replication. DORM stores data closest to where it's accessed via DO location.                                           |
| **Migrations**             | Manual via Wrangler                      | JIT (Just-In-Time) automatic           | D1 requires explicit migration commands. DORM applies migrations automatically when a database is first accessed.                                |
| **Data Explorer**          | Native dashboard + REST API              | Outerbase integration                  | D1 has built-in dashboard tools. DORM integrates with Outerbase for visual data management.                                                      |
| **Pricing Model**          | Per rows read/written + storage          | Durable Object pricing                 | D1 charges based on query volume. DORM uses DO pricing (requests + duration + storage).                                                          |
| **Backup & Recovery**      | Time Travel (30 days)                    | DO state persistence                   | D1 offers point-in-time recovery. DORM relies on Durable Object state management.                                                                |
| **Local Development**      | Wrangler dev with local/remote options   | DO local development                   | D1 has robust local dev support. DORM uses DO's local development capabilities.                                                                  |
| **API Access**             | REST API + Worker Binding                | Worker Binding + REST via middleware   | D1 has official REST API. DORM provides REST access through custom middleware.                                                                   |
| **Transaction Support**    | Full SQLite transactions                 | Full SQLite transactions               | Both support SQLite transaction semantics.                                                                                                       |
| **Query Performance**      | Optimized for global scale               | Edge-optimized per DO                  | D1 is optimized for global performance. DORM performance depends on DO location relative to user.                                                |
| **Setup Complexity**       | Medium (requires wrangler config)        | Low (simple client creation)           | D1 requires database creation and binding setup. DORM creates databases on-demand with minimal config.                                           |
| **Schema Management**      | SQL DDL statements                       | SQL DDL + JSON Schema support          | D1 uses standard SQL. DORM adds JSON Schema to SQL conversion utilities.                                                                         |
| **Monitoring & Analytics** | Built-in metrics dashboard               | Basic via DO metrics                   | D1 provides detailed analytics. DORM relies on Durable Object metrics.                                                                           |
| **Import/Export**          | Native import/export commands            | Through SQL execution                  | D1 has dedicated import/export tools. DORM requires custom implementation.                                                                       |
| **Data Mirroring**         | Via read replicas                        | Custom mirror databases                | D1 uses read replicas for distribution. DORM supports custom mirroring to aggregate databases.                                                   |
| **Query Streaming**        | Standard result sets                     | Cursor-based streaming                 | D1 returns full result sets. DORM provides streaming cursors for large datasets.                                                                 |
| **Consistency Model**      | Sequential consistency with Sessions API | Strong consistency per DO              | D1 offers configurable consistency. DORM provides strong consistency within each Durable Object.                                                 |
| **Use Case Focus**         | General purpose, production workloads    | Multi-tenant SaaS applications         | D1 is designed for broad database needs. DORM specializes in tenant isolation scenarios.                                                         |
| **Platform Integration**   | Native Cloudflare service                | Built on Workers + DOs                 | D1 is a first-class Cloudflare service. DORM leverages existing Worker platform primitives.                                                      |
| **SQL Compatibility**      | SQLite 3.0+                              | SQLite (version depends on DO runtime) | Both use SQLite but D1 has specific version guarantees.                                                                                          |
| **Indexes**                | Full index support with analytics        | Standard SQLite indexes                | D1 provides index usage analytics. DORM uses standard SQLite indexing.                                                                           |
| **Environment Support**    | Development + Production modes           | DO environment dependent               | D1 has explicit environment separation. DORM follows DO deployment model.                                                                        |

## When to Use Each

### Choose D1 When:

- You need a traditional database with global scale
- You want managed replication and backups
- You prefer Cloudflare's native tooling and dashboard
- You have high query volumes across fewer databases
- You need detailed analytics and monitoring
- You want point-in-time recovery capabilities

### Choose DORM When:

- You need complete tenant isolation
- You want unlimited databases with zero marginal cost
- You prefer edge-localized data for lowest latency
- You're building multi-tenant SaaS applications
- You want simpler setup and deployment
- You need programmatic database creation
- You want to integrate with Outerbase for data exploration

## Cost Considerations

**D1**:

See [pricing page](https://developers.cloudflare.com/d1/platform/pricing/)

- Free tier: 5GB storage, limited queries
- Paid: $0.75/million rows read, $0.001/million rows written, $0.25/GB storage

**DORM**:

Charged as [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/), which is similar to D1:

- $0.15/million requests
- $12.50/million GB-seconds duration
- $0.25/GB storage per month
- $0.001 / million rows read
- $1.00 / million rows written

## Migration Path

Both platforms use SQLite, making migration between them relatively straightforward. However:

- D1 → DORM: Export data, create per-tenant DOs, import data
- DORM → D1: Aggregate tenant data, create unified schema, import to D1

The choice between D1 and DORM largely depends on your architecture needs: D1 for traditional database requirements with global scale, DORM for multi-tenant isolation with edge performance.
