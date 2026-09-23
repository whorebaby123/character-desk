export default {
 async fetch(request){
  const url=new URL(request.url);
  if(url.hostname!=='provider.example.com')throw Error('Unexpected fixture host');
  if(url.pathname.endsWith('/models'))return Response.json({models:[{name:'models/test-model'}]});
  if(url.pathname.includes('redirect-fixture'))return new Response(null,{status:307,headers:{location:'https://must-not-be-contacted.example.com/'}});
  if(url.pathname.includes(':generateContent')){
   if(request.headers.get('x-goog-api-key')!=='fixture-key')throw Error('Missing native authentication');
   return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'OK'}]}}]});
  }
  if(url.pathname.endsWith('/chat/completions')){
   if(request.headers.get('authorization')!=='Bearer fixture-key')throw Error('Missing compatible authentication');
   return Response.json({choices:[{finish_reason:'stop',message:{content:'OK'}}]});
  }
  throw Error('Unexpected fixture route');
 }
};
