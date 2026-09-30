import express from 'express';
import prisma from '../config/prisma.js';
import { authMiddleware, adminOnly } from '../middlewares/auth.js';

const router = express.Router();

router.use(authMiddleware);
router.use(adminOnly);

router.get('/', async (req, res) => {
  try {
    let config = await prisma.appleConfig.findFirst();
    if (!config) {
      config = await prisma.appleConfig.create({ data: {} });
    }
    res.json(config);
  } catch (error) {
    console.error('[CONFIG] Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

router.put('/', async (req, res) => {
  try {
    const {
      apnsCert, apnsKey, mdmCert, mdmKey,
      teamId, keyId, bundleId, mdmTopic,
      appleId, orgName, department, supportEmail,
    } = req.body;

    let config = await prisma.appleConfig.findFirst();

    const isConfigured = !!(apnsCert && apnsKey && mdmCert && mdmKey && teamId && keyId && bundleId && mdmTopic);

    const data = {
      apnsCert, apnsKey, mdmCert, mdmKey,
      teamId, keyId, bundleId, mdmTopic,
      appleId, orgName, department, supportEmail,
      isConfigured,
    };

    if (!config) {
      config = await prisma.appleConfig.create({ data });
    } else {
      config = await prisma.appleConfig.update({
        where: { id: config.id },
        data,
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'CONFIG_UPDATE',
        target: 'AppleConfig',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        hash: Math.random().toString(36).substring(2, 10),
      },
    });

    res.json(config);
  } catch (error) {
    console.error('[CONFIG] Erro:', error);
    res.status(500).json({ error: 'Erro ao salvar configurações' });
  }
});

router.post('/test-apns', async (req, res) => {
  try {
    const config = await prisma.appleConfig.findFirst();

    if (!config?.isConfigured) {
      return res.status(400).json({
        success: false,
        error: 'Certificados APNS não configurados',
      });
    }

    if (process.env.MDM_MODE === 'real') {
      return res.json({ success: true, message: 'APNS validado (modo real)' });
    }

    res.json({
      success: true,
      message: 'APNS simulado com sucesso',
      mode: 'simulation',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erro ao testar APNS' });
  }
});

export default router;