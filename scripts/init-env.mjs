// Crea .env a partir de .env.example y rellena JWT_SECRET y ENCRYPTION_KEY con valores aleatorios.
// Uso: node scripts/init-env.mjs   (no sobrescribe un .env existente)
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = `${root}.env`;

if (existsSync(target)) {
  console.log('.env ya existe: no se toca. Borra el archivo si quieres regenerarlo.');
  process.exit(0);
}

const fill = (text, key, value) => text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);

let env = readFileSync(`${root}.env.example`, 'utf8');
env = fill(env, 'JWT_SECRET', randomBytes(48).toString('base64'));
env = fill(env, 'ENCRYPTION_KEY', randomBytes(32).toString('base64'));
writeFileSync(target, env);

console.log('.env creado con JWT_SECRET y ENCRYPTION_KEY generados.');
console.log(
  'Falta: ANTHROPIC_API_KEY (y ADMIN_EMAIL si quieres la vista de administración / bull-board).',
);
console.log(
  'IMPORTANTE: guarda ENCRYPTION_KEY en un lugar seguro. Si la pierdes, las credenciales de WordPress guardadas no se pueden descifrar.',
);
