const config={provider:'gemini',baseURL:'https://provider.example.com/v1beta',model:'test-model',key:'fixture-key',action:'test'};
async function send(env,overrides={}){
 const response=await env.APP.fetch(new Request('https://desk.example.com/api/connection',{method:'POST',headers:{origin:'https://desk.example.com','Content-Type':'application/json'},body:JSON.stringify({...config,...overrides})}));
 return {status:response.status,body:await response.json()};
}
export const nativeConnection={async test(_ctrl,env){
 const result=await send(env);if(result.status!==200||result.body.success!==true)throw Error('Native call failed: '+JSON.stringify(result));
}};
export const compatibleConnection={async test(_ctrl,env){
 const result=await send(env,{provider:'custom',baseURL:'https://provider.example.com/v1'});if(result.status!==200||result.body.success!==true)throw Error('Compatible call failed: '+JSON.stringify(result));
}};
export const nativeModelList={async test(_ctrl,env){
 const result=await send(env,{action:'models'});if(result.status!==200||result.body.models?.[0]?.id!=='test-model')throw Error('Model list failed: '+JSON.stringify(result));
}};
export const blockedRedirect={async test(_ctrl,env){
 const result=await send(env,{model:'redirect-fixture'});if(result.status!==502||result.body.code!=='UPSTREAM_REDIRECT')throw Error('Redirect was not blocked: '+JSON.stringify(result));
}};
