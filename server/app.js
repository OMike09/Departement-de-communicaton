import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { config, ROOT } from './config.js';
import { loadSession, checkOrigin } from './auth.js';
import { dbMode } from './db.js';
import { ApiError } from './errors.js';
import authRoutes from './routes/auth.js';
import structureRoutes from './routes/structure.js';
import userRoutes from './routes/users.js';
import roleRoutes from './routes/roles.js';
import publicationRoutes from './routes/publications.js';
import fileRoutes from './routes/files.js';
import documentRoutes from './routes/documents.js';
import timetableRoutes from './routes/timetables.js';
import resultRoutes from './routes/results.js';
import requestRoutes from './routes/requests.js';
import messageRoutes from './routes/messages.js';
import notificationRoutes from './routes/notifications.js';
import activityRoutes from './routes/activities.js';
import statsRoutes from './routes/stats.js';
import adminRoutes, { appVersion } from './routes/admin.js';
import profileRoutes from './routes/profile.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      frameguard: false,
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (!config.isProd) app.use(morgan('dev', { skip: () => process.env.NODE_ENV === 'test' }));

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(loadSession);
  app.use('/api', checkOrigin);

  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok', db: dbMode(), time: new Date().toISOString() });
  });
  app.get('/build.js', async (req, res) => {
    res.type('application/javascript').send(`window.APP_BUILD="${await appVersion()}";`);
  });
  app.get('/api/app-version', async (req, res) => {
    res.json({ version: await appVersion(), db: dbMode() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api', structureRoutes);
  app.use('/api', userRoutes);
  app.use('/api', roleRoutes);
  app.use('/api', publicationRoutes);
  app.use('/api', fileRoutes);
  app.use('/api', documentRoutes);
  app.use('/api', timetableRoutes);
  app.use('/api', resultRoutes);
  app.use('/api', requestRoutes);
  app.use('/api', messageRoutes);
  app.use('/api', notificationRoutes);
  app.use('/api', activityRoutes);
  app.use('/api', statsRoutes);
  app.use('/api', adminRoutes);
  app.use('/api', profileRoutes);

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Route API introuvable.' });
  });

  const publicDir = path.join(ROOT, 'public');
  app.use(
    express.static(publicDir, {
      index: false,
      etag: true,
      maxAge: config.isProd ? '1h' : 0,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    const index = path.join(publicDir, 'index.html');
    if (!fs.existsSync(index)) return res.status(500).send('Interface indisponible.');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Fichier ou contenu trop volumineux.' });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Requête invalide : données JSON mal formées.' });
    }
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Cet enregistrement existe déjà.' });
    }
    if (err?.code === '23503') {
      return res.status(400).json({ error: 'Référence invalide : élément lié introuvable.' });
    }
    console.error('Erreur serveur :', err);
    res.status(500).json({ error: 'Une erreur interne est survenue. Réessayez ou contactez l’administration.' });
  });

  return app;
}
