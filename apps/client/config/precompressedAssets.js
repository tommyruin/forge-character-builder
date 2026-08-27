import fs from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';

const COMPRESSIBLE = /\.(?:js|mjs|css|html|json|xml|svg|txt|map|index)$/i;
const MIN_COMPRESS_BYTES = 1024;

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Writes .br and .gz siblings next to every large compressible build output
 * so the negotiation middleware (and any static host implementing the same
 * contract) can serve compressed bytes. A sibling is only written when it is
 * actually smaller than the original.
 */
export async function emitCompressedSiblings(rootDir, { minBytes = MIN_COMPRESS_BYTES } = {}) {
  let compressed = 0;
  let bytesSaved = 0;
  for (const file of walkFiles(rootDir)) {
    if (file.endsWith('.br') || file.endsWith('.gz')) continue;
    if (!COMPRESSIBLE.test(file)) continue;
    const source = fs.readFileSync(file);
    if (source.byteLength < minBytes) continue;
    const brotli = brotliCompressSync(source, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: source.byteLength,
      },
    });
    if (brotli.byteLength < source.byteLength) {
      fs.writeFileSync(`${file}.br`, brotli);
      bytesSaved += source.byteLength - brotli.byteLength;
      compressed += 1;
    }
    const gzip = gzipSync(source, { level: 9 });
    if (gzip.byteLength < source.byteLength) {
      fs.writeFileSync(`${file}.gz`, gzip);
    }
  }
  return { compressed, bytesSaved };
}

export function selectPrecompressedEncoding(acceptEncoding = '', available = {}) {
  const accepted = new Set(
    acceptEncoding.toLowerCase().split(',').map((value) => value.trim().split(';')[0]),
  );
  if (accepted.has('br') && available.br) return 'br';
  if (accepted.has('gzip') && available.gzip) return 'gzip';
  return null;
}

export function contentTypeFor(resourcePath) {
  const clean = resourcePath.split('?')[0];
  if (clean.endsWith('.wasm')) return 'application/wasm';
  if (clean.endsWith('.js') || clean.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (clean.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function appendVary(res, token) {
  const current = res.getHeader('Vary');
  const values = new Set(String(current || '').split(',').map((value) => value.trim()).filter(Boolean));
  values.add(token);
  res.setHeader('Vary', [...values].join(', '));
}

function middlewareFor(root) {
  const normalizedRoot = path.resolve(root);
  return (req, res, next) => {
    if (!req.url || (req.method !== 'GET' && req.method !== 'HEAD')) return next();

    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return next();
    }

    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const rawPath = path.resolve(normalizedRoot, relative);
    if (rawPath !== normalizedRoot && !rawPath.startsWith(`${normalizedRoot}${path.sep}`)) return next();

    const available = {
      br: fs.existsSync(`${rawPath}.br`),
      gzip: fs.existsSync(`${rawPath}.gz`),
    };
    const encoding = selectPrecompressedEncoding(req.headers['accept-encoding'], available);
    if (!encoding) return next();

    const suffix = encoding === 'br' ? '.br' : '.gz';
    req.url = `${url.pathname}${suffix}${url.search}`;
    res.setHeader('Content-Encoding', encoding);
    res.setHeader('Content-Type', contentTypeFor(url.pathname));
    appendVary(res, 'Accept-Encoding');
    return next();
  };
}

// Vite does not negotiate the .br/.gz siblings produced by the build. This plugin makes
// the local dev and preview hosts representative: browsers receive the existing
// Brotli artifacts with the MIME type/integrity of the original resource. Real deployment
// hosts must implement the same contract.
export function precompressedAssets() {
  let config;
  return {
    name: 'fcb-precompressed-assets',
    enforce: 'pre',
    configResolved(resolved) {
      config = resolved;
    },
    configureServer(server) {
      server.middlewares.use(middlewareFor(config.publicDir));
    },
    configurePreviewServer(server) {
      const outDir = path.resolve(config.root, config.build.outDir);
      server.middlewares.use(middlewareFor(outDir));
    },
    async closeBundle() {
      if (!config || config.command !== 'build') return;
      const outDir = path.resolve(config.root, config.build.outDir);
      if (!fs.existsSync(outDir)) return;
      const { compressed, bytesSaved } = await emitCompressedSiblings(outDir);
      config.logger.info(`precompressed ${compressed} assets (${(bytesSaved / 1024 / 1024).toFixed(1)} MiB saved)`);
    },
  };
}
