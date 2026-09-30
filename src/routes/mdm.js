import express from 'express';
import prisma from '../config/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = express.Router();

// ENROLL - iPhone baixa o perfil .mobileconfig
router.post('/enroll', async (req, res) => {
  try {
    console.log('[MDM] Enroll recebido');
    if (process.env.MDM_MODE !== 'real') {
      return res.status(503).json({ error: 'MDM em modo simulação' });
    }
    res.setHeader('Content-Type', 'application/x-apple-aspen-mdm');
    res.send('mobileconfig-a-ser-gerado');
  } catch (error) {
    res.status(500).json({ error: 'Erro no enroll' });
  }
});

// CHECKIN - iPhone manda UDID, Token, versão iOS
router.put('/checkin', async (req, res) => {
  try {
    const body = req.body;
    console.log('[MDM] Checkin:', JSON.stringify(body, null, 2));

    const udid = body.UDID;
    const pushToken = body.Token;
    const iosVersion = body.OSVersion;

    if (udid) {
      await prisma.device.upsert({
        where: { udid },
        update: {
          pushToken,
          iosVersion: iosVersion || undefined,
          lastSeen: new Date(),
          status: 'ACTIVE',
        },
        create: {
          name: `iPhone ${udid.substring(0, 6)}`,
          model: body.Model || 'iPhone',
          imei: udid.substring(0, 15),
          udid,
          iosVersion: iosVersion || 'Desconhecido',
          pushToken,
          status: 'ACTIVE',
          enrolledAt: new Date(),
        },
      });
    }

    res.json({ status: 'success' });
  } catch (error) {
    console.error('[MDM] Erro checkin:', error);
    res.status(500).json({ error: 'Erro no checkin' });
  }
});

// COMMAND - iPhone busca comandos pendentes
router.put('/command', async (req, res) => {
  try {
    const udid = req.body.UDID;
    console.log('[MDM] Command request:', udid);

    const device = await prisma.device.findUnique({ where: { udid } });
    if (!device) return res.json({ command: null });

    const pendingAction = await prisma.deviceAction.findFirst({
      where: { deviceId: device.id, status: 'PENDENTE' },
      orderBy: { executedAt: 'asc' },
    });

    if (!pendingAction) return res.json({ command: null });

    let command = {};
    switch (pendingAction.action) {
      case 'LOCK':
        command = { RequestType: 'DeviceLock', Message: 'Bloqueado pelo admin', PhoneNumber: '' };
        break;
      case 'WIPE':
        command = { RequestType: 'EraseDevice', PIN: '123456', PreserveDataPlan: false };
        break;
      case 'LOCALIZAR':
        command = { RequestType: 'DeviceLocation' };
        break;
      case 'REINICIAR':
        command = { RequestType: 'RestartDevice' };
        break;
      default:
        return res.json({ command: null });
    }

    await prisma.deviceAction.update({
      where: { id: pendingAction.id },
      data: { status: 'ENVIADO' },
    });

    res.json({ command_uuid: pendingAction.id, command });
  } catch (error) {
    console.error('[MDM] Erro command:', error);
    res.status(500).json({ error: 'Erro no command' });
  }
});

// RESULT - iPhone manda resultado
router.put('/command/result', async (req, res) => {
  try {
    const { command_uuid, status, result } = req.body;

    if (command_uuid) {
      await prisma.deviceAction.update({
        where: { id: command_uuid },
        data: {
          status: status || 'EXECUTADO',
          result: JSON.stringify(result || {}),
        },
      });
    }
    res.json({ status: 'success' });
  } catch (error) {
    res.status(500).json({ error: 'Erro no result' });
  }
});

// COMANDOS DO PAINEL ADMIN
router.post('/devices/:id/lock', authMiddleware, async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Dispositivo não encontrado' });

    await prisma.deviceAction.create({
      data: { deviceId: device.id, action: 'LOCK', status: 'PENDENTE', executedBy: req.user.username },
    });
    await prisma.device.update({ where: { id: device.id }, data: { status: 'LOCKED' } });
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId, action: 'BLOQUEAR',
        target: `${device.name} (${device.imei})`,
        ip: req.ip, userAgent: req.headers['user-agent'],
        hash: Math.random().toString(36).substring(2, 10),
      },
    });

    res.json({ success: true, message: 'Comando LOCK enviado' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao bloquear' });
  }
});

router.post('/devices/:id/wipe', authMiddleware, async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Dispositivo não encontrado' });

    await prisma.deviceAction.create({
      data: { deviceId: device.id, action: 'WIPE', status: 'PENDENTE', executedBy: req.user.username },
    });
    await prisma.device.update({ where: { id: device.id }, data: { status: 'WIPED' } });
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId, action: 'FORMATAR',
        target: `${device.name} (${device.imei})`,
        ip: req.ip, userAgent: req.headers['user-agent'],
        hash: Math.random().toString(36).substring(2, 10),
      },
    });

    res.json({ success: true, message: 'Comando WIPE enviado' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao formatar' });
  }
});

router.post('/devices/:id/locate', authMiddleware, async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Dispositivo não encontrado' });

    await prisma.deviceAction.create({
      data: { deviceId: device.id, action: 'LOCALIZAR', status: 'PENDENTE', executedBy: req.user.username },
    });
    res.json({ success: true, message: 'Comando LOCATE enviado' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao localizar' });
  }
});

router.post('/devices/:id/restart', authMiddleware, async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Dispositivo não encontrado' });

    await prisma.deviceAction.create({
      data: { deviceId: device.id, action: 'REINICIAR', status: 'PENDENTE', executedBy: req.user.username },
    });
    res.json({ success: true, message: 'Comando RESTART enviado' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao reiniciar' });
  }
});

export default router;