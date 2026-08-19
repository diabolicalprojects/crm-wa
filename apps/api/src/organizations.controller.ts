import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hash } from 'bcryptjs'; import { createHash, randomBytes } from 'crypto';
import { CurrentUser, AuthUser, Public, Roles } from './auth'; import { PrismaService } from './prisma.service';
@Controller('organizations')
export class OrganizationsController {
  constructor(private db:PrismaService){}
  @Get() list(@CurrentUser() user:AuthUser){return user.isSuperAdmin?this.db.organization.findMany({include:{_count:{select:{members:true,agents:true,sessions:true,leads:true}}},orderBy:{createdAt:'desc'}}):this.db.organization.findMany({where:{members:{some:{userId:user.id}}}})}
  @Roles('SUPER_ADMIN') @Post() async create(@CurrentUser() user:AuthUser,@Body() body:{name:string;slug:string;ownerEmail:string;ownerName?:string;timezone?:string}){
    const name=body.name?.trim();
    const slug=body.slug?.trim().toLowerCase();
    const ownerEmail=body.ownerEmail?.trim().toLowerCase();
    if(!name||!slug||!ownerEmail)throw new BadRequestException('Nombre, slug y correo del propietario son obligatorios');
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw new BadRequestException('El slug solo puede contener letras minúsculas, números y guiones');
    try{
      return await this.db.$transaction(async tx=>{
        const owner=await tx.user.upsert({where:{email:ownerEmail},create:{email:ownerEmail,name:body.ownerName?.trim()||ownerEmail,status:'INVITED'},update:{}});
        const organization=await tx.organization.create({data:{name,slug,timezone:body.timezone?.trim()||'America/Mexico_City',members:{create:{userId:owner.id,role:'OWNER',status:'INVITED'}}}});
        const token=randomBytes(32).toString('hex');
        await tx.invitation.create({data:{organizationId:organization.id,email:owner.email,role:'OWNER',tokenHash:createHash('sha256').update(token).digest('hex'),invitedById:user.id,expiresAt:new Date(Date.now()+7*86400000)}});
        await tx.auditLog.create({data:{organizationId:organization.id,userId:user.id,action:'ORGANIZATION_CREATED',entityType:'Organization',entityId:organization.id}});
        return {organization,invitationToken:token};
      });
    }catch(error){
      if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw new ConflictException('Ya existe una agencia con ese slug');
      throw error;
    }
  }
  @Patch(':id/status') async status(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:{status:'ACTIVE'|'SUSPENDED'|'ARCHIVED'}){if(!user.isSuperAdmin)throw new ForbiddenException('Solo superadministración');const result=await this.db.organization.update({where:{id},data:{status:body.status}});await this.audit(id,user.id,'ORGANIZATION_STATUS_CHANGED','Organization',id,{status:body.status});return result}
  @Post(':id/invitations') @Roles('OWNER','ADMIN') async invite(@CurrentUser() user:AuthUser,@Param('id') organizationId:string,@Body() body:{email:string;role:'ADMIN'|'SUPERVISOR'|'ADVISOR'}){if(!user.isSuperAdmin&&user.organizationId!==organizationId)throw new ForbiddenException('Agencia inválida');const token=randomBytes(32).toString('hex');await this.db.invitation.create({data:{organizationId,email:body.email.trim().toLowerCase(),role:body.role,tokenHash:createHash('sha256').update(token).digest('hex'),invitedById:user.id,expiresAt:new Date(Date.now()+7*86400000)}});return {token,expiresIn:'7d'}}
  @Public() @Post('invitations/accept') async accept(@Body() body:{token:string;name:string;password:string}){const tokenHash=createHash('sha256').update(body.token).digest('hex');const invite=await this.db.invitation.findUnique({where:{tokenHash}});if(!invite||invite.acceptedAt||invite.expiresAt<new Date())throw new ForbiddenException('Invitación inválida o vencida');const passwordHash=await hash(body.password,12);const user=await this.db.user.upsert({where:{email:invite.email},create:{email:invite.email,name:body.name,passwordHash,status:'ACTIVE'},update:{name:body.name,passwordHash,status:'ACTIVE'}});await this.db.organizationMember.upsert({where:{organizationId_userId:{organizationId:invite.organizationId,userId:user.id}},create:{organizationId:invite.organizationId,userId:user.id,role:invite.role,status:'ACTIVE'},update:{role:invite.role,status:'ACTIVE'}});await this.db.invitation.update({where:{id:invite.id},data:{acceptedAt:new Date()}});return {accepted:true}}
  @Get(':id/members') listMembers(@CurrentUser() user:AuthUser,@Param('id') organizationId:string){if(!user.isSuperAdmin&&user.organizationId!==organizationId)throw new ForbiddenException('Agencia inválida');return this.db.organizationMember.findMany({where:{organizationId},include:{user:{select:{id:true,email:true,name:true,status:true}}}})}
  private audit(organizationId:string,userId:string,action:string,entityType:string,entityId:string,metadata?:object){return this.db.auditLog.create({data:{organizationId,userId,action,entityType,entityId,metadata}})}
}
