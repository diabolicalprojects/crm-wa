import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { SecretsService } from './secrets.service';

describe('servicios base',()=>{
  it('reporta salud con fecha ISO',()=>{
    const result=new HealthController().check();
    expect(result).toMatchObject({status:'ok',service:'crm-api'});
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });

  it('cifra con AES-GCM y recupera el valor original',()=>{
    const secrets=new SecretsService();
    const encrypted=secrets.encrypt('api-key-privada');
    expect(encrypted).not.toContain('api-key-privada');
    expect(encrypted.split('.')).toHaveLength(3);
    expect(secrets.decrypt(encrypted)).toBe('api-key-privada');
  });

  it('conecta Prisma solo cuando se solicita y siempre desconecta',async()=>{
    const prisma=new PrismaService();
    const connect=vi.spyOn(prisma,'$connect').mockResolvedValue();
    const disconnect=vi.spyOn(prisma,'$disconnect').mockResolvedValue();
    const previous=process.env.EAGER_DB_CONNECT;
    delete process.env.EAGER_DB_CONNECT;
    await prisma.onModuleInit();
    expect(connect).not.toHaveBeenCalled();
    process.env.EAGER_DB_CONNECT='true';
    await prisma.onModuleInit();
    expect(connect).toHaveBeenCalledOnce();
    await prisma.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledOnce();
    if(previous===undefined)delete process.env.EAGER_DB_CONNECT;else process.env.EAGER_DB_CONNECT=previous;
  });
});
