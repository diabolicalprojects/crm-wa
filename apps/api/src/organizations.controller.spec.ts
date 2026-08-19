import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationsController } from './organizations.controller';

describe('OrganizationsController',()=>{
  let db:any;
  let controller:OrganizationsController;
  const superuser={id:'super-1',email:'admin@test.com',name:'Admin',isSuperAdmin:true};

  beforeEach(()=>{
    db={
      user:{upsert:vi.fn().mockResolvedValue({id:'owner-1',email:'owner@test.com'})},
      organization:{create:vi.fn().mockResolvedValue({id:'org-1',name:'Agencia Test',slug:'agencia-test'}),findMany:vi.fn()},
      invitation:{create:vi.fn(),findUnique:vi.fn(),update:vi.fn()},
      organizationMember:{upsert:vi.fn(),findMany:vi.fn()},
      auditLog:{create:vi.fn()},
    };
    db.$transaction=vi.fn((callback:any)=>callback(db));
    controller=new OrganizationsController(db);
  });

  it('crea agencia, propietario, invitación y auditoría en una transacción',async()=>{
    const result=await controller.create(superuser,{name:' Agencia Test ',slug:'Agencia-Test',ownerEmail:' OWNER@Test.com ',ownerName:' Alonso '});
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.user.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{email:'owner@test.com'}}));
    expect(db.organization.create).toHaveBeenCalledWith({data:expect.objectContaining({name:'Agencia Test',slug:'agencia-test',timezone:'America/Mexico_City'})});
    expect(db.invitation.create).toHaveBeenCalledWith({data:expect.objectContaining({organizationId:'org-1',invitedById:'super-1',role:'OWNER'})});
    expect(db.auditLog.create).toHaveBeenCalledWith({data:expect.objectContaining({action:'ORGANIZATION_CREATED',organizationId:'org-1'})});
    expect(result.invitationToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rechaza datos incompletos o slugs inválidos',async()=>{
    await expect(controller.create(superuser,{name:'',slug:'ok',ownerEmail:'x@y.com'})).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create(superuser,{name:'Agencia',slug:'Slug con espacios',ownerEmail:'x@y.com'})).rejects.toBeInstanceOf(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('convierte el slug duplicado en conflicto 409',async()=>{
    const duplicate=new Prisma.PrismaClientKnownRequestError('duplicate',{code:'P2002',clientVersion:'6.7.0',meta:{target:['slug']}});
    db.organization.create.mockRejectedValue(duplicate);
    await expect(controller.create(superuser,{name:'Agencia',slug:'agencia',ownerEmail:'x@y.com'})).rejects.toBeInstanceOf(ConflictException);
  });

  it('lista globalmente para superusuario y limita miembros por organización',async()=>{
    db.organization.findMany.mockResolvedValue([]);
    db.organizationMember.findMany.mockResolvedValue([]);
    await controller.list(superuser);
    await controller.listMembers(superuser,'org-1');
    expect(db.organization.findMany).toHaveBeenCalledWith(expect.objectContaining({orderBy:{createdAt:'desc'}}));
    expect(db.organizationMember.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{organizationId:'org-1'}}));
  });

  it('cambia estado e invita miembros con auditoría y tenant correctos',async()=>{
    db.organization.update=vi.fn().mockResolvedValue({id:'org-1',status:'SUSPENDED'});
    await controller.status(superuser,'org-1',{status:'SUSPENDED'});
    await controller.invite(superuser,'org-1',{email:' MEMBER@Test.com ',role:'ADVISOR'});
    expect(db.organization.update).toHaveBeenCalledWith({where:{id:'org-1'},data:{status:'SUSPENDED'}});
    expect(db.auditLog.create).toHaveBeenCalledWith({data:expect.objectContaining({action:'ORGANIZATION_STATUS_CHANGED'})});
    expect(db.invitation.create).toHaveBeenCalledWith({data:expect.objectContaining({organizationId:'org-1',email:'member@test.com',role:'ADVISOR'})});
  });

  it('acepta una invitación válida y activa al usuario',async()=>{
    db.invitation.findUnique.mockResolvedValue({id:'inv-1',email:'new@test.com',organizationId:'org-1',role:'ADVISOR',expiresAt:new Date(Date.now()+60_000),acceptedAt:null});
    db.user.upsert.mockResolvedValue({id:'user-2'});
    const result=await controller.accept({token:'token',name:'Nuevo',password:'password-segura'});
    expect(result).toEqual({accepted:true});
    expect(db.organizationMember.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({status:'ACTIVE',role:'ADVISOR'})}));
    expect(db.invitation.update).toHaveBeenCalledWith({where:{id:'inv-1'},data:{acceptedAt:expect.any(Date)}});
  });
});
