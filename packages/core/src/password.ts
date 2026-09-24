import { hash, verify } from '@node-rs/argon2';

// Algorithm.Argon2id === 2 (es un const enum ambiente, no importable con isolatedModules).
const ARGON2ID = 2;

/** Argon2id con los parámetros por defecto de la librería (m=19 MiB, t=2, p=1: recomendación OWASP). */
export function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: ARGON2ID });
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}
