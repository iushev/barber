import { afterEach, describe, expect, it, vi } from "vitest";

describe("env()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("празните стойности от docker compose (`${VAR:-}`) се третират като незададени", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5432/db");
    vi.stubEnv("N8N_CHAT_PURGE_URL", "");
    vi.stubEnv("AGENT_API_KEY", "  ");
    vi.stubEnv("SLOT_STEP_MIN", "");
    const { env } = await import("@/config/env");
    const e = env();
    expect(e.N8N_CHAT_PURGE_URL).toBeUndefined();
    expect(e.AGENT_API_KEY).toBeUndefined();
    expect(e.SLOT_STEP_MIN).toBe(15);
  });

  it("невалидна стойност спира приложението с ясно съобщение (без стойността)", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:secret@localhost:5432/db");
    vi.stubEnv("SLOT_STEP_MIN", "20");
    const { env } = await import("@/config/env");
    expect(() => env()).toThrow(/SLOT_STEP_MIN/);
    expect(() => env()).not.toThrow(/secret/);
  });
});
