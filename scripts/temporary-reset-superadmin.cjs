const { PrismaClient } = require('@prisma/client');

const db = new PrismaClient();

db.user.updateMany({
  where: { isSuperAdmin: true },
  data: {
    passwordHash: '$2b$12$NzmNgq/0J7TvfFMKf4LNIO4tijVuE33JTH8D14jdRaYiIU2YVBPbi',
    status: 'ACTIVE',
  },
}).then(result => {
  if (!result.count) throw new Error('No se encontró el superusuario');
}).finally(() => db.$disconnect());
