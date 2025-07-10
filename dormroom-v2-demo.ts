import { DurableObject } from "cloudflare:workers";
import {
  Queryable,
  QueryableHandler,
  studioMiddleware,
} from "queryable-object";
import { Migratable } from "migratable-object";
import { getMultiStub, MultiStubConfig } from "multistub";

type Env = { DORM_NAMESPACE: DurableObjectNamespace<DORM & QueryableHandler> };

const sampleItems = [
  {
    name: "Wireless Headphones",
    description: "High-quality Bluetooth headphones with noise cancellation",
    price: 199.99,
    category: "Electronics",
  },
  {
    name: "Coffee Mug",
    description: "Ceramic mug perfect for your morning coffee",
    price: 12.99,
    category: "Home & Kitchen",
  },
  {
    name: "Running Shoes",
    description: "Lightweight running shoes with excellent cushioning",
    price: 89.99,
    category: "Sports & Outdoors",
  },
  {
    name: "Notebook",
    description: "Spiral-bound notebook with 200 pages",
    price: 5.99,
    category: "Office Supplies",
  },
  {
    name: "Smartphone Case",
    description: "Protective case with wireless charging support",
    price: 29.99,
    category: "Electronics",
  },
  {
    name: "Desk Lamp",
    description: "LED desk lamp with adjustable brightness",
    price: 45.99,
    category: "Home & Kitchen",
  },
  {
    name: "Water Bottle",
    description: "Insulated stainless steel water bottle",
    price: 24.99,
    category: "Sports & Outdoors",
  },
  {
    name: "Pen Set",
    description: "Set of 5 premium ballpoint pens",
    price: 15.99,
    category: "Office Supplies",
  },
];

@Migratable({
  migrations: {
    1: [
      `CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        category TEXT NOT NULL,
        in_stock BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      ...sampleItems.map(
        ({ category, description, name, price }) =>
          `INSERT INTO items (name, description, price, category) VALUES ('${name}', '${description}', '${price}', '${category}')`,
      ),
    ],
  },
})
@Queryable()
export class DORM extends DurableObject {
  sql: SqlStorage;
  //   env: any;
  // raw: Raw;
  // exec: Exec;
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // this.env = env;
    this.sql = state.storage.sql;
  }
}

export default {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    const url = new URL(request.url);
    const firstSegment = url.pathname.split("/")[1];
    const stub = env.DORM_NAMESPACE.get(
      env.DORM_NAMESPACE.idFromName(firstSegment),
    );

    const configs: MultiStubConfig[] = [
      firstSegment === "aggregate"
        ? undefined
        : { name: "user:" + firstSegment },
      { name: "aggregate", config: { locationHint: "weur" } },
    ];

    const multistub = getMultiStub(env.DORM_NAMESPACE, configs, ctx);

    if (url.pathname === "/") {
      return new Response(`usage:

- Items for any ID: GET /{id}
- Any studio: GET /{id}/studio
`);
    }

    if (url.pathname.endsWith("/studio")) {
      // Add studio that connects to the user-db as well as the aggregate on every query!!!
      return studioMiddleware(request, multistub.raw, {
        basicAuth: { username: "admin", password: "test" },
      });
    }

    // This queries from the selected firstSegment DO but also mirrors it to aggregate
    const { array } = await stub.exec("SELECT * FROM items");
    return new Response(JSON.stringify(array, undefined, 2), {
      headers: { "content-type": "application/json" },
    });
  },
};
