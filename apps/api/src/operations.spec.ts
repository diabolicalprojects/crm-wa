import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditController } from './audit.controller';
import { ConversationsController } from './conversations.controller';
import { DashboardController } from './dashboard.controller';
import { ImportsController } from './imports.controller';
import { LlmController } from './llm.controller';

describe('operación, métricas e importación sin OpenWA',()=>{
  let db:any;
  beforeEach(()=>{
    db={
      conversation:{findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(2),update:vi.fn().mockResolvedValue({id:'c1'})},
      message:{findMany:vi.fn().mockResolvedValue([])},
      lead:{count:vi.fn().mockResolvedValue(3)},property:{count:vi.fn().mockResolvedValue(4),create:vi.fn().mockResolvedValue({id:'p1'})},agent:{count:vi.fn().mockResolvedValue(1)},whatsappSession:{count:vi.fn().mockResolvedValue(0)},
      auditLog:{findMany:vi.fn().mockResolvedValue([]),create:vi.fn().mockResolvedValue({id:'log1'})},
      llmProvider:{findMany:vi.fn().mockResolvedValue([{id:'llm1',encryptedApiKey:'cipher'}]),create:vi.fn().mockResolvedValue({id:'llm1',encryptedApiKey:'cipher'}),delete:vi.fn()},
    };
    db.$transaction=vi.fn((items:any)=>Promise.all(items));
  });

  it('calcula el dashboard con alcance de la agencia seleccionada',async()=>{
    const result=await new DashboardController(db).summary({id:'u1',email:'x@y.com',name:'X',isSuperAdmin:true,organizationId:'org-1'});
    expect(result.metrics).toEqual({conversations:2,leads:3,properties:4,agents:1,sessions:0});
    expect(result.scope).toBe('organization');
    expect(db.property.count).toHaveBeenCalledWith({where:{organizationId:'org-1',status:'AVAILABLE'}});
  });

  it('lista mensajes y cambia takeover sin invocar OpenWA',async()=>{
    const controller=new ConversationsController(db,{} as any);
    await controller.list('org-1');
    await controller.messages('org-1','c1');
    await controller.takeover({id:'u1',email:'x@y.com',name:'X',isSuperAdmin:false},'org-1','c1');
    await controller.returnToAi({id:'u1',email:'x@y.com',name:'X',isSuperAdmin:false},'org-1','c1');
    expect(db.message.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{conversationId:'c1',conversation:{organizationId:'org-1'}}}));
    expect(db.conversation.update).toHaveBeenNthCalledWith(1,{where:{id:'c1',organizationId:'org-1'},data:{mode:'HUMAN_ACTIVE',assignedUserId:'u1'}});
    expect(db.conversation.update).toHaveBeenNthCalledWith(2,{where:{id:'c1',organizationId:'org-1'},data:{mode:'AI_ACTIVE',assignedUserId:null}});
  });

  it('limita la auditoría al tenant',async()=>{
    await new AuditController(db).list('org-1');
    expect(db.auditLog.findMany).toHaveBeenCalledWith({where:{organizationId:'org-1'},take:200,orderBy:{createdAt:'desc'}});
  });

  it('importa CSV válido, reporta filas inválidas y nunca llama OpenWA',async()=>{
    db.property.create.mockResolvedValueOnce({id:'p1'}).mockRejectedValueOnce(new Error('precio inválido'));
    const file={buffer:Buffer.from('title,location,price\nCasa,Centro,1000000\nDepartamento,Norte,no-numero')} as Express.Multer.File;
    const result=await new ImportsController(db).properties('org-1',file);
    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(db.property.create).toHaveBeenNthCalledWith(1,{data:expect.objectContaining({organizationId:'org-1',title:'Casa',location:'Centro',price:1000000})});
  });

  it('oculta y cifra las credenciales de proveedores LLM',async()=>{
    const secrets:any={encrypt:vi.fn().mockReturnValue('cipher')};
    const controller=new LlmController(db,secrets);
    expect(await controller.list()).toEqual([{id:'llm1',encryptedApiKey:'••••••••'}]);
    expect(await controller.create({name:'Gemini',provider:'GEMINI',model:'flash',apiKey:'secret'})).toEqual({id:'llm1',encryptedApiKey:'••••••••'});
    expect(secrets.encrypt).toHaveBeenCalledWith('secret');
    await controller.remove('llm1');
    expect(db.llmProvider.delete).toHaveBeenCalledWith({where:{id:'llm1'}});
  });
});
