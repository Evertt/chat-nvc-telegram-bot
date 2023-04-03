import {
  Kysely,
  type Driver,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "https://esm.sh/kysely@0.24.2"
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { PostgreSQLDriver } from "https://deno.land/x/kysely_deno_postgres@v0.4.0/mod.ts"
// import { Kysely } from "https://cdn.jsdelivr.net/npm/kysely/dist/esm/index.js";
// import { PostgresDialect } from "https://deno.land/x/kysely_postgres@v0.0.3/mod.ts";

const { SUPERBASE_CONNECTION_STRING } = Deno.env.toObject()

const kysely = new Kysely({
  dialect: {
    createAdapter() {
      return new PostgresAdapter();
    },
    createDriver() {
      return new PostgreSQLDriver({
        connectionString: SUPERBASE_CONNECTION_STRING,
      }) as unknown as Driver
    },
    createIntrospector(db: Kysely<unknown>) {
      return new PostgresIntrospector(db);
    },
    createQueryCompiler() {
      return new PostgresQueryCompiler();
    },
  },
})
