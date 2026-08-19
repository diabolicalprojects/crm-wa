import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiErrorMessage, request } from './api-client';

describe('cliente HTTP del frontend',()=>{
  afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});

  it('presenta mensajes de NestJS sin mostrar JSON crudo',()=>{
    expect(apiErrorMessage('{"statusCode":409,"message":"Ya existe una agencia con ese slug"}',409)).toBe('Ya existe una agencia con ese slug');
    expect(apiErrorMessage('{"message":["nombre requerido","correo inválido"]}',400)).toBe('nombre requerido, correo inválido');
    expect(apiErrorMessage('Bad gateway',502)).toBe('Bad gateway');
  });

  it('envía token y agencia seleccionada en cada consulta',async()=>{
    vi.stubGlobal('window',{});
    vi.stubGlobal('localStorage',{getItem:vi.fn((key:string)=>key==='crm_token'?'jwt-token':key==='crm_org'?'org-1':null)});
    const fetchMock=vi.fn().mockResolvedValue({ok:true,status:200,json:()=>Promise.resolve([])});
    vi.stubGlobal('fetch',fetchMock);
    await request('/leads');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/leads'),expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer jwt-token','x-organization-id':'org-1'})}));
  });

  it('lanza un error legible para respuestas fallidas',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:409,text:()=>Promise.resolve('{"message":"Slug duplicado"}')}));
    await expect(request('/organizations')).rejects.toThrow('Slug duplicado');
  });
});
