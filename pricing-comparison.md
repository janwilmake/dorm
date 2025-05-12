# Comprehensive Database Pricing Comparison Table

Sources:

- DORM: https://developers.cloudflare.com/durable-objects/platform/pricing/index.md
- D1: https://developers.cloudflare.com/d1/platform/pricing/index.md
- Turso (no markdown available): https://turso.tech/pricing?frequency=monthly

## Free Tier Comparison

| Feature                   | DO/DORM (Workers Free)  | D1 (Workers Free)  | Turso (Free)      |
| ------------------------- | ----------------------- | ------------------ | ----------------- |
| **Base Cost**             | $0                      | $0                 | $0                |
| **Databases**             | Unlimited (SQLite only) | 1                  | 500               |
| **Row Reads**             | 5 million/day           | 5 million/day      | 500 million/month |
| **Row Writes**            | 100,000/day             | 100,000/day        | 10 million/month  |
| **Storage**               | 5 GB total              | 5 GB total         | 5 GB total        |
| **Compute/Duration**      | 13,000 GB-s/day         | N/A                | N/A               |
| **Requests**              | 100,000/day             | N/A                | N/A               |
| **Syncs**                 | N/A                     | N/A                | 3 GB/month        |
| **Point-in-Time Restore** | N/A                     | N/A                | 1 day             |
| **Reset Period**          | Daily at 00:00 UTC      | Daily at 00:00 UTC | Monthly           |

## Entry-Level Paid Tier Comparison

| Feature                   | DO/DORM (Workers Paid) | D1 (Workers Paid) | Turso (Developer) |
| ------------------------- | ---------------------- | ----------------- | ----------------- |
| **Base Cost**             | $5/month               | $5/month          | $5.99/month       |
| **Databases**             | Unlimited              | 1                 | 1,000             |
| **Row Reads Included**    | 25 billion/month       | 25 billion/month  | 2.5 billion/month |
| **Row Reads Overage**     | $0.001/million         | $0.001/million    | $1/billion        |
| **Row Writes Included**   | 50 million/month       | 50 million/month  | 25 million/month  |
| **Row Writes Overage**    | $1.00/million          | $1.00/million     | $1/million        |
| **Storage Included**      | 5 GB                   | 5 GB              | 9 GB              |
| **Storage Overage**       | $0.20/GB-month         | $0.75/GB-month    | $0.75/GB          |
| **Compute Included**      | 400,000 GB-s           | N/A               | N/A               |
| **Compute Overage**       | $12.50/million GB-s    | N/A               | N/A               |
| **Requests Included**     | 1 million              | N/A               | N/A               |
| **Requests Overage**      | $0.15/million          | N/A               | N/A               |
| **Syncs Included**        | N/A                    | N/A               | 10 GB/month       |
| **Syncs Overage**         | N/A                    | N/A               | $0.35/GB          |
| **Point-in-Time Restore** | N/A                    | N/A               | 10 days           |

## Higher Tier Comparison (Turso Only)

| Feature                   | Turso Scaler      | Turso Pro              |
| ------------------------- | ----------------- | ---------------------- |
| **Base Cost**             | $29/month         | $499/month             |
| **Databases**             | 10,000            | Unlimited              |
| **Row Reads Included**    | 100 billion/month | 250 billion/month      |
| **Row Reads Overage**     | $0.80/billion     | $0.75/billion          |
| **Row Writes Included**   | 100 million/month | 250 million/month      |
| **Row Writes Overage**    | $0.80/million     | $0.75/million          |
| **Storage Included**      | 24 GB             | 50 GB                  |
| **Storage Overage**       | $0.50/GB          | $0.45/GB               |
| **Syncs Included**        | 24 GB/month       | 100 GB/month           |
| **Syncs Overage**         | $0.25/GB          | $0.15/GB               |
| **Point-in-Time Restore** | 30 days           | 90 days                |
| **Audit Logs**            | 14 day retention  | 30 day retention       |
| **Teams**                 | ✅                | ✅                     |
| **DPA**                   | ✅                | ✅                     |
| **SSO**                   | ❌                | ✅                     |
| **HIPAA**                 | ❌                | ✅                     |
| **SOC2**                  | ❌                | ✅                     |
| **Support**               | Community         | Priority Email & Slack |

## Feature-by-Feature Comparison

| Feature                | DO/DORM        | D1           | Turso              |
| ---------------------- | -------------- | ------------ | ------------------ |
| **Multi-tenant DBs**   | ✅ Unlimited   | ❌ Single DB | ✅ Limited by plan |
| **Query from Workers** | ✅ Via DORM    | ✅ Native    | ✅ Via SDK         |
| **WebSocket Support**  | ✅             | ❌           | ❌                 |
| **RPC Support**        | ✅             | ❌           | ❌                 |
| **SQL Explorer**       | ✅ Outerbase   | ✅ Dashboard | ✅ Drizzle Studio  |
| **Migrations**         | ✅ JIT         | ✅           | ✅                 |
| **Edge Performance**   | ✅ Native      | ✅ Native    | ✅ Global          |
| **Key-Value Storage**  | ✅ (Paid only) | ❌           | ❌                 |
| **SQLite Storage**     | ✅             | ✅           | ✅                 |
| **Data Mirroring**     | ✅ Via DORM    | ❌           | ❌                 |

## Billing Model Differences

| Aspect                 | DO/DORM                | D1                       | Turso                    |
| ---------------------- | ---------------------- | ------------------------ | ------------------------ |
| **Billing Unit**       | Compute time + Storage | Row operations + Storage | Row operations + Storage |
| **Free Tier Reset**    | Daily                  | Daily                    | Monthly                  |
| **Minimum Paid**       | $5/month               | $5/month                 | $5.99/month              |
| **Scale Pricing**      | Linear                 | Linear                   | Tiered discounts         |
| **Overage Handling**   | Automatic              | Automatic                | Configurable             |
| **Enterprise Options** | Via CloudFlare         | Via CloudFlare           | Custom pricing           |

## Special Considerations

### DO/DORM Specific

- WebSocket messages counted at 20:1 ratio for billing
- Duration billed while DO is active (wall-clock time)
- 128 MB memory allocated per DO
- Request context extends 10s after last client disconnect
- Hibernation API can reduce duration charges

### D1 Specific

- DDL operations count as both reads and writes
- Indexes reduce reads but add writes
- Empty tables/databases consume minimal storage
- No egress/bandwidth charges

### Turso Specific

- Database branches count against database limit
- Point-in-time restores use database slots
- Embedded syncs billed by libSQL pages
- Drizzle Studio usage counts as row operations
- Overages can be enabled/disabled

## Cost Optimization Tips

| Platform    | Optimization Strategy                                                 |
| ----------- | --------------------------------------------------------------------- |
| **DO/DORM** | Use WebSocket hibernation, minimize active duration, batch operations |
| **D1**      | Use indexes strategically, optimize queries, leverage caching         |
| **Turso**   | Stay within tier limits, use appropriate plan, monitor sync usage     |

## Summary Comparison

| Metric                       | Best For                 |
| ---------------------------- | ------------------------ |
| **Lowest Entry Cost**        | DO/DORM or D1 ($5/month) |
| **Most Generous Free Tier**  | Turso (500M reads/month) |
| **Best Multi-tenant Value**  | DO/DORM (unlimited DBs)  |
| **Cheapest Storage**         | DO/DORM ($0.20/GB)       |
| **Best Enterprise Features** | Turso Pro                |
| **Simplest Pricing**         | D1                       |
| **Most Predictable Costs**   | D1 or Turso              |
