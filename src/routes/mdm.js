import express from 'express';
import crypto from 'crypto';
import prisma from '../config/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';
import {
  bloquearDispositivo,
  apagarDispositivo,
  reiniciarDispositivo,
  localizarDispositivo,
  enviarMensagem,
} from '../services/simplemdm.js';

const router = express.Router();

// ============================================================
// ENROLL - Gera o perfil .mobileconfig pra baixar no iPhone
// ============================================================
router.get('/enroll', async (req, res) => {
  try {
    const config = await prisma.appleConfig.findFirst();

    if (!config || !config.mdmCert || !config.mdmKey || !config.mdmTopic) {
      return res.status(400).send('Certificados MDM não configurados no painel');
    }

    const serverUrl = 'https://nexus-crypt-backend.onrender.com/mdm';
    const checkinUrl = 'https://nexus-crypt-backend.onrender.com/mdm/checkin';
    const topic = config.mdmTopic;

    const payloadUUID = crypto.randomUUID();
    const mdmPayloadUUID = crypto.randomUUID();
    const certPayloadUUID = crypto.randomUUID();
    const keyPayloadUUID = crypto.randomUUID();
    const payloadIdentifier = `com.nexuscrypt.mdm.${payloadUUID}`;

    const certBase64 = config.mdmCert
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');

    const keyBase64 = config.mdmKey
      .replace(/-----BEGIN PRIVATE KEY-----/g, '')
      .replace(/-----END PRIVATE KEY-----/g, '')
      .replace(/\s/g, '');

    const mobileconfig = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>

    <dict>
      <key>PayloadCertificateFileName</key>
      <string>nexus-cert.pem</string>
      <key>PayloadContent</key>
      <data>${certBase64}</data>
      <key>PayloadDescription</key>
      <string>Certificado Nexus Crypt MDM</string>
      <key>PayloadDisplayName</key>
      <string>Nexus Crypt Certificate</string>
      <key>PayloadIdentifier</key>
      <string>com.nexuscrypt.mdm.cert.${certPayloadUUID}</string>
      <key>PayloadType</key>
      <string>com.apple.security.pkcs1</string>
      <key>PayloadUUID</key>
      <string>${certPayloadUUID}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>

    <dict>
      <key>PayloadCertificateFileName</key>
      <string>nexus-key.pem</string>
      <key>PayloadContent</key>
      <data>${keyBase64}</data>
      <key>PayloadDescription</key>
      <string>Chave Privada Nexus Crypt MDM</string>
      <key>PayloadDisplayName</key>
      <string>Nexus Crypt Private Key</string>
      <key>PayloadIdentifier</key>
      <string>com.nexuscrypt.mdm.key.${keyPayloadUUID}</string>
      <key>PayloadType</key>
      <string>com.apple.security.pkcs1</string>
      <key>PayloadUUID</key>
      <string>${keyPayloadUUID}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>

    <dict>
      <key>AccessRights</key>
      <integer>8191</integer>
      <key>CheckInURL</key>
      <string>${checkinUrl}</string>
      <key>CheckOutWhenRemoved</key>
      <true/>
      <key>IdentityCertificateUUID</key>
      <string>${certPayloadUUID}</string>
      <key>PayloadDescription</key>
      <string>Perfil MDM Nexus Crypt</string>
      <key>PayloadDisplayName</key>
      <string>Nexus Crypt MDM</string>
      <key>PayloadIdentifier</key>
      <string>com.nexuscrypt.mdm.mdm.${mdmPayloadUUID}</string>
      <key>PayloadOrganization</key>
      <string>${config.orgName || 'Nexus Crypt'}</string>
      <key>PayloadType</key>
      <string>com.apple.mdm</string>
      <key>PayloadUUID</key>
      <string>${mdmPayloadUUID}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>ServerCapabilities</key>
      <array>
        <string>com.apple.mdm.per-user-connections</string>
      </array>
      <key>ServerURL</key>
      <string>${serverUrl}</string>
      <key>SignMessage</key>
      <false/>
      <key>Topic</key>
      <string>${topic}</string>
      <key>UseDevelopmentAPNS</key>
      <false/>
    </dict>

  </array>
  <key>PayloadDescription</key>
  <string>Perfil de gerenciamento Nexus Crypt MDM</string>
  <key>PayloadDisplayName</key>
  <string>Nexus Crypt MDM</string>
  <key>PayloadIdentifier</key>
  <string>${payloadIdentifier}</string>
  <key>PayloadOrganization</key>
  <string>${config.orgName || 'Nexus Crypt'}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${payloadUUID}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>`;

    res.setHeader('Content-Type', 'application/x-apple-aspen-config');
    res.setHeader('Content-Disposition', 'attachment; filename="nexus-crypt.mobileconfig"');
    res.send(mobileconfig);

    console.log('[MDM] Perfil .mobileconfig gerado e enviado');
  } catch (error) {
    console.error('[MDM] Erro no enroll:', error);
    res.status(500).send('Erro ao gerar perfil');
  }
});

// ============================================================
// CHECKIN - iPhone manda UDID, Token, versão iOS
// ============================================================
router.put('/checkin', async (req, res) => {
  try {
    const body = req.body;
    console.log('[MDM] Checkin recebido:', JSON.stringify(body, null, 2));

    const udid = body.UDID;
    const pushToken = body.Token;
    const iosVersion = body.OSVersion;
    const model = body.Model;

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
          name: model ? `${model} - ${udid.substring(0, 6)}` : `iPhone ${udid.substring(0, 6)}`,
          model: model || 'iPhone',
          imei: udid.substring(0, 15),
          udid,
          iosVersion: iosVersion || 'Desconhecido',
          pushToken,
          status: 'ACTIVE',
          enrolledAt: new Date(),
        },
      });
      console.log('[MDM] Dispositivo matriculado:', udid);
    }

    res.json({ status: 'Acknowledged' });
  } catch (error) {
    console.error('[MDM] Erro checkin:', error);
    res.status(500).json({ error: 'Erro no checkin' });
  }
});

// ============================================================
// COMMAND - iPhone busca comandos pendentes
// ============================================================
router.put('/command', async (req, res) => {
  try {
    const udid = req.body.UDID;
    console.log('[MDM] Command request:', udid);

    if (!udid) return res.json({ command: null });

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

// ============================================================
// RESULT - iPhone manda resultado do comando
// ============================================================
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
    res.json({ status: 'Acknowledged' });
  } catch (error) {
    res.status(500).json({ error: 'Erro no result' });
  }
});

// ============================================================
// COMANDOS DO PAINEL ADMIN (banco local)
// ============================================================
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

// ============================================================
// INTEGRAÇÃO SIMPLEMDM — Comandos reais via API
// ============================================================
router.post('/devices/:id/simple-lock', authMiddleware, async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Device não encontrado' });
    if (!device.simplemdmId) return res.status(400).json({ error: 'Device não tem simplemdmId vinculado' });

    const result = await bloquearDispositivo(device.simplemdmId, 'Bloqueado pelo Nexus Crypt', null);
    if (!result.ok) return res.status(result.status).json({ error: 'Erro no SimpleMDM', details: result.data });

    await prisma.device.update({ where: { id: device.id }, data: { status: 'LOCKED' } });
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId, action: 'BLOQUEAR',
        target: `${device.name} (${device.imei})`,
        ip: req.ip, userAgent: req.headers['user-agent'],
        hash: Math.random().toString(36).substring(2, 10),
      },
    });

    res.json({ success: true, message: 'LOCK enviado via SimpleMDM', result: result.data });
  } catch (error) {
    console.error('[simple-lock]', error);
    res.status(500).json({ error: 'Erro ao bloquear' });
  }
});

router.post('/devices/:id/simple-wipe', authMiddleware, async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Device não encontrado' });
    if (!device.simplemdmId) return res.status(400).json({ error: 'Device não tem simplemdmId vinculado' });

    const result = await apagarDispositivo(device.simplemdmId);
    if (!result.ok) return res.status(result.status).json({ error: 'Erro no SimpleMDM', details: result.data });

    await prisma.device.update({ where: { id: device.id }, data: { status: 'WIPED' } });
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId, action: 'APAGAR',
        target: `${device.name} (${device.imei})`,
        ip: req.ip, userAgent: req.headers['user-agent'],
        hash: Math.random().toString(36).substring(2, 10),
      },
    });

    res.json({ success: true, message: 'WIPE enviado via SimpleMDM' });
  } catch (error) {
    console.error('[simple-wipe]', error);
    res.status(500).json({ error: 'Erro ao apagar' });
  }
});

router.post('/devices/:id/simple-restart', authMiddleware, async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Device não encontrado' });
    if (!device.simplemdmId) return res.status(400).json({ error: 'Device não tem simplemdmId vinculado' });

    const result = await reiniciarDispositivo(device.simplemdmId);
    if (!result.ok) return res.status(result.status).json({ error: 'Erro no SimpleMDM', details: result.data });

    res.json({ success: true, message: 'RESTART enviado via SimpleMDM' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao reiniciar' });
  }
});

router.post('/devices/:id/simple-locate', authMiddleware, async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Device não encontrado' });
    if (!device.simplemdmId) return res.status(400).json({ error: 'Device não tem simplemdmId vinculado' });

    const result = await localizarDispositivo(device.simplemdmId);
    if (!result.ok) return res.status(result.status).json({ error: 'Erro no SimpleMDM', details: result.data });

    res.json({ success: true, message: 'Localização solicitada via SimpleMDM' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao localizar' });
  }
});

router.post('/devices/:id/simple-message', authMiddleware, async (req, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Device não encontrado' });
    if (!device.simplemdmId) return res.status(400).json({ error: 'Device não tem simplemdmId vinculado' });

    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensagem obrigatória' });

    const result = await enviarMensagem(device.simplemdmId, message);
    if (!result.ok) return res.status(result.status).json({ error: 'Erro no SimpleMDM', details: result.data });

    res.json({ success: true, message: 'Mensagem enviada via SimpleMDM' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao enviar' });
  }
});

export default router;