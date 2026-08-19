import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentsController } from './agents.controller';
import { LeadsController } from './leads.controller';
import { PropertiesController } from './properties.controller';
import { VisitsController } from './visits.controller';

describe('CRUD del CRM aislado por agencia',()=>{
  let db:any;
  beforeEach(()=>{
    db={
      property:{findMany:vi.fn().mockResolvedValue([]),create:vi.fn().mockResolvedValue({id:'p1'}),update:vi.fn().mockResolvedValue({id:'p1'})},
      lead:{findMany:vi.fn().mockResolvedValue([]),create:vi.fn().mockResolvedValue({id:'l1'}),findFirst:vi.fn(),update:vi.fn()},
      agent:{findMany:vi.fn().mockResolvedValue([]),create:vi.fn().mockResolvedValue({id:'a1'}),update:vi.fn()},
      visit:{findMany:vi.fn().mockResolvedValue([]),create:vi.fn().mockResolvedValue({id:'v1'}),update:vi.fn()},
      whatsappSession:{updateMany:vi.fn(),update:vi.fn()},
    };
    db.$transaction=vi.fn((callback:any)=>callback(db));
  });

  it('crea y lista propiedades con conversiones correctas',async()=>{
    const controller=new PropertiesController(db);
    await controller.list('org-1');
    await controller.create('org-1',{title:'Casa',operationType:'VENTA',propertyType:'CASA',location:'Centro',price:'2500000',bedrooms:'3',amenities:['terraza']});
    expect(db.property.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{organizationId:'org-1'}}));
    expect(db.property.create).toHaveBeenCalledWith({data:expect.objectContaining({organizationId:'org-1',price:2500000,bedrooms:3,currency:'MXN',amenities:['terraza']})});
  });

  it('actualiza y desactiva propiedades dentro del tenant',async()=>{
    const controller=new PropertiesController(db);
    await controller.update('org-1','p1',{title:'Casa editada'});
    await controller.remove('org-1','p1');
    expect(db.property.update).toHaveBeenNthCalledWith(1,{where:{id:'p1',organizationId:'org-1'},data:{title:'Casa editada'}});
    expect(db.property.update).toHaveBeenNthCalledWith(2,{where:{id:'p1',organizationId:'org-1'},data:{status:'INACTIVE'}});
  });

  it('crea, consulta y marca leads como perdidos',async()=>{
    const controller=new LeadsController(db);
    await controller.create('org-1',{phone:'5215550000000',name:'Lead'});
    await controller.list('org-1');
    await controller.remove('org-1','l1');
    expect(db.lead.create).toHaveBeenCalledWith({data:{organizationId:'org-1',phone:'5215550000000',name:'Lead'}});
    expect(db.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{organizationId:'org-1'}}));
    expect(db.lead.update).toHaveBeenCalledWith({where:{id:'l1',organizationId:'org-1'},data:{stage:'LOST'}});
  });

  it('consulta y actualiza un lead sin salir del tenant',async()=>{
    const controller=new LeadsController(db);
    await controller.one('org-1','l1');
    await controller.update('org-1','l1',{score:90});
    expect(db.lead.findFirst).toHaveBeenCalledWith({where:{id:'l1',organizationId:'org-1'},include:{conversations:true}});
    expect(db.lead.update).toHaveBeenCalledWith({where:{id:'l1',organizationId:'org-1'},data:{score:90}});
  });

  it('crea, asigna sesión y archiva agentes',async()=>{
    const controller=new AgentsController(db);
    await controller.create('org-1',{name:'Agente',responsibleUserId:'u1'});
    await controller.assign('org-1','a1',{sessionId:'s1'});
    await controller.remove('org-1','a1');
    expect(db.agent.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({organizationId:'org-1',operationMode:'HYBRID'})}));
    expect(db.whatsappSession.update).toHaveBeenCalledWith({where:{id:'s1',organizationId:'org-1'},data:{agentId:'a1'},include:{agent:true}});
    expect(db.agent.update).toHaveBeenCalledWith({where:{id:'a1',organizationId:'org-1'},data:{status:'ARCHIVED',aiEnabled:false}});
  });

  it('lista y actualiza agentes del tenant',async()=>{
    const controller=new AgentsController(db);
    await controller.list('org-1');
    await controller.update('org-1','a1',{status:'ACTIVE'});
    expect(db.agent.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{organizationId:'org-1',status:{not:'ARCHIVED'}}}));
    expect(db.agent.update).toHaveBeenCalledWith({where:{id:'a1',organizationId:'org-1'},data:{status:'ACTIVE'}});
  });

  it('normaliza fechas y estados de las visitas',async()=>{
    const controller=new VisitsController(db);
    await controller.create('org-1',{propertyId:'p1',leadId:'l1',assignedUserId:'u1',startsAt:'2026-09-01T10:00:00Z',endsAt:'2026-09-01T11:00:00Z'});
    await controller.update('org-1','v1',{startsAt:'2026-09-02T10:00:00Z',notes:'Confirmada'});
    await controller.cancel('org-1','v1');
    expect(db.visit.create).toHaveBeenCalledWith({data:expect.objectContaining({organizationId:'org-1',startsAt:expect.any(Date),endsAt:expect.any(Date),status:'SYNC_PENDING'})});
    expect(db.visit.update).toHaveBeenNthCalledWith(1,{where:{id:'v1',organizationId:'org-1'},data:expect.objectContaining({startsAt:expect.any(Date),status:'SYNC_PENDING'})});
    expect(db.visit.update).toHaveBeenNthCalledWith(2,{where:{id:'v1',organizationId:'org-1'},data:{status:'CANCELLED'}});
  });

  it('lista visitas únicamente de la agencia',async()=>{
    await new VisitsController(db).list('org-1');
    expect(db.visit.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{organizationId:'org-1'}}));
  });
});
