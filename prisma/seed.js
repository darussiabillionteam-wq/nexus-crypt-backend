import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const adminUsername = process.env.ADMIN_USERNAME || 'rootdarussia';
  const adminPassword = process.env.ADMIN_PASSWORD || '739182Mn@';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@nexuscrypt.com';

  const existingAdmin = await prisma.user.findUnique({
    where: { username: adminUsername },
  });

  if (existingAdmin) {
    console.log(`[SEED] Admin "${adminUsername}" já existe.`);
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const admin = await prisma.user.create({
      data: {
        username: adminUsername,
        email: adminEmail,
        passwordHash,
        role: 'ADMIN',
        active: true,
      },
    });
    console.log(`[SEED] ✅ Admin criado: ${admin.username}`);
  }

  const existingConfig = await prisma.appleConfig.findFirst();
  if (!existingConfig) {
    await prisma.appleConfig.create({
      data: {
        orgName: 'Nexus Crypt Soluções de Segurança',
        department: 'Gerenciamento de Risco e TI',
        isConfigured: false,
      },
    });
    console.log('[SEED] ✅ AppleConfig criada');
  }
}

main()
  .catch((e) => {
    console.error('[SEED] ❌', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });