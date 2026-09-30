import express from 'express';
import prisma from '../config/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const { action, limit = 100 } = req.query;

    const where = {};
    if (action) where.action = { contains: action };

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      include: {
        user: { select: { username: true, email: true } },
      },
    });

    res.json(logs);
  } catch (error) {
    console.error('[LOGS] Erro ao listar:', error);
    res.status(500).json({ error: 'Erro ao listar logs' });
  }
});

router.get('/export', async (req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true } } },
    });

    const csv = [
      'Data,Hora,Usuario,Acao,Alvo,IP,Hash',
      ...logs.map(l => {
        const date = new Date(l.createdAt);
        return [
          date.toLocaleDateString('pt-BR'),
          date.toLocaleTimeString('pt-BR'),
          l.user?.username || 'sistema',
          l.action,
          l.target,
          l.ip || '',
          l.hash,
        ].join(',');
      }),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao exportar logs' });
  }
});

export default router;