var C='trasso-ui-68';
var SHELL=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png','trasso-ent.js','trasso-cloud.js'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(C).then(function(c){return c.addAll(SHELL);}).then(function(){return self.skipWaiting();}));});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==C;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});
/* 2026.11.26 perf: aplicația pornește din memorie (instant, și offline); versiunea nouă se descarcă în fundal
   și se vede la următoarea deschidere. Când index.html s-a schimbat, pagina primește „trasso-update”. */
function sig(res){return res?[res.headers.get('etag')||'',res.headers.get('last-modified')||'',res.headers.get('content-length')||''].join('|'):'';}
function put(r,res){if(res&&res.ok&&res.type==='basic'){var cp=res.clone();return caches.open(C).then(function(c){return c.put(r,cp);});}return Promise.resolve();}
function tell(){return caches.open(C).then(function(c){return c.put('__trasso_update',new Response('1'));}).then(function(){return self.clients.matchAll({type:'window'}).then(function(cs){cs.forEach(function(c){c.postMessage({type:'trasso-update'});});});});}
self.addEventListener('fetch',function(e){
  var r=e.request;if(r.method!=='GET')return;
  var u=new URL(r.url);
  if(u.origin===location.origin){
    var nav=/\/(index\.html)?$/.test(u.pathname);
    var key=nav?'index.html':r;
    /* fișierele cu ?v= nu se schimbă niciodată sub același nume: din memorie, fără descărcare din nou */
    var fixed=/[?&]v=/.test(u.search);
    e.respondWith(caches.match(key,{ignoreSearch:nav}).then(function(m){
      if(m&&fixed)return m;
      var net=fetch(r).then(function(res){
        e.waitUntil(put(key,res));
        if(nav&&m&&res.ok&&sig(res)!==sig(m))e.waitUntil(tell());
        return res;
      });
      if(m){e.waitUntil(net.catch(function(){}));return m;}
      return net.catch(function(){return caches.match(r,{ignoreSearch:true}).then(function(x){return x||caches.match('index.html');});});
    }));
  }else if(/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)){
    e.respondWith(caches.match(r).then(function(m){return m||fetch(r).then(function(res){var cp=res.clone();caches.open(C).then(function(c){c.put(r,cp);});return res;});}));
  }
});
