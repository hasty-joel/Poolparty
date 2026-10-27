import fs from 'node:fs';
import http from 'node:http';
import module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

// Enable Node 22 native TS execution (`node server.ts`) to resolve `.js` specifiers to `.ts` source files.
// Skip when running under `tsx`, which already registers its own ESM TypeScript resolver.
const isTsxRuntime =
  Boolean(process.env.TSX_TSCONFIG_PATH) ||
  process.execArgv.some((arg) => arg.includes('tsx'));

if (!isTsxRuntime && typeof (module as any).registerHooks === 'function') {
  (module as any).registerHooks({
    resolve(specifier: string, context: any, nextResolve: any) {
      if (
        (specifier.startsWith('./') || specifier.startsWith('../')) &&
        specifier.endsWith('.js') &&
        context.parentURL?.startsWith('file:')
      ) {
        const parentDir = path.dirname(fileURLToPath(context.parentURL));
        const jsCandidate = path.resolve(parentDir, specifier);
        const tsCandidate = jsCandidate.slice(0, -3) + '.ts';
        if (!fs.existsSync(jsCandidate) && fs.existsSync(tsCandidate)) {
          return nextResolve(pathToFileURL(tsCandidate).href, context);
        }
      }
      return nextResolve(specifier, context);
    },
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseCliArgs(argv: string[]): { port?: number; host?: string } {
  let port: number | undefined;
  let host: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--port' || arg === '-p') && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        port = parsed;
      }
      i++;
    } else if (arg.startsWith('--port=')) {
      const parsed = Number.parseInt(arg.slice('--port='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        port = parsed;
      }
    } else if (arg === '--host' && argv[i + 1] && !argv[i + 1].startsWith('-')) {
      host = argv[i + 1];
      i++;
    } else if (arg.startsWith('--host=')) {
      const val = arg.slice('--host='.length).trim();
      if (val) {
        host = val;
      }
    }
  }

  return { port, host };
}

async function startServer() {
  const { createExpressApp } = await import('./src/server/app.js');
  const app = createExpressApp();
  const httpServer = http.createServer(app);

  const cli = parseCliArgs(process.argv.slice(2));
  const PORT = cli.port ?? (Number.parseInt(process.env.PORT || '3000', 10) || 3000);
  const HOST = cli.host || process.env.HOST || '0.0.0.0';

  let closeVite: (() => Promise<void>) | undefined;

  if (process.env.NODE_ENV === 'production') {
    const express = await import('express');
    app.use(express.default.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    // Mount Vite 8 middlewares in development and attach WebSocket handling to httpServer
    // so standalone port 24678 is never bound or contested during pre-warming.
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: hmrDisabled ? false : { server: httpServer },
        hmr: !hmrDisabled,
        watch: hmrDisabled ? null : {},
      },
      appType: 'spa',
    });
    closeVite = () => vite.close();
    app.use(vite.middlewares);
  }

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[Server Error] Failed to bind ${HOST}:${PORT}:`, err.message);
    process.exitCode = 1;
  });

  const shutdown = (signal: string) => {
    console.log(`[Server] Received ${signal}, shutting down gracefully...`);
    httpServer.close(() => {
      if (closeVite) {
        closeVite().finally(() => process.exit(0));
      } else {
        process.exit(0);
      }
    });
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  httpServer.listen(PORT, HOST, () => {
    console.log(`Pool Party Full-Stack Server running at http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Server Startup Error]', err);
  process.exit(1);
});
