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

app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origem não permitida'));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Muitas requisições' },
});
app.use('/api/', limiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Muitas tentativas de login' },
});

app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Nexus Crypt MDM Backend',
    version: '1.0.0',
    mdmMode: process.env.MDM_MODE || 'simulation',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', loginLimiter, authRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/config', configRoutes);
app.use('/mdm', mdmRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({
    error: 'Erro interno',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('🖤 ================================================');
  console.log('   NEXUS CRYPT MDM - BACKEND ONLINE');
  console.log('🖤 ================================================');
  console.log(`   Porta: ${PORT}`);
  console.log(`   Modo: ${process.env.MDM_MODE || 'simulation'}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log('🖤 ================================================');
  console.log('');
});