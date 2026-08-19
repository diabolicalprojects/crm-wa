const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:3001/api/v1';

export function apiErrorMessage(text:string,status:number){
  if(!text)return `Error ${status}`;
  try{
    const parsed=JSON.parse(text);
    return Array.isArray(parsed.message)?parsed.message.join(', '):parsed.message||`Error ${status}`;
  }catch{return text}
}

export async function request(path:string,options:RequestInit={}){
  const token=typeof window!=='undefined'?localStorage.getItem('crm_token'):'';
  const organizationId=typeof window!=='undefined'?localStorage.getItem('crm_org'):'';
  const response=await fetch(API+path,{...options,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),Authorization:token?'Bearer '+token:'',...(organizationId?{'x-organization-id':organizationId}:{}),...options.headers}});
  if(!response.ok)throw new Error(apiErrorMessage(await response.text(),response.status));
  return response.status===204?null:response.json();
}
