import { readApiRequest, generate, apiError, ApiFailure } from '@/lib/api-server';
export async function POST(request:Request){
  try{const {body,config,key}=await readApiRequest(request);if(typeof body.prompt!=='string'||!body.prompt.trim())throw new ApiFailure('请提供生成提示词。');
    const result=await generate(config,key,body.prompt,request.signal);
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(error){return apiError(error);}
}
