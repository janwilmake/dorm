# 🛏️ DORM - Unlimited SQLite DBs Directly In Your Worker

> [!IMPORTANT]
> Opinionated version of [ORM-DO](https://github.com/janwilmake/orm-do)

Durable Object Relational Mapping, Functionality

- 🔥 Abstracts away from the DO so you can just perform SQL queries to state from unlimited SQLite DBs, directly from your workers.
- 🔥 Compatible and linked with @outerbase to easily explore the state of the DO or DOs
- 🔥 query fn promises json/ok directly from the worker. This makes working with it a lot simpler.
- 🔥 allow creating tables from JSON-Schemas
- 🔥 adds simple ORM functionality: create, update, remove, select

# Usage & Demo

Installation is a snooze:

```
npm i dormroom
```

See [example.ts](example.ts) and [wrangler.jsonc](wrangler.jsonc) how to use!

See https://dorm.wilmake.com to see that live. This demonstrates it works using a users management API and HTML for that. X Post: https://x.com/janwilmake/status/1912146275597721959

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/janwilmake/dorm)

# Why?

I'm looking for a simpler way to create stateful workers with multiple DBs. One of the issues I have with DOs is that they're hard to work with and your code becomes verbose quite easily. Also it's not yet easy to explore multiple databases. This is an abstraction that ensures you can perform state queries directly from your worker, queue, schedule, etc, more easily.

My ultimate goal would be to be able to hook it up to github oauth and possibly [sponsorflare](https://sponsorflare.com) and have anyone explore their own data.

I'm still experimenting. Hit me up if you've got ideas!

Made by [janwilmake](https://x.com/janwilmake).
