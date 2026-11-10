import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCsp, proxy } from "@/proxy";
import { AdminError } from "@/server/admin/errors";
import { detectImageType, readUpload, resolveUploadPath, saveBarberPhoto } from "@/server/uploads";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");

describe("качване на снимки", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "barber-uploads-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("разпознава типа по magic bytes", () => {
    expect(detectImageType(PNG)).toBe("png");
    expect(detectImageType(JPG)).toBe("jpg");
    expect(detectImageType(WEBP)).toBe("webp");
    expect(detectImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("GIF89a"))).toBeNull();
  });

  it("не позволява path traversal", () => {
    expect(resolveUploadPath(dir, "../etc/passwd")).toBeNull();
    expect(resolveUploadPath(dir, "barbers/../../x.png")).toBeNull();
    expect(resolveUploadPath(dir, "barbers/not-a-uuid.png")).toBeNull();
    expect(resolveUploadPath(dir, "barbers/123e4567-e89b-12d3-a456-426614174000.png")).toBe(
      path.join(dir, "barbers/123e4567-e89b-12d3-a456-426614174000.png"),
    );
  });

  it("записва валиден файл с генерирано име и отказва невалиден/голям", async () => {
    const rel = await saveBarberPhoto(
      dir,
      new File([PNG], "../../evil.php", { type: "image/png" }),
    );
    expect(rel).toMatch(/^barbers\/[0-9a-f-]{36}\.png$/);
    expect(await readdir(path.join(dir, "barbers"))).toHaveLength(1);
    expect(await readUpload(dir, rel)).not.toBeNull();

    await expect(
      saveBarberPhoto(dir, new File(["<html>"], "a.png", { type: "image/png" })),
    ).rejects.toBeInstanceOf(AdminError);
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);
    await expect(saveBarberPhoto(dir, new File([big], "big.png"))).rejects.toThrow(/2 MB/);
  });
});

describe("proxy за /admin и /api/admin", () => {
  const req = (url: string, cookie?: string) =>
    new NextRequest(new URL(url, "http://localhost:3000"), { headers: cookie ? { cookie } : {} });

  it("без cookie: /admin → вход, /api/admin → 401", async () => {
    const page = proxy(req("/admin/bookings"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost:3000/admin/login");
    const api = proxy(req("/api/admin/anything"));
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
  });

  it("страницата за вход е достъпна; с cookie минава (валидността се проверява на сървъра)", () => {
    expect(proxy(req("/admin/login")).headers.get("x-middleware-next")).toBe("1");
    const res = proxy(req("/admin/bookings", "barber_admin=abc"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("CSP с нов nonce при всяка заявка; nonce-ът стига до Next.js през заглавките на заявката", () => {
    const a = proxy(req("/")).headers.get("content-security-policy")!;
    const b = proxy(req("/book")).headers.get("content-security-policy")!;
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(a)?.[1];
    expect(nonce).toBeTruthy();
    expect(b).not.toContain(nonce);
    expect(a).toContain("frame-ancestors 'none'");
    expect(a).toContain("object-src 'none'");
    expect(a).toContain("frame-src https://www.openstreetmap.org");
    expect(a).not.toContain("'unsafe-inline' 'strict-dynamic'");
    // Next.js чете CSP от заявката (x-middleware-request-*), за да сложи nonce на скриптовете.
    const res = proxy(req("/"));
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(
      res.headers.get("content-security-policy"),
    );
  });

  it("buildCsp: unsafe-eval само в dev, upgrade-insecure-requests само при HTTPS", () => {
    const prod = buildCsp("n", { dev: false, https: true });
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).toContain("upgrade-insecure-requests");
    const dev = buildCsp("n", { dev: true, https: false });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
    expect(prod).toMatch(/script-src 'self' 'nonce-n' 'strict-dynamic'(;|$)/);
  });
});
