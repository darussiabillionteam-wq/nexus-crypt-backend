import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import devicesRoutes from './routes/devices.js';
import logsRoutes from './routes/logs.js';
import configRoutes from './routes/config.js';
import mdmRoutes from './routes/mdm.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// ✅ CORREÇÃO 1 — Confiar no proxy do Render
// Isso resolve o erro ERR_ERL_UNEXPECTED_X_FORWARDED_FOR do express-rate-limit
app.set('trust proxy', 1);

// ✅ CORREÇÃO 2 — Helmet sem bloquear o painel
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

// ✅ CORREÇÃO 3 — CORS robusto (aceita localhost, Render, e domínios extras)
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Adiciona automaticamente os domínios do Render e localhost
const defaultOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4000',
  'https://nexus-crypt-scanner.onrender.com',
  'https://nexus-crypt-backend.onrender.com',
  'https://nexus-crypt-mdm.onrender.com',
];

const allOrigins = [...new Set([...allowedOrigins, ...defaultOrigins])];

app.use(cors({
  origin: (origin, callback) => {
    // Permite requests sem origin (Postman, curl, mobile apps)
    if (!origin) return callback(null, true);
    // Permite se tá na lista
    if (allOrigins.includes(origin)) return callback(null, true);
    // Permite qualquer subdomínio do onrender.com
    if (origin.endsWith('.onrender.com')) return callback(null, true);
    // Bloqueia o resto
    console.warn(`[CORS] Origem bloqueada: ${origin}`);
    callback(new Error('Origem não permitida'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// ✅ CORREÇÃO 4 — Body parser com limites maiores (certificados .pem em base64)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ✅ CORREÇÃO 5 — Rate limit com skip de health check e IP correto via trust proxy
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' },
});
app.use('/api/', limiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde 15 minutos.' },
});

// ✅ CORREÇÃO 6 — Health check sem autenticação
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Nexus Crypt MDM Backend',
    version: '1.0.0',
    mdmMode: process.env.MDM_MODE || 'simulation',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Rotas
app.use('/api/auth', loginLimiter, authRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/config', configRoutes);
app.use('/mdm', mdmRoutes);

// ✅ CORREÇÃO 7 — 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada', path: req.path });
});

// ✅ CORREÇÃO 8 — Error handler global
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  console.error('[STACK]', err.stack);
  res.status(err.status || 500).json({
    error: 'Erro interno',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Contate o suporte',
  });
});

// ✅ CORREÇÃO 9 — Listener
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('🖤 ================================================');
  console.log('   NEXUS CRYPT MDM - BACKEND ONLINE');
  console.log('🖤 ================================================');
  console.log(`   Porta: ${PORT}`);
  console.log(`   Modo: ${process.env.MDM_MODE || 'simulation'}`);
  console.log(`   Ambiente: ${process.env.NODE_ENV || 'production'}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log('🖤 ================================================');
  console.log('');
});