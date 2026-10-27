import fs from 'node:fs';
import module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

// Enable Node 22 native TS execution (`node server.ts`) to resolve `.js` specifiers to `.ts` source files
if (typeof (module as any).registerHooks === 'function') {
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

async function startServer() {
  const { createExpressApp } = await import('./src/server/app.js');
  const app = createExpressApp();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  if (process.env.NODE_ENV === 'production') {
    const express = await import('express');
    app.use(express.default.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    // Mount Vite middlewares in development
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pool Party Full-Stack Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
