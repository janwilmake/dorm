## Ideas

- 🤔 Now, `initializeStorage` is ran every time the user connects, which does a lot of queries to the DO back and forth, that could be paralelized, or not done at all. It makes more sense to run this just once, only when changes were made to the schema, and without going to the worker and back. Normally it's done in the constructor of a durable object and all local. On the first fetch is fine too, but how it's now is obviously making it slow.

- Standardized KV table using JSON-Schema/Types: https://x.com/janwilmake/status/1915357190845538729

## POST (launch sunday or monday, 6pm)

[video:dorm1demo]

Prerelease: DORM 1.0.0-next. What's new?

- 🔥 Use the sql.exec cursor in your worker with configurable mirroring (powered by remote-sql-cursor)
- 🔥 New demo showcasing a multi-tenancy todo list (link below)
- 🔥 Super smooth outerbase integration for multi-tenancy and an aggregate overview
- 🔥 super easy to use LLM-friendly template file of just 4000 tokens.

Thanks @CasazzaNY @carollkindell for early feedback. Show me what you build with it!
