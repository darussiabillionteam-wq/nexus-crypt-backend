import express from 'express';
import prisma from '../config/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';
import fetch from 'node-fetch';

const router = express.Router();
router.use(authMiddleware);

const SIMPLEMDM_API_KEY = process.env.SIMPLEMDM_API_KEY || 'fByf7YlSLb7nbq37a1xnHyHDbVXRzISY5qzTpR65DvEj6Iws2fmpKWXU1QvuW7bI';
const SIMPLEMDM_BASE_URL = 'https://a.simplemdm.com/api/v1';
const authHeader = 'Basic ' + Buffer.from(SIMPLEMDM_API_KEY + ':').toString('base64');

// Lista os enrollments disponíveis
router.get('/list', async (req, res) => {
  try {
    const r = await fetch(`${SIMPLEMDM_BASE_URL}/enrollments`, {
      headers: { Authorization: authHeader },
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: 'Erro SimpleMDM', details: data });

    const enrollments = (data.data || []).map((e) => ({
      id: e.id,
      name: e.attributes.name || `Enrollment ${e.id}`,
      url: e.attributes.url,
      userEnrollment: e.attributes.user_enrollment,
      welcomeScreen: e.attributes.welcome_screen,
      authentication: e.attributes.authentication,
    }));

    res.json({ enrollments });
  } catch (err) {
    console.error('[ENROLLMENT]', err);
    res.status(500).json({ error: err.message });
  }
});

// Cria um novo Group Enrollment
router.post('/create', async (req, res) => {
  try {
    const { name } = req.body;
    const r = await fetch(`${SIMPLEMDM_BASE_URL}/enrollments`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: name || `Nexus Crypt ${new Date().toLocaleDateString('pt-BR')}`,
        type: 'group',
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: 'Erro SimpleMDM', details: data });

    res.json({
      success: true,
      id: data.data?.id,
      url: data.data?.attributes?.url,
      name: data.data?.attributes?.name,
    });
  } catch (err) {
    console.error('[ENROLLMENT]', err);
    res.status(500).json({ error: err.message });
  }
});

// Pega o PRIMEIRO enrollment existente (mais prático)
router.get('/default', async (req, res) => {
  try {
    const r = await fetch(`${SIMPLEMDM_BASE_URL}/enrollments`, {
      headers: { Authorization: authHeader },
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: 'Erro SimpleMDM' });

    const enrollments = data.data || [];
    const withUrl = enrollments.find((e) => e.attributes.url);

    if (!withUrl) {
      return res.status(404).json({ error: 'Nenhum enrollment com URL encontrado' });
    }

    res.json({
      id: withUrl.id,
      name: withUrl.attributes.name || `Enrollment ${withUrl.id}`,
      url: withUrl.attributes.url,
    });
  } catch (err) {
    console.error('[ENROLLMENT]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;