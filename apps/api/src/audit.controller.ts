import { Controller, Get } from '@nestjs/common'; import { PrismaService } from './prisma.service'; import { TenantId } from './tenant';
@Controller('audit') export class AuditController {constructor(private db:PrismaService){} @Get() list(@TenantId() organizationId:string){return this.db.auditLog.findMany({where:{organizationId},take:200,orderBy:{createdAt:'desc'}})}}
