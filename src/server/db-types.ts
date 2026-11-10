import type { NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type * as schema from "@/db/schema";

export type Db = NodePgDatabase<typeof schema>;
/** База или транзакция — функциите, които приемат Executor, работят и в двата случая. */
export type Executor = PgDatabase<NodePgQueryResultHKT, typeof schema>;
