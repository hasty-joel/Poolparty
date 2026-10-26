import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createExpressApp } from './src/server/app.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
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
