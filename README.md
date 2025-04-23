# 🛏️ DORM - Unlimited SQLite DBs Directly In Your Worker

[![janwilmake/dorm context](https://badge.forgithub.com/janwilmake/dorm/tree/main)](https://uithub.com/janwilmake/dorm)

Dorm stands for Durable Object Relational Mapping. It effectively allows for a more DX friendly interface with [SQLite-DO's in Cloudflare](https://blog.cloudflare.com/sqlite-in-durable-objects/). Here's how it compares with vanilla SQLite DO's.

| Feature                         | Vanilla DOs | DORM |
| ------------------------------- | ----------- | ---- |
| Up to 10GB storage per DB       | ✅          | ✅   |
| Create unlimited DBs on the fly | ✅          | ✅   |
| Direct SQL queries              | ❌          | ✅   |
| Low code verbosity              | ❌          | ✅   |
| Built-in data exploration tools | ❌          | ✅   |
| JSON response format            | ❌          | ✅   |
| JSON schema support             | ❌          | ✅   |
| Data mirroring capability       | ❌          | ✅   |
| Simple ORM functionality        | ❌          | ✅   |
| Easy database sharding          | ❌          | ✅   |
| Simple worker integration       | ❌          | ✅   |

The hottest features, explained:

- 🔥 Abstracts away from the DO so you can just perform SQL queries to state from unlimited SQLite DBs, directly from your workers.
- 🔥 The query promises json directly from the worker. This makes working with it a lot simpler.
- 🔥 Compatible and linked with [@outerbase](https://outerbase.com) to easily explore the state of the DO or DOs
- 🔥 Allow creating tables from JSON-Schemas
- 🔥 Allows mirroring your queries/data in other database
- 🔥 Supports simple ORM functionality: create, update, remove, select

# Usage & Demo

Installation is a snooze:

```
npm i dormroom
```

See [example.ts](example.ts) and [wrangler.jsonc](wrangler.jsonc) how to use!

See https://dorm.wilmake.com to see that live. This demonstrates it works using a users management API and HTML for that. X Post: https://x.com/janwilmake/status/1912146275597721959

The entire library is under 1000 lines of code with a minimalist API. Check out the source files directly to see the complete implementation - the code is the documentation

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/janwilmake/dorm)

# Why?

I'm looking for a simpler way to create stateful workers with multiple DBs. One of the issues I have with DOs is that they're hard to work with and your code becomes verbose quite easily. Also it's not yet easy to explore multiple databases. This is an abstraction that ensures you can perform state queries directly from your worker, queue, schedule, etc, more easily.

My ultimate goal would be to be able to hook it up to github oauth and possibly [sponsorflare](https://sponsorflare.com) and have anyone explore their own data.

I'm still experimenting. [Hit me up](https://x.com/janwilmake) if you've got ideas! Feedback much appreciated.

# How does it work?

DORM is an abstraction to [Durable Objects](https://developers.cloudflare.com/durable-objects/). I've [played with DOs a lot](https://github.com/stars/janwilmake/lists/durable-objects), but this is an abstraction I find actually **very useful** because it allows a much less bloaty experience with data in a DO. The advantage compared to a [regular D1 database](https://developers.cloudflare.com/d1/) is that you can make as many of them as you want, on the fly, with up to 10GB a piece.

On top of that, one of the major problems with Cloudflare DOs is the ability to easily view the data. DORM has a smooth integration with [Outerbase Studio](https://github.com/outerbase/studio) so you can view all your data as well as manipulate it.

![](outerbase.png)

# Docs

## Database naming

The best USP of DORM is the ability to create as many databases as you want. When creating the client, you can specify a name, which translates into a unique database. Because of this you can choose to shard your database in many different ways. By IP, by country or region, by username, or by company, for example. My biggest usecase for DORM is to shard data by user (for [Sponsorflare](https://github.com/janwilmake/cloudflare-sponsorware)), which makes sure the DO is spawned as close to the user as possible, making it VERY FAST. For doing ratelimits, you could use the IP/username as name as well.

## Migrations

Migrations are a pain. If you don't mind removing away all your data when migrating, the easiest way to migrate is to simply change the version in the config, which will be prefixed to the DO name such that you have a fresh database created. However, if this isn't an option, the current best way is to write migrations yousrelf with SQLite queries, for example, https://www.techonthenet.com/sqlite/tables/alter_table.php. Cloudflare may be improvign this in the future, but these are the optioins right now.

## Mirroring

DORM has **experimental** support for creating a mirror for every query you execute in a database. This mirror is most useful to create an aggregate of your data. For example, you can use a `{mirrorName: "db:root"}` for every `{name: username}` in order to have an aggregate of all users into a single database. For example, https://github.com/janwilmake/x-oauth-template uses it like this.

When creating mirrors, be wary of naming collsions and database size!

- **Unique id collisions**: when you use auto-increment and unique IDs (or columns in general), you may run into the issue that the value is unique in the main DB, but not in the mirror. This is currenlty not handled and your mirror query will silently fail! To prevent this issue I recommend not using auto increment or random in the query, and generate unique IDs beforehand when doing a query, so the data remains the same.

- **Size**: You have max 10GB. When executing a query, you can choose to `skipMirror:true` to not perform the same query in the mirror db, to save on size for DBs with larger tables.

Based on the code you've shared, I can see that error handling is fairly straightforward, using a conventional pattern of returning status codes and error messages in JSON responses. However, it could be more explicitly documented. Here are sections you could add to your README regarding error handling, performance, security, and limitations:

## Error Handling

DORM uses a simple approach to error handling: query operations return a result object with `{ json, status, ok }` structure. When an error occurs, the `ok` flag is set to `false`, the `status` contains the HTTP status code, and the `json` is `null`. This allows you to handle errors in a predictable way:

```javascript
const result = await client.query(
  "SELECT * FROM users WHERE id = ?",
  undefined,
  userId,
);
if (!result.ok) {
  console.error(`Error fetching user: ${result.status}`);
  // Handle the error appropriately
} else {
  // Process successful result
  const user = result.json[0];
}
```

For queries through the HTTP API, errors are returned as JSON responses with an appropriate status code and an `error` field containing the error message.

## Performance

DORM is a thin abstraction over Cloudflare's Durable Objects with SQLite. The performance overhead compared to vanilla DOs is minimal, as it's primarily adding ergonomics rather than additional processing layers. Since each database operates in its own DO, you get the benefit of edge-localized data access.

The biggest performance win comes from database sharding capability - by creating databases per user, region, or other dimensions, you can ensure data is stored and processed as close as possible to where it's needed, reducing latency significantly.

Keep in mind that while SQLite in DOs is fast, complex queries or large datasets will still have performance implications. Use appropriate indexes and keep your schemas optimized.

## Security

DORM allows exposing the DB over a REST API with basic security through an optional secret-based authentication for API access:

```javascript
const middlewareResponse = await client.middleware(request, {
  prefix: "/api/db",
  // Authentication secret
  secret: "my-secret-key",
});
```

When using DORM, ensure to use good pratices as you would with any DB. However, you should implement additional security layers for production use:

1. Use authentication mechanisms like JWT or OAuth for user or multi-admin REST access
2. Sanitize all SQL inputs to prevent injection attacks (DORM uses parameterized queries, which helps)
3. Use environment variables rather than hardcoding them

## Limitations

I'm still experimenting with DORM, so there are some limitations to be aware of:

- Currently, no built-in schema migration system (beyond creating a new version)
- Mirror functionality is experimental and has potential issues with ID collisions
- No built-in pagination helpers for large result sets
- Limited ORM capabilities compared to full-featured ORMs
- This is primarily designed for Cloudflare Workers environment, not for other platforms

DORM is meant to be minimal so there won't be better support for ORM features over time. For more advanced usage, you can just use the raw `query` functionality to do anything.

# Other projects

- The first version, [ORM-DO](https://github.com/janwilmake/orm-do), is more raw and doesn't provide the opinionated choices I made for an even smoother DX. It can be used as a starting point when you have other opinions :)
