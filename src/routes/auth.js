import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../config/prisma.js';

const router = express.Router();

const loginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user || !user.active) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);

    if (!passwordValid) {
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'LOGIN_FALHA',
          target: username,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          hash: Math.random().toString(36).substring(2, 10),
        },
      });
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d' }
    );

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        target: 'Sistema',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        hash: Math.random().toString(36).substring(2, 10),
      },
    });

    res.json({
      token,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    console.error('[AUTH] Erro no login:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token não fornecido' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!user || !user.active) {
      return res.status(401).json({ error: 'Usuário inválido' });
    }

    const newToken = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m' }
    );

    res.json({ token: newToken });
  } catch (error) {
    res.status(401).json({ error: 'Refresh token inválido' });
  }
});

export default router;