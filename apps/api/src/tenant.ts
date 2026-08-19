import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
export const TenantId=createParamDecorator((_d:unknown,ctx:ExecutionContext)=>{const id=ctx.switchToHttp().getRequest().headers['x-organization-id'];if(!id)throw new BadRequestException('Falta x-organization-id');return String(id)});
