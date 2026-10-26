import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from './src/server/app';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function start() {
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // ============================================================
  // FRONTEND DEV / STATIC SERVING
  // ============================================================
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    // Mount Vite middlewares in development
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pool Party Full-Stack Server running at http://0.0.0.0:${PORT}`);
  });
}

start();
