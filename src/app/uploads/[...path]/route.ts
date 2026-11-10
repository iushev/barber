import { env } from "@/config/env";
import { contentTypeFor, readUpload } from "@/server/uploads";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const rel = (await ctx.params).path.join("/");
  const data = await readUpload(env().UPLOADS_DIR, rel);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": contentTypeFor(rel),
      // Имената са уникални (UUID) → безопасно е дълго кеширане.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
