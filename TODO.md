# Ideas

- Standardized KV table using JSON-Schema/Types: https://x.com/janwilmake/status/1915357190845538729

# PR

- Ask @braydenwillmoth: make studio.outerbase.com available at http so it can also connect with `localhost:3000`
- Post showcasing streaming (`high-throughput-example.ts`)
- Post showcasing dorm with oauth: https://x.com/janwilmake/status/1921970022810812641 (https://github.com/janwilmake/x-oauth-template is a great start but needs to be updated to latest DORM) --> Combi DORM + MCP (https://x.com/iannuttall/status/1920484902752981012)

# DORM Changes

💡 How transactions can be used: https://lmpify.com/httpsdevelopersc-vx7x1c0. Making a remote transaction possible would be very useful https://lmpify.com/httpsdevelopersc-3mptgo0. We MAY now be able to create a multi-DO transaction in DORM. See https://x.com/janwilmake/status/1926928095329587450 for potential feeback.

If this works out, breaking change to DORM:

https://uuithub.com/janwilmake/dorm/tree/main?pathPatterns=mod.ts&pathPatterns=package.json

Instead of name, mirrorName, locationHint, mirrorLocationHint, structure it like `names:string[]` and `locationHint?:{[name:string]:string}`

Think about what that does to whatever's in `waitUntil` for different usecases. can we control it?

Also, the question of sending multiple queries to the DO is not answered, making things slow and potentially not ACID. especially when working with many DBs, allowing point-in-time recovery and transactions would be huge.
