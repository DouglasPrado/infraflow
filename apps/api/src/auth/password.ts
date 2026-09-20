import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * `promisify(scrypt)` perde a sobrecarga que aceita opções, então o wrapper é
 * explícito.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });
}

/**
 * Hash de senha com scrypt — embutido no Node, sem dependência nativa.
 * Parâmetros conforme a recomendação da OWASP para scrypt.
 */
const N = 65_536;
const r = 8;
const p = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * O scrypt precisa de `128 * N * r` bytes — 64MB nestes parâmetros — e o padrão
 * do Node é 32MB. Sem isto, o hash falha em runtime.
 */
function memoryFor(n: number, blockSize: number): number {
  return 128 * n * blockSize * 2;
}

/**
 * Formato `N$r$p$salt$hash`, tudo em hex. Os parâmetros são gravados junto para
 * permitir reforçá-los no futuro sem invalidar as senhas já existentes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: memoryFor(N, r),
  });
  return `${N}$${r}$${p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Comparação em tempo constante — nunca com `===`. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 5) return false;

  const [rawN, rawR, rawP, saltHex, hashHex] = parts as [string, string, string, string, string];
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;

  const storedN = Number(rawN);
  const storedR = Number(rawR);

  let derived: Buffer;
  try {
    derived = await scryptAsync(password, salt, expected.length, {
      N: storedN,
      r: storedR,
      p: Number(rawP),
      maxmem: memoryFor(storedN, storedR),
    });
  } catch {
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
