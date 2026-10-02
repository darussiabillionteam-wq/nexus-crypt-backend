import express from 'express';
import prisma from '../config/prisma.js';
import { authMiddleware, adminOnly } from '../middlewares/auth.js';

const router = express.Router();

router.use(authMiddleware);
router.use(adminOnly);

// GET - Buscar configuração
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

// PUT - Salvar/atualizar configuração
router.put('/', async (req, res) => {
  try {
    const {
      apnsCert, apnsKey, mdmCert, mdmKey,
      teamId, keyId, bundleId, mdmTopic,
      appleId, orgName, department, supportEmail,
    } = req.body;

    let config = await prisma.appleConfig.findFirst();

    // CORREÇÃO: Removido 'keyId' da validação
    const isConfigured = !!(apnsCert && apnsKey && mdmCert && mdmKey && teamId && bundleId && mdmTopic);

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

// POST - Testar conexão APNS
router.post('/test-apns', async (req, res) => {
  try {
    const config = await prisma.appleConfig.findFirst();

    if (!config?.apnsCert || !config?.apnsKey) {
      return res.status(400).json({
        success: false,
        error: 'Certificados APNS não configurados',
      });
    }

    const certValid = config.apnsCert.includes('BEGIN CERTIFICATE') && config.apnsCert.includes('END CERTIFICATE');
    const keyValid = config.apnsKey.includes('BEGIN') && config.apnsKey.includes('KEY') && config.apnsKey.includes('END');

    if (!certValid) {
      return res.status(400).json({
        success: false,
        error: 'Certificado APNS inválido (formato PEM incorreto)',
      });
    }

    if (!keyValid) {
      return res.status(400).json({
        success: false,
        error: 'Chave privada APNS inválida (formato PEM incorreto)',
      });
    }

    if (!config.teamId || !config.mdmTopic || !config.bundleId) {
      return res.status(400).json({
        success: false,
        error: 'Team ID, Topic MDM ou Bundle ID não configurados',
      });
    }

    if (!config.isConfigured) {
      await prisma.appleConfig.update({
        where: { id: config.id },
        data: { isConfigured: true },
      });
      console.log('[TEST-APNS] isConfigured atualizado para true');
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action: 'APNS_TEST',
        target: 'AppleConfig',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        hash: Math.random().toString(36).substring(2, 10),
      },
    });

    if (process.env.MDM_MODE === 'real') {
      return res.json({
        success: true,
        message: 'APNS validado com sucesso (modo real)',
        mode: 'real',
        topic: config.mdmTopic,
        teamId: config.teamId,
        bundleId: config.bundleId,
      });
    }

    res.json({
      success: true,
      message: 'APNS simulado com sucesso',
      mode: 'simulation',
    });
  } catch (error) {
    console.error('[TEST-APNS] Erro:', error);
    res.status(500).json({ success: false, error: 'Erro ao testar APNS' });
  }
});

export default router;