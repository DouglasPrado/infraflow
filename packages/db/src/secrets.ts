import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Segredo guardado no banco (PRD §52).
 *
 * Credencial de nuvem é o único dado do produto que, vazando, custa dinheiro de
 * verdade. Por isso ela nunca entra em coluna legível: o que vai para o banco é
 * texto cifrado com AES-256-GCM, e a chave vive fora dele, no ambiente.
 *
 * GCM e não CBC porque o modo autentica: um ciphertext adulterado falha ao
 * decifrar em vez de devolver lixo que o resto do código trataria como
 * credencial.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;

export class MissingSecretKey extends Error {
  constructor() {
    super(
      "INFRAFLOW_SECRET_KEY ausente. Gere com `openssl rand -base64 32` e configure na API e no worker.",
    );
    this.name = "MissingSecretKey";
  }
}

function key(): Buffer {
  const raw = process.env.INFRAFLOW_SECRET_KEY;
  if (!raw) throw new MissingSecretKey();

  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `INFRAFLOW_SECRET_KEY precisa ter ${KEY_BYTES} bytes em base64; veio com ${decoded.length}.`,
    );
  }
  return decoded;
}

/** Há chave configurada? A interface usa isto para explicar por que não salva. */
export function canStoreSecrets(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export interface SealedSecret {
  cipher: string;
  iv: string;
  tag: string;
}

export function seal(plaintext: string): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    cipher: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function open(sealed: SealedSecret): string {
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(sealed.cipher, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
