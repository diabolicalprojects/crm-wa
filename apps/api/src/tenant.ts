import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
export function resolveTenantId(req:{user?:{organizationId?:string;isSuperAdmin?:boolean};headers:Record<string,unknown>}){const id=req.user?.organizationId||(req.user?.isSuperAdmin?req.headers['x-organization-id']:undefined);if(!id)throw new BadRequestException('No se seleccionó una agencia');return String(id)}
export const TenantId=createParamDecorator((_d:unknown,ctx:ExecutionContext)=>resolveTenantId(ctx.switchToHttp().getRequest()));
