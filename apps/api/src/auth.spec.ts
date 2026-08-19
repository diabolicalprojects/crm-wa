import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthService, JwtGuard, RolesGuard } from './auth';
import { resolveTenantId } from './tenant';

function context(headers:any,user?:any){
  const request={headers,user};
  return {switchToHttp:()=>({getRequest:()=>request}),getHandler:()=>null,getClass:()=>null,request} as any;
}

describe('autenticación y autorización',()=>{
  it('inicia sesión y emite contexto de la membresía activa',async()=>{
    const passwordHash=await hash('correct-password',4);
    const db:any={user:{findUnique:vi.fn().mockResolvedValue({id:'u1',email:'owner@test.com',name:'Owner',status:'ACTIVE',isSuperAdmin:false,passwordHash,memberships:[{organizationId:'org-1',role:'OWNER',organization:{name:'Agencia',status:'ACTIVE'}}]})}};
    const auth=new AuthService(db);
    const result=await auth.login({email:'OWNER@test.com',password:'correct-password'});
    expect(result.user).toMatchObject({organizationId:'org-1',role:'OWNER'});
    expect(auth.parse(result.accessToken)).toMatchObject({id:'u1',organizationId:'org-1'});
  });

  it('rechaza contraseña inválida y usuarios sin agencia',async()=>{
    const passwordHash=await hash('correct-password',4);
    const db:any={user:{findUnique:vi.fn().mockResolvedValue({id:'u1',email:'x@y.com',name:'X',status:'ACTIVE',isSuperAdmin:false,passwordHash,memberships:[]})}};
    const auth=new AuthService(db);
    await expect(auth.login({email:'x@y.com',password:'wrong-password'})).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.login({email:'x@y.com',password:'correct-password'})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('aplica al superusuario la agencia enviada en el encabezado',async()=>{
    const auth:any={parse:vi.fn().mockReturnValue({id:'s1',email:'a@b.com',name:'Admin',isSuperAdmin:true})};
    const reflector:any={getAllAndOverride:vi.fn().mockReturnValue(false)};
    const guard=new JwtGuard(reflector,auth);
    const ctx=context({authorization:'Bearer valid','x-organization-id':'org-selected'});
    expect(guard.canActivate(ctx)).toBe(true);
    expect(ctx.request.user.organizationId).toBe('org-selected');
  });

  it('no permite que un usuario normal suplante otra agencia',()=>{
    const auth:any={parse:vi.fn().mockReturnValue({id:'u1',isSuperAdmin:false,organizationId:'org-own',role:'OWNER'})};
    const guard=new JwtGuard({getAllAndOverride:()=>false} as any,auth);
    const ctx=context({authorization:'Bearer valid','x-organization-id':'org-other'});
    guard.canActivate(ctx);
    expect(ctx.request.user.organizationId).toBe('org-own');
  });

  it('valida roles y permite siempre al superusuario',()=>{
    const reflector:any={getAllAndOverride:vi.fn().mockReturnValue(['OWNER'])};
    const guard=new RolesGuard(reflector);
    expect(guard.canActivate(context({}, {isSuperAdmin:true}))).toBe(true);
    expect(guard.canActivate(context({}, {isSuperAdmin:false,role:'ADVISOR'}))).toBe(false);
  });

  it('resuelve el tenant del usuario o del selector de superadministración',()=>{
    expect(resolveTenantId({user:{organizationId:'org-own'},headers:{'x-organization-id':'org-other'}})).toBe('org-own');
    expect(resolveTenantId({user:{isSuperAdmin:true},headers:{'x-organization-id':'org-selected'}})).toBe('org-selected');
    expect(()=>resolveTenantId({user:{isSuperAdmin:true},headers:{}})).toThrow('No se seleccionó una agencia');
  });
});
