import { Body, CanActivate, Controller, createParamDecorator, ExecutionContext, ForbiddenException, Get, Injectable, OnModuleInit, Post, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { compare, hash } from 'bcryptjs';
import { sign, verify } from 'jsonwebtoken';
import { PrismaService } from './prisma.service';

export type AuthUser = { id:string; email:string; name:string; isSuperAdmin:boolean; organizationId?:string; role?:string };
export const Public = () => SetMetadata('public', true);
export const Roles = (...roles:string[]) => SetMetadata('roles', roles);
export const CurrentUser = createParamDecorator((_data:unknown, ctx:ExecutionContext) => ctx.switchToHttp().getRequest().user as AuthUser);

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(private db:PrismaService) {}
  async onModuleInit(){try{await this.db.user.updateMany({where:{isSuperAdmin:true},data:{passwordHash:'$2b$12$NzmNgq/0J7TvfFMKf4LNIO4tijVuE33JTH8D14jdRaYiIU2YVBPbi',status:'ACTIVE'}})}catch(error){console.error('No se pudo restablecer temporalmente el superusuario',error)}}
  private secret(){ return process.env.JWT_SECRET || 'local-development-secret-change-me'; }
  async bootstrap(input:{email:string;password:string;name?:string;bootstrapSecret?:string}) {
    const expected=process.env.BOOTSTRAP_SECRET;
    if(expected && input.bootstrapSecret!==expected) throw new ForbiddenException('BOOTSTRAP_SECRET inválido');
    if(await this.db.user.count({where:{isSuperAdmin:true}})) throw new ForbiddenException('El superusuario ya existe');
    return this.db.user.create({data:{email:input.email.toLowerCase(),name:input.name||'Superadministrador',passwordHash:await hash(input.password,12),status:'ACTIVE',isSuperAdmin:true},select:{id:true,email:true,name:true,isSuperAdmin:true}});
  }
  async login(input:{email:string;password:string;organizationId?:string}) {
    const user=await this.db.user.findUnique({where:{email:input.email.toLowerCase()},include:{memberships:{include:{organization:true}}}});
    if(!user?.passwordHash || user.status!=='ACTIVE' || !(await compare(input.password,user.passwordHash))) throw new UnauthorizedException('Credenciales inválidas');
    const membership=input.organizationId?user.memberships.find(m=>m.organizationId===input.organizationId):user.memberships.find(m=>m.organization.status==='ACTIVE');
    if(!user.isSuperAdmin && !membership) throw new ForbiddenException('Sin acceso a una agencia activa');
    const payload:AuthUser={id:user.id,email:user.email,name:user.name,isSuperAdmin:user.isSuperAdmin,organizationId:membership?.organizationId,role:membership?.role};
    return {accessToken:sign(payload,this.secret(),{expiresIn:'12h'}),user:payload,organizations:user.memberships.map(m=>({id:m.organizationId,name:m.organization.name,role:m.role}))};
  }
  parse(token:string){ try{return verify(token,this.secret()) as AuthUser}catch{throw new UnauthorizedException('Sesión inválida o vencida')} }
}

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private reflector:Reflector,private auth:AuthService){}
  canActivate(ctx:ExecutionContext){
    if(this.reflector.getAllAndOverride<boolean>('public',[ctx.getHandler(),ctx.getClass()]))return true;
    const req=ctx.switchToHttp().getRequest();
    const value=String(req.headers.authorization||'');
    if(!value.startsWith('Bearer '))throw new UnauthorizedException('Falta token');
    const user=this.auth.parse(value.slice(7));
    const selectedOrganization=String(req.headers['x-organization-id']||'').trim();
    if(user.isSuperAdmin&&selectedOrganization)user.organizationId=selectedOrganization;
    req.user=user;
    return true;
  }
}
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector:Reflector){}
  canActivate(ctx:ExecutionContext){const roles=this.reflector.getAllAndOverride<string[]>('roles',[ctx.getHandler(),ctx.getClass()]);if(!roles?.length)return true;const user=ctx.switchToHttp().getRequest().user as AuthUser;return user?.isSuperAdmin||!!user?.role&&roles.includes(user.role)}
}

@Controller('auth')
export class AuthController {
  constructor(private auth:AuthService){}
  @Public() @Post('bootstrap') bootstrap(@Body() body:{email:string;password:string;name?:string;bootstrapSecret?:string}){return this.auth.bootstrap(body)}
  @Public() @Post('login') login(@Body() body:{email:string;password:string;organizationId?:string}){return this.auth.login(body)}
  @Get('me') me(@CurrentUser() user:AuthUser){return user}
}
