import express from 'express';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = express.Router();

router.use(authMiddleware);

const deviceSchema = z.object({
  name: z.string().min(2),
  model: z.string().min(2),
  imei: z.string().min(10),
  serialNumber: z.string().optional(),
  udid: z.string().optional(),
  iosVersion: z.string().min(1),
});

router.get('/', async (req, res) => {
  try {
    const devices = await prisma.device.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(devices);
  } catch (error) {
    console.error('[DEVICES] Erro ao listar:', error);
    res.status(500).json({ error: 'Erro ao listar dispositivos' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const device = await prisma.device.findUnique({
      where: { id: req.params.id },
      include: { actions: { orderBy: { executedAt: 'desc' }, take: 20 } },
    });

    if (!device) {
      return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }

    res.json(device);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar dispositivo' });
  }
});

router.post('/', async (req, res) => {
  try {
    const data = deviceSchema.parse(req.body);

    const device = await prisma.device.create({
      data: {
        ...data,
        status: 'ACTIVE',
        location: 'Localização Pendente',
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'MATRICULAR',
        target: `${device.name} (${device.imei})`,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        hash: Math.random().toString(36).substring(2, 10),
      },
    });

    res.status(201).json(device);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'IMEI já cadastrado' });
    }
    console.error('[DEVICES] Erro ao criar:', error);
    res.status(500).json({ error: 'Erro ao criar dispositivo' });
  }
});

// ============================================================
// PATCH - Atualiza dados do device (ex: simplemdmId)
// ============================================================
router.patch('/:id', async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) {
      return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }

    const allowedFields = [
      'name',
      'model',
      'imei',
      'serialNumber',
      'udid',
      'iosVersion',
      'battery',
      'storageUsed',
      'storageTotal',
      'status',
      'location',
      'simplemdmId',
      'pushToken',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
    }

    const updated = await prisma.device.update({
      where: { id: req.params.id },
      data: updates,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'ATUALIZAR_DEVICE',
        target: `${device.name} (${device.imei})`,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        hash: Math.random().toString(36).substring(2, 10),
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('[DEVICES] Erro ao atualizar:', error);
    res.status(500).json({ error: 'Erro ao atualizar dispositivo' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) {
      return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }

    await prisma.device.delete({ where: { id: req.params.id } });

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'DELETAR',
        target: `${device.name} (${device.imei})`,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        hash: Math.random().toString(36).substring(2, 10),
      },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar dispositivo' });
  }
});

export default router;