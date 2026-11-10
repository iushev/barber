import type { z } from "zod";

/** Грешка за админ операции с приятелско съобщение и (по избор) грешки по полета. */
export class AdminError extends Error {
  readonly fields: Record<string, string>;
  constructor(message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = "AdminError";
    this.fields = fields;
  }
}

export function parseAdmin<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const res = schema.safeParse(input);
  if (res.success) return res.data;
  const fields: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  throw new AdminError(Object.values(fields)[0] ?? "Невалидни данни.", fields);
}

export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
