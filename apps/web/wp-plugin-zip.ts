import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

/** Plugin de WordPress que se ofrece para descargar desde el panel (Ajustes → Conector). */
const PLUGIN_DIR = new URL('../wp-plugin/seo-autopilot-connector', import.meta.url);
export const PLUGIN_ZIP_PATH = 'downloads/seo-autopilot-connector.zip';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

/** ZIP sin compresión (método "store"): suficiente para un plugin de pocos KB y sin dependencias. */
export function buildPluginZip(): Buffer {
  const root = PLUGIN_DIR.pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const base = join(root, '..');
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of listFiles(root).sort()) {
    const name = Buffer.from(relative(base, file).split('\\').join('/'));
    const data = readFileSync(file);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versión necesaria
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(0, 8); // store
    local.writeUInt32LE(0, 10); // fecha/hora DOS: 1980 (build reproducible)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Emite el ZIP en el build y lo sirve en desarrollo, siempre generado desde el código fuente. */
export function wpPluginZip(): Plugin {
  return {
    name: 'wp-plugin-zip',
    configureServer(server) {
      server.middlewares.use(`/${PLUGIN_ZIP_PATH}`, (_req, res) => {
        res.setHeader('Content-Type', 'application/zip');
        res.end(buildPluginZip());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: PLUGIN_ZIP_PATH, source: buildPluginZip() });
    },
  };
}
