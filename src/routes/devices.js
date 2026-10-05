import express from 'express';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';
import {
  listarDispositivos,
  bloquearDispositivo,
  apagarDispositivo,
  reiniciarDispositivo,
  localizarDispositivo,
  enviarMensagem,
} from '../services/simplemdm.js';

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

// ============================================================
// LISTAR devices do banco local
// ============================================================
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

// ============================================================
// SINCRONIZAR devices do SimpleMDM
// ============================================================
router.post('/sync-simplemdm', async (req, res) => {
  try {
    const result = await listarDispositivos();
    if (!result.ok) {
      return res.status(500).json({ error: 'Erro no SimpleMDM', details: result.data });
    }

    const devices = result.data.data || [];
    let created = 0;
    let updated = 0;

    for (const smd of devices) {
      const attrs = smd.attributes;
      const simplemdmId = String(smd.id);

      // Busca por simplemdmId OU por serial/UDID
      let existing = await prisma.device.findFirst({
        where: { simplemdmId },
      });

      if (!existing && attrs.serial_number) {
        existing = await prisma.device.findFirst({
          where: { imei: attrs.serial_number },
        });
      }

      const deviceData = {
        name: attrs.name || attrs.device_name || `iPhone ${simplemdmId}`,
        model: attrs.model_name || 'iPhone',
        imei: attrs.serial_number || attrs.unique_identifier || `smd-${simplemdmId}`,
        serialNumber: attrs.serial_number || null,
        udid: attrs.unique_identifier || null,
        iosVersion: attrs.os_version || 'Desconhecido',
        battery: parseInt(attrs.battery_level) || 100,
        storageTotal: Math.round(attrs.device_capacity) || 128,
        status: attrs.status === 'enrolled' ? 'ACTIVE' : 'PENDING',
        location: attrs.location_latitude
          ? `${attrs.location_latitude}, ${attrs.location_longitude}`
          : 'Localização Pendente',
        pushToken: attrs.push_token || null,
        lastSeen: attrs.last_seen_at ? new Date(attrs.last_seen_at) : new Date(),
        simplemdmId,
      };

      if (existing) {
        await prisma.device.update({
          where: { id: existing.id },
          data: deviceData,
        });
        updated++;
      } else {
        await prisma.device.create({ data: deviceData });
        created++;
      }
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'SYNC_SIMPLEMDM',
        target: `Sincronizou ${devices.length} devices`,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        hash: Math.random().toString(36).substring(2, 10),
      },
    });

    res.json({
      success: true,
      total: devices.length,
      created,
      updated,
    });
  } catch (error) {
    console.error('[DEVICES] Erro no sync:', error);
    res.status(500).json({ error: 'Erro ao sincronizar' });
  }
});

// ============================================================
// BUSCAR um device
// ============================================================
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

// ============================================================
// CRIAR device manual
// ============================================================
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
// ATUALIZAR device
// ============================================================
router.patch('/:id', async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) {
      return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }

    const allowedFields = [
      'name', 'model', 'imei', 'serialNumber', 'udid', 'iosVersion',
      'battery', 'storageUsed', 'storageTotal', 'status', 'location',
      'simplemdmId', 'pushToken',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nenhum campo válido' });
    }

    const updated = await prisma.device.update({
      where: { id: req.params.id },
      data: updates,
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar dispositivo' });
  }
});

// ============================================================
// DELETAR device
// ============================================================
router.delete('/:id', async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Dispositivo não encontrado' });

    await prisma.device.delete({ where: { id: req.params.id } });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar dispositivo' });
  }
});

// ============================================================
// AÇÕES REMOTAS via SimpleMDM
// ============================================================

// BLOQUEAR
router.post('/:id/lock', async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Dispositivo não encontrado' });
    if (!device.simplemdmId) return res.status(400).json({ error: 'Device sem simplemdmId' });

    const result = await bloquearDispositivo(device.simplemdmId, 'Bloqueado pelo Nexus Crypt', null);
    if (!result.ok) return res.status(result.status).json({ error: 'Erro SimpleMDM', details: result.data });

    await prisma.device.update({ where: { id: device.id }, data: { status: 'LOCKED' } });
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId, action: 'BLOQUEAR',
        target: `${device.name} (${device.imei})`,
        ip: req.ip, userAgent: req.headers['user-agent'],
        hash: Math.random().toString(36).substring(2, 10),
      },
    });

    res.json({ success: true, message: 'LOCK enviado' });
  } catch (error) {
    console.error('[lock]', error);
    res.status(500).json({ error: 'Erro ao bloquear' });
  }
});

// APAGAR
router.post('/:id/wipe', async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Dispositivo não encontrado' });
    if (!device.simplemdmId) return res.status(400).json({ error: 'Device sem simplemdmId' });

    const result = await apagarDispositivo(device.simplemdmId);
    if (!result.ok) return res.status(result.status).json({ error: 'Erro SimpleMDM', details: result.data });

    await prisma.device.update({ where: { id: device.id }, data: { status: 'WIPED' } });
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId, action: 'APAGAR',
        target: `${device.name} (${device.imei})`,
        ip: req.ip, userAgent: req.headers['user-agent'],
        hash: Math.random().toString(36).substring(2, 10),
      },
    });

    res.json({ success: true, message: 'WIPE enviado' });
  } catch (error) {
    console.error('[wipe]', error);
    res.status(500).json({ error: 'Erro ao apagar' });
  }
});

// REINICIAR
router.post('/:id/restart', async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Dispositivo não encontrado' });
    if (!device.simplemdmId) return res.status(400).json({ error: 'Device sem simplemdmId' });

    const result = await reiniciarDispositivo(device.simplemdmId);
    if (!result.ok) return res.status(result.status).json({ error: 'Erro SimpleMDM', details: result.data });

    res.json({ success: true, message: 'RESTART enviado' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao reiniciar' });
  }
});

// LOCALIZAR
router.post('/:id/locate', async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Dispositivo não encontrado' });
    if (!device.simplemdmId) return res.status(400).json({ error: 'Device sem simplemdmId' });

    const result = await localizarDispositivo(device.simplemdmId);
    if (!result.ok) return res.status(result.status).json({ error: 'Erro SimpleMDM', details: result.data });

    res.json({ success: true, message: 'Localização solicitada' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao localizar' });
  }
});

// MENSAGEM
router.post('/:id/message', async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Dispositivo não encontrado' });
    if (!device.simplemdmId) return res.status(400).json({ error: 'Device sem simplemdmId' });

    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensagem obrigatória' });

    const result = await enviarMensagem(device.simplemdmId, message);
    if (!result.ok) return res.status(result.status).json({ error: 'Erro SimpleMDM', details: result.data });

    res.json({ success: true, message: 'Mensagem enviada' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
});

export default router;