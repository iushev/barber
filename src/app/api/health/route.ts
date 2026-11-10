import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`SELECT 1`);
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[health] базата не отговаря:", err instanceof Error ? err.message : err);
    return Response.json(
      { status: "error", checks: { database: "down" } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
