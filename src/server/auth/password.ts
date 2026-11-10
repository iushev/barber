/**
 * Хеширане на пароли с argon2id чрез вградения `node:crypto.argon2` (Node >= 24.7).
 * Без native зависимости, затова работи и в bundle-натия bootstrap-admin.mjs.
 *
 * Формат (PHC-подобен): $argon2id$v=19$m=<KiB>,t=<passes>,p=<parallelism>$<salt b64>$<hash b64>
 */
import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

function derive(
  password: string,
  nonce: Buffer,
  p: { memory: number; passes: number; parallelism: number; tagLength: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      { message: Buffer.from(password, "utf8"), nonce, ...p },
      (err: Error | null, key: Buffer) => (err ? reject(err) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/.exec(encoded);
  if (!m) return false;
  const [, mem, passes, par, saltB64, hashB64] = m;
  const expected = Buffer.from(hashB64!, "base64url");
  const key = await derive(password, Buffer.from(saltB64!, "base64url"), {
    memory: Number(mem),
    passes: Number(passes),
    parallelism: Number(par),
    tagLength: expected.length,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
