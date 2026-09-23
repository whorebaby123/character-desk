import { readApiRequest, generate, listModels, apiError, ApiFailure } from '@/lib/api-server';
export async function POST(request:Request){
  try{const {body,config,key}=await readApiRequest(request);const started=Date.now();
    if(body.action==='models')return Response.json(await listModels(config,key,request.signal),{headers:{'Cache-Control':'no-store'}});
    if(body.action!=='test')throw new ApiFailure('未知连接操作。');
    const result=await generate(config,key,'Connection test. Reply with the single word OK. Do not include any other text.',request.signal);
    return Response.json({success:true,model:config.model,elapsedMs:Date.now()-started,notes:result.notes,message:'模型已返回有效正文。'},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return apiError(error);}
}
