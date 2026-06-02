// Edwin Fox Barber Style — Cloudflare Worker
// Arquitectura: R2 (assets/media/data) + Cloudflare Images URL + APIs

const CACHE_HTML    = 60;
const CACHE_MEDIA   = 604800;
const CACHE_ASSETS  = 31536000;
const WA_NUMBER     = '56986505521';
const SETMORE_URL   = 'https://jmarquezbarber.setmore.com';
const INSTAGRAM_URL = 'https://www.instagram.com/edwinfoxbarberstyle/';
const GOOGLE_MAPS   = 'https://share.google/YPLEVo3zPO76PmQfY';

// Datos por defecto (fallback si R2 está vacío)
const DEFAULT_SERVICIOS = [
  { id: 1, nombre: 'Corte masculino',    precio: 12000, duracion: 45, descripcion: 'Fade, undercut o clásico. Con producto.' },
  { id: 2, nombre: 'Perfilado de barba', precio: 8000,  duracion: 30, descripcion: 'Definición, hidratación y forma.' },
  { id: 3, nombre: 'Corte + Barba',      precio: 18000, duracion: 70, descripcion: 'Servicio completo coordinado.' },
  { id: 4, nombre: 'Corte femenino',     precio: 14000, duracion: 50, descripcion: 'Estructura y movimiento.' },
  { id: 5, nombre: 'Corte infantil',     precio: 9000,  duracion: 35, descripcion: 'Técnica adaptada para niños.' },
  { id: 6, nombre: 'Paquete VIP',        precio: 32000, duracion: 120, descripcion: 'Corte + barba + tratamiento + producto.' }
];

const DEFAULT_HORARIOS = {
  lunes:    { abre: '10:00', cierra: '20:00', activo: true },
  martes:   { abre: '10:00', cierra: '20:00', activo: true },
  miercoles:{ abre: '10:00', cierra: '20:00', activo: true },
  jueves:   { abre: '10:00', cierra: '20:00', activo: true },
  viernes:  { abre: '10:00', cierra: '20:00', activo: true },
  sabado:   { abre: '09:00', cierra: '18:00', activo: true },
  domingo:  { activo: false }
};

// ── MAIN FETCH HANDLER ──────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // CORS headers for API
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ── API ROUTES ──
      if (path === '/api/servicios') return await getServicios(env, corsHeaders);
      if (path === '/api/horarios')  return await getHorarios(env, corsHeaders);
      if (path === '/api/galeria')   return await getGaleria(env, corsHeaders);

      // ── IMAGEN CON TRANSFORMACIÓN ──
      if (path.startsWith('/img/')) return await serveImage(url, env);

      // ── ADMIN ROUTES ──
      // ── ADMIN PANEL ──
      if (path === '/admin' && method === 'GET') return serveAdminPanel();
      if (path === '/admin/import-url' && method === 'POST') return await adminImportUrl(request, env);
      if (path === '/admin/upload'     && method === 'POST') return await adminUpload(request, env);

      // ── ASSETS ESTÁTICOS DESDE R2 ──
      const assetPath = path === '/' ? '/index.html' : path;
      if (path !== '/' && !path.endsWith('.html')) {
        const asset = await serveR2Asset(assetPath, env);
        if (asset) return asset;
      }

      // ── HTML PRINCIPAL ──
      const servicios = await fetchServicios(env);
      const html = buildHTML(servicios, env);
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=' + CACHE_HTML,
          'X-Content-Type-Options': 'nosniff'
        }
      });

    } catch (err) {
      return new Response('Error: ' + err.message, { status: 500 });
    }
  }
};

// ── API: SERVICIOS ──────────────────────────────────────────────────────────
async function getServicios(env, cors) {
  const data = await fetchServicios(env);
  return new Response(JSON.stringify(data), {
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }, cors)
  });
}

async function fetchServicios(env) {
  try {
    if (env.EDWIN_DATA) {
      const obj = await env.EDWIN_DATA.get('servicios.json');
      if (obj) return JSON.parse(await obj.text());
    }
  } catch (_) {}
  return DEFAULT_SERVICIOS;
}

// ── API: HORARIOS ───────────────────────────────────────────────────────────
async function getHorarios(env, cors) {
  let data = DEFAULT_HORARIOS;
  try {
    if (env.EDWIN_DATA) {
      const obj = await env.EDWIN_DATA.get('horarios.json');
      if (obj) data = JSON.parse(await obj.text());
    }
  } catch (_) {}
  return new Response(JSON.stringify(data), {
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }, cors)
  });
}

// ── API: GALERÍA ────────────────────────────────────────────────────────────
async function getGaleria(env, cors) {
  const items = [];
  try {
    if (env.EDWIN_MEDIA) {
      const list = await env.EDWIN_MEDIA.list({ prefix: 'gallery/' });
      for (const obj of list.objects) {
        items.push({ key: obj.key, size: obj.size, uploaded: obj.uploaded });
      }
    }
  } catch (_) {}
  return new Response(JSON.stringify({ items, total: items.length }), {
    headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
  });
}

// ── IMAGEN DESDE R2 (Opción A: R2 puro) ────────────────────────────────────
async function serveImage(url, env) {
  const key = decodeURIComponent(url.pathname.replace('/img/', ''));
  try {
    const obj = await env.EDWIN_MEDIA.get(key);
    if (!obj) return new Response('Imagen no encontrada', { status: 404 });
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata.contentType || guessContentType(key),
        'Cache-Control': 'public, max-age=' + CACHE_ASSETS + ', immutable',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
}

// ── ADMIN: IMPORTAR IMAGEN DESDE URL ───────────────────────────────────────
async function adminImportUrl(request, env) {
  const { url, key } = await request.json();
  if (!url || !key) return new Response('Faltan url y key', { status: 400 });
  try {
    const img  = await fetch(url);
    const blob = await img.arrayBuffer();
    const ct   = img.headers.get('Content-Type') || 'image/jpeg';
    await env.EDWIN_MEDIA.put(key, blob, { httpMetadata: { contentType: ct } });
    return new Response(JSON.stringify({ ok: true, key }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── ADMIN: SUBIDA DIRECTA ───────────────────────────────────────────────────
async function adminUpload(request, env) {
  const formData = await request.formData();
  const file     = formData.get('file');
  const key      = formData.get('key') || ('gallery/' + Date.now() + '.jpg');
  if (!file) return new Response('Falta archivo', { status: 400 });
  try {
    await env.EDWIN_MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'image/jpeg' }
    });
    return new Response(JSON.stringify({ ok: true, key }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── ASSET ESTÁTICO DESDE R2 ─────────────────────────────────────────────────
async function serveR2Asset(path, env) {
  try {
    if (!env.EDWIN_ASSETS) return null;
    const key = path.startsWith('/') ? path.slice(1) : path;
    const obj = await env.EDWIN_ASSETS.get(key);
    if (!obj) return null;
    const ct  = obj.httpMetadata.contentType || guessContentType(path);
    const ttl = ct.includes('font') || ct.includes('javascript') || ct.includes('css')
      ? CACHE_ASSETS : CACHE_MEDIA;
    return new Response(obj.body, {
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=' + ttl,
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (_) {
    return null;
  }
}

function guessContentType(path) {
  if (path.endsWith('.css'))   return 'text/css';
  if (path.endsWith('.js'))    return 'application/javascript';
  if (path.endsWith('.woff2')) return 'font/woff2';
  if (path.endsWith('.png'))   return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.svg'))   return 'image/svg+xml';
  if (path.endsWith('.webp'))  return 'image/webp';
  return 'application/octet-stream';
}


// ── ADMIN PANEL HTML ────────────────────────────────────────────────────────
function serveAdminPanel() {
  var html = '<!DOCTYPE html>' +
    '<html lang="es"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Admin — Edwin Fox Barber Style</title>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Arial,sans-serif;background:#0A0A0A;color:#fff;min-height:100vh}' +
    'header{background:#111;border-bottom:1px solid #D4AF37;padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between}' +
    '.logo{color:#D4AF37;font-size:1.1rem;font-weight:bold;letter-spacing:.08em}' +
    '.badge{background:#D4AF37;color:#0A0A0A;padding:4px 12px;border-radius:20px;font-size:.7rem;font-weight:bold}' +
    'main{max-width:900px;margin:2rem auto;padding:0 1.5rem;display:grid;gap:1.5rem}' +
    '.card{background:#111;border:1px solid rgba(212,175,55,.2);border-radius:8px;padding:1.5rem}' +
    '.card h2{color:#D4AF37;font-size:.85rem;letter-spacing:.2em;text-transform:uppercase;margin-bottom:1.2rem}' +
    'input,select{width:100%;background:#1A1A1A;border:1px solid rgba(212,175,55,.3);color:#fff;padding:.7rem 1rem;font-size:.85rem;margin-bottom:.8rem;outline:none}' +
    'input:focus,select:focus{border-color:#D4AF37}' +
    'button{background:#D4AF37;color:#0A0A0A;border:none;padding:.75rem 1.5rem;font-size:.78rem;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:opacity .2s}' +
    'button:hover{opacity:.85}' +
    'button.sec{background:transparent;color:#D4AF37;border:1px solid #D4AF37}' +
    '.msg{padding:.6rem 1rem;border-radius:4px;font-size:.8rem;margin-top:.8rem;display:none}' +
    '.msg.ok{display:block;background:rgba(212,175,55,.1);border:1px solid #D4AF37;color:#D4AF37}' +
    '.msg.err{display:block;background:rgba(220,50,50,.1);border:1px solid #E24B4A;color:#E24B4A}' +
    '.gallery-preview{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:.5rem;margin-top:1rem}' +
    '.gallery-preview img{width:100%;aspect-ratio:1;object-fit:cover;border:1px solid rgba(212,175,55,.2)}' +
    '.api-list{display:flex;flex-direction:column;gap:.5rem}' +
    '.api-item{background:#1A1A1A;padding:.6rem 1rem;border-left:2px solid #D4AF37;font-size:.78rem;color:#aaa;display:flex;justify-content:space-between}' +
    '.api-item span{color:#D4AF37;font-family:monospace}' +
    '</style>' +
    '</head><body>' +
    '<header>' +
    '<span class="logo">EDWIN FOX — ADMIN</span>' +
    '<span class="badge">✅ Zero Trust Activo</span>' +
    '</header>' +
    '<main>' +

    // SUBIDA DE IMAGEN
    '<div class="card">' +
    '<h2>📷 Subir imagen a galería</h2>' +
    '<input type="file" id="img-file" accept="image/*">' +
    '<input type="text" id="img-key" placeholder="Nombre archivo (ej: gallery/foto1.jpg)">' +
    '<button onclick="uploadImg()">Subir imagen</button>' +
    '<div class="msg" id="msg-upload"></div>' +
    '<div class="gallery-preview" id="gallery-preview"></div>' +
    '</div>' +

    // IMPORTAR DESDE URL
    '<div class="card">' +
    '<h2>🔗 Importar imagen desde URL</h2>' +
    '<input type="text" id="import-url" placeholder="https://ejemplo.com/foto.jpg">' +
    '<input type="text" id="import-key" placeholder="Nombre destino (ej: gallery/foto-importada.jpg)">' +
    '<button onclick="importUrl()">Importar</button>' +
    '<div class="msg" id="msg-import"></div>' +
    '</div>' +

    // GALERÍA ACTUAL
    '<div class="card">' +
    '<h2>🖼️ Galería actual (R2 edwin-media)</h2>' +
    '<button class="sec" onclick="loadGallery()">Cargar galería</button>' +
    '<div class="gallery-preview" id="admin-gallery"></div>' +
    '</div>' +

    // API STATUS
    '<div class="card">' +
    '<h2>⚙️ Estado de endpoints</h2>' +
    '<div class="api-list">' +
    '<div class="api-item"><span>GET /api/servicios</span><button class="sec" style="padding:2px 10px;font-size:.7rem" onclick="testApi(\'/api/servicios\',\'api-svc\')">Test</button></div>' +
    '<div class="api-item"><span>GET /api/horarios</span><button class="sec" style="padding:2px 10px;font-size:.7rem" onclick="testApi(\'/api/horarios\',\'api-hor\')">Test</button></div>' +
    '<div class="api-item"><span>GET /api/galeria</span><button class="sec" style="padding:2px 10px;font-size:.7rem" onclick="testApi(\'/api/galeria\',\'api-gal\')">Test</button></div>' +
    '</div>' +
    '<pre id="api-svc" style="margin-top:.8rem;font-size:.7rem;color:#aaa;display:none"></pre>' +
    '<pre id="api-hor" style="margin-top:.4rem;font-size:.7rem;color:#aaa;display:none"></pre>' +
    '<pre id="api-gal" style="margin-top:.4rem;font-size:.7rem;color:#aaa;display:none"></pre>' +
    '</div>' +
    '</main>' +

    '<script>' +
    'async function uploadImg(){' +
    'var f=document.getElementById("img-file").files[0];' +
    'var k=document.getElementById("img-key").value||("gallery/"+Date.now()+".jpg");' +
    'var m=document.getElementById("msg-upload");' +
    'if(!f){m.className="msg err";m.textContent="Selecciona un archivo";return}' +
    'var fd=new FormData();fd.append("file",f);fd.append("key",k);' +
    'try{' +
    'var r=await fetch("/admin/upload",{method:"POST",body:fd});' +
    'var d=await r.json();' +
    'if(d.ok){m.className="msg ok";m.textContent="✅ Subida: "+d.key}' +
    'else{m.className="msg err";m.textContent="Error: "+d.error}' +
    '}catch(e){m.className="msg err";m.textContent="Error: "+e.message}' +
    '}' +
    'async function importUrl(){' +
    'var url=document.getElementById("import-url").value.trim();' +
    'var key=document.getElementById("import-key").value.trim();' +
    'var m=document.getElementById("msg-import");' +
    'if(!url||!key){m.className="msg err";m.textContent="URL y nombre requeridos";return}' +
    'try{' +
    'var r=await fetch("/admin/import-url",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url,key})});' +
    'var d=await r.json();' +
    'if(d.ok){m.className="msg ok";m.textContent="✅ Importado: "+d.key}' +
    'else{m.className="msg err";m.textContent="Error: "+d.error}' +
    '}catch(e){m.className="msg err";m.textContent="Error: "+e.message}' +
    '}' +
    'async function loadGallery(){' +
    'var g=document.getElementById("admin-gallery");' +
    'g.innerHTML="Cargando...";' +
    'try{' +
    'var r=await fetch("/api/galeria");var d=await r.json();' +
    'if(!d.items||d.items.length===0){g.innerHTML="<p style=\"color:#666;font-size:.8rem\">Sin imágenes en R2 aún.</p>";return}' +
    'g.innerHTML="";' +
    'd.items.forEach(function(item){' +
    'var img=document.createElement("img");' +
    'img.src="/img/"+item.key;img.alt=item.key;img.loading="lazy";' +
    'g.appendChild(img)});' +
    '}catch(e){g.innerHTML="<p style=\"color:#E24B4A\">Error: "+e.message+"</p>"}' +
    '}' +
    'async function testApi(path,elId){' +
    'var el=document.getElementById(elId);' +
    'el.style.display="block";el.textContent="Cargando...";' +
    'try{var r=await fetch(path);var d=await r.json();el.textContent=JSON.stringify(d,null,2)}' +
    'catch(e){el.textContent="Error: "+e.message}' +
    '}' +
    '</script>' +
    '</body></html>';
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' }
  });
}

// ── HTML BUILDER ────────────────────────────────────────────────────────────
function buildHTML(servicios) {
  const optsServicios = servicios.map(function(s) {
    return '<option value="' + s.nombre + '">' + s.nombre + ' — $' + s.precio.toLocaleString('es-CL') + '</option>';
  }).join('');

  const head = '<!DOCTYPE html>' +
    '<html lang="es">' +
    '<head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Edwin Fox Barber Style | Barbería Maipú, Santiago</title>' +
    '<meta name="description" content="Barbería de alto estándar en Maipú, Santiago. Cortes, barba y estilo. Reserva tu hora.">' +
    '<meta name="robots" content="index, follow">' +
    '<link rel="canonical" href="https://edwinfoxbarberstyle.com/">' +
    '<meta property="og:title" content="Edwin Fox Barber Style">' +
    '<meta property="og:description" content="Barbería de alto estándar en Maipú, Santiago.">' +
    '<meta property="og:url" content="https://edwinfoxbarberstyle.com">' +
    '<meta property="og:image" content="https://edwinfoxbarberstyle.com/og-image.jpg">' +
    '<meta property="og:type" content="website">' +
    '<meta property="og:locale" content="es_CL">' +
    '<meta http-equiv="X-Content-Type-Options" content="nosniff">' +
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"HairSalon","name":"Edwin Fox Barber Style","telephone":"+56986505521","address":{"@type":"PostalAddress","addressLocality":"Maipú","addressRegion":"Región Metropolitana","addressCountry":"CL"},"url":"https://edwinfoxbarberstyle.com"}</script>' +
    '<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({"gtm.start":new Date().getTime(),event:"gtm.js"});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!="dataLayer"?"&l="+l:"";j.async=true;j.src="https://www.googletagmanager.com/gtm.js?id="+i+dl;f.parentNode.insertBefore(j,f);})(window,document,"script","dataLayer","GTM-KFKP424L");</script>' +
    '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ZV8NH5X4G1"></script>' +
    '<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","G-ZV8NH5X4G1",{"anonymize_ip":true});</script>' +
    '<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");fbq("init","1225408969456443");fbq("track","PageView");</script>' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    
    '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">';

  const css = '<style>' +
    ':root{--bg:#0A0A0A;--s1:#111;--s2:#1A1A1A;--gold:#D4AF37;--gold2:#8B6914;--text:#FFFFFF;--muted:#888;--b:rgba(212,175,55,.12);--b2:rgba(212,175,55,.3);--serif:"Playfair Display",Georgia,serif;--sans:"Inter",system-ui,sans-serif}' +
    '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}' +
    'html{scroll-behavior:smooth}' +
    'body{background:var(--bg);color:var(--text);font-family:var(--sans);font-weight:300;line-height:1.7;overflow-x:hidden}' +
    'a{color:inherit;text-decoration:none}' +

    // NAV
    'nav{position:fixed;top:0;left:0;right:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:1.1rem 2.5rem;transition:all .4s}' +
    'nav.sc{background:rgba(10,10,10,.96);backdrop-filter:blur(12px);border-bottom:.5px solid var(--b2)}' +
    '.nav-logo{display:flex;align-items:center;gap:.7rem}' +
    '.nav-mono{width:32px;height:32px;border-radius:50%;border:.5px solid var(--gold2);display:flex;align-items:center;justify-content:center;font-family:var(--serif);font-size:12px;color:var(--gold)}' +
    '.nav-name{font-family:var(--serif);font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--text)}' +
    '.nav-links{display:flex;gap:2rem;list-style:none}' +
    '.nav-links a{font-size:.68rem;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);transition:color .3s}' +
    '.nav-links a:hover{color:var(--gold)}' +
    '.nav-cta{font-size:.68rem;letter-spacing:.15em;text-transform:uppercase;color:var(--bg);background:var(--gold);padding:.5rem 1.3rem;transition:opacity .3s}' +
    '.nav-cta:hover{opacity:.85}' +

    // HERO
    '.hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6rem 2rem 4rem;text-align:center;border-bottom:.5px solid var(--b)}' +
    '.hero-ey{font-size:.62rem;letter-spacing:.4em;text-transform:uppercase;color:var(--gold);margin-bottom:2rem;opacity:0;animation:fu .8s .3s forwards}' +
    '.hero-the{font-family:var(--serif);font-size:clamp(1.2rem,3vw,2rem);font-style:italic;color:rgba(255,255,255,.25);line-height:1;opacity:0;animation:fu .8s .5s forwards}' +
    '.hero-main{font-family:var(--serif);font-size:clamp(5rem,14vw,11rem);font-weight:700;line-height:.88;letter-spacing:-.02em;color:var(--text);opacity:0;animation:fu .9s .7s forwards}' +
    '.hero-line{width:40px;height:.5px;background:var(--gold);margin:2rem auto;opacity:0;animation:fu .8s .9s forwards}' +
    '.hero-sub{font-size:.8rem;color:var(--muted);margin-bottom:2.5rem;opacity:0;animation:fu .8s 1s forwards}' +
    '.hero-acts{display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap;justify-content:center;opacity:0;animation:fu .8s 1.1s forwards}' +
    '.btn-p{font-size:.68rem;letter-spacing:.2em;text-transform:uppercase;color:var(--bg);background:var(--gold);padding:.9rem 2rem;transition:opacity .3s,transform .3s;display:inline-block;font-weight:500}' +
    '.btn-p:hover{opacity:.85;transform:translateY(-1px)}' +
    '.btn-s{font-size:.68rem;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);border-bottom:.5px solid var(--b2);padding-bottom:2px;transition:color .3s}' +
    '.btn-s:hover{color:var(--gold)}' +
    '.btn-outline{font-size:.68rem;letter-spacing:.15em;text-transform:uppercase;color:var(--gold);border:.5px solid var(--b2);padding:.8rem 1.6rem;transition:all .3s;display:inline-block}' +
    '.btn-outline:hover{background:var(--gold);color:var(--bg)}' +

    // STATS
    '.stats{display:grid;grid-template-columns:repeat(4,1fr);border-top:.5px solid var(--b);border-bottom:.5px solid var(--b)}' +
    '.stat{text-align:center;padding:2rem 1rem;border-right:.5px solid var(--b)}' +
    '.stat:last-child{border-right:none}' +
    '.stat-n{font-family:var(--serif);font-size:2.4rem;font-weight:400;color:var(--gold);line-height:1}' +
    '.stat-l{font-size:.6rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-top:.4rem}' +

    // SECTIONS
    '.inner{max-width:1000px;margin:0 auto;padding:0 2.5rem}' +
    '.sec-label{font-size:.6rem;letter-spacing:.35em;text-transform:uppercase;color:var(--gold);margin-bottom:.8rem}' +
    '.sec-title{font-family:var(--serif);font-size:clamp(1.8rem,4vw,2.8rem);font-weight:400;line-height:1.1;margin-bottom:1.5rem;color:var(--text)}' +
    '.sec-title em{font-style:italic;color:var(--gold)}' +

    // SERVICES
    '.services{padding:6rem 0;border-bottom:.5px solid var(--b)}' +
    '.svc-hdr{text-align:center;margin-bottom:3.5rem}' +
    '.svc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.5px;background:var(--b)}' +
    '.svc-card{background:var(--bg);padding:2rem 1.6rem;transition:background .3s;cursor:default}' +
    '.svc-card:hover{background:var(--s1)}' +
    '.svc-sym{font-size:1.1rem;color:var(--gold);margin-bottom:1rem;opacity:.6}' +
    '.svc-name{font-family:var(--serif);font-size:1.1rem;color:var(--text);margin-bottom:.4rem}' +
    '.svc-desc{font-size:.78rem;color:var(--muted);line-height:1.8;margin-bottom:1rem}' +
    '.svc-price{font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold)}' +

    // GALLERY
    '.gallery{padding:6rem 0;border-bottom:.5px solid var(--b)}' +
    '.gallery-hdr{text-align:center;margin-bottom:3rem}' +
    '.gallery-grid{columns:2;column-gap:6px;margin-bottom:2.5rem}' +
    '.gallery-item{break-inside:avoid;margin-bottom:6px;cursor:pointer;position:relative;overflow:hidden;display:block}' +
    '.gallery-item img{width:100%;display:block;transition:transform .4s}' +
    '.gallery-item:hover img{transform:scale(1.03)}' +
    '.gallery-item::after{content:"";position:absolute;inset:0;background:rgba(212,175,55,.08);opacity:0;transition:opacity .3s}' +
    '.gallery-item:hover::after{opacity:1}' +
    '.gallery-empty{text-align:center;padding:3rem;color:var(--muted);font-size:.85rem;border:.5px solid var(--b);font-style:italic}' +

    // LIGHTBOX
    '.lb{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;align-items:center;justify-content:center;padding:1rem}' +
    '.lb.open{display:flex}' +
    '.lb-img{max-width:90vw;max-height:90vh;object-fit:contain}' +
    '.lb-close{position:fixed;top:1.5rem;right:1.5rem;background:none;border:.5px solid var(--b2);color:var(--gold);width:36px;height:36px;font-size:1.2rem;cursor:pointer;display:flex;align-items:center;justify-content:center}' +

    // BOOKING FORM
    '.booking{padding:6rem 0;background:var(--s1);border-bottom:.5px solid var(--b)}' +
    '.booking-inner{display:grid;grid-template-columns:1fr 1fr;gap:5rem;align-items:start}' +
    '.book-form{display:flex;flex-direction:column;gap:.8rem}' +
    '.form-group{display:flex;flex-direction:column;gap:.4rem}' +
    '.form-label{font-size:.65rem;letter-spacing:.2em;text-transform:uppercase;color:var(--gold)}' +
    'input[type=text],input[type=tel],input[type=date],input[type=time],select{background:var(--s2);border:.5px solid var(--b2);color:var(--text);padding:.7rem 1rem;font-family:var(--sans);font-size:.85rem;font-weight:300;outline:none;transition:border-color .3s;-webkit-appearance:none}' +
    'input[type=text]:focus,input[type=tel]:focus,input[type=date]:focus,input[type=time]:focus,select:focus{border-color:var(--gold)}' +
    'select option{background:var(--s2)}' +
    '.form-error{font-size:.72rem;color:#E24B4A;margin-top:2px;display:none}' +
    '.form-error.show{display:block}' +
    '.form-msg{padding:.7rem 1rem;font-size:.78rem;border-radius:2px;margin-top:.5rem;display:none}' +
    '.form-msg.info{display:block;border:.5px solid var(--b2);color:var(--gold);background:rgba(212,175,55,.06)}' +

    // REVIEWS
    '.reviews{padding:6rem 0;border-bottom:.5px solid var(--b)}' +
    '.rev-hdr{display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:1.5rem;margin-bottom:3rem}' +
    '.rev-rating{display:flex;align-items:center;gap:.6rem}' +
    '.rev-big{font-family:var(--serif);font-size:2.2rem;font-weight:400;color:var(--gold);line-height:1}' +
    '.rev-stars{color:#F5C518;font-size:.85rem;letter-spacing:.05em}' +
    '.rev-lbl{font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:2px}' +
    '.rev-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--b)}' +
    '.rev-card{background:var(--bg);padding:1.8rem 1.5rem;border-bottom:.5px solid var(--b)}' +
    '.rev-top{display:flex;align-items:center;gap:.8rem;margin-bottom:.8rem}' +
    '.rev-av{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--gold2),#6B1F10);display:flex;align-items:center;justify-content:center;font-family:var(--serif);font-size:.9rem;color:var(--text);flex-shrink:0}' +
    '.rev-name{font-size:.84rem;font-weight:500;color:var(--text)}' +
    '.rev-date{font-size:.7rem;color:var(--muted)}' +
    '.rev-s{color:#F5C518;font-size:.8rem;margin-bottom:.6rem}' +
    '.rev-txt{font-size:.8rem;color:var(--muted);line-height:1.8;font-style:italic}' +
    '.rev-cta{display:flex;align-items:center;justify-content:center;gap:1.5rem;flex-wrap:wrap;margin-top:3rem}' +

    // LOCATION
    '.location{padding:6rem 0;background:var(--s1);border-bottom:.5px solid var(--b)}' +
    '.loc-grid{display:grid;grid-template-columns:1fr 1fr;gap:5rem;align-items:start}' +
    '.loc-item{margin-bottom:1.6rem}' +
    '.loc-lbl{font-size:.6rem;letter-spacing:.25em;text-transform:uppercase;color:var(--gold);margin-bottom:.3rem}' +
    '.loc-val{font-size:.86rem;color:var(--muted);line-height:1.7}' +
    '.loc-val a{color:var(--muted);transition:color .3s}' +
    '.loc-val a:hover{color:var(--gold)}' +
    '.loc-map{background:var(--s2);border:.5px solid var(--b2);height:240px;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem}' +

    // FOOTER
    '.social-bar{padding:2.5rem 0;text-align:center;border-bottom:.5px solid var(--b)}' +
    '.soc-lbl{font-size:.6rem;letter-spacing:.3em;text-transform:uppercase;color:var(--muted);margin-bottom:1.2rem}' +
    '.soc-links{display:flex;align-items:center;justify-content:center;gap:3rem;flex-wrap:wrap}' +
    '.soc-link{font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);transition:color .3s}' +
    '.soc-link:hover{color:var(--gold)}' +
    'footer{padding:2rem 2.5rem;background:var(--s1);display:flex;align-items:center;justify-content:space-between;border-top:.5px solid var(--b)}' +
    '.ft-logo{font-family:var(--serif);font-size:.95rem;color:var(--muted)}' +
    '.ft-copy{font-size:.62rem;color:var(--muted);opacity:.4}' +
    '.ft-loc{font-size:.65rem;color:var(--muted);opacity:.5;text-align:right}' +

    // FLOATS
    '.floats{position:fixed;bottom:1.8rem;right:1.8rem;z-index:200;display:flex;flex-direction:column;gap:.6rem}' +
    '.fl-btn{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;text-decoration:none;transition:transform .3s}' +
    '.fl-btn:hover{transform:scale(1.08)}' +
    '.fl-wa{background:#1FAD52;box-shadow:0 4px 18px rgba(31,173,82,.3)}' +
    '.fl-ig{background:linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888);box-shadow:0 4px 18px rgba(220,39,67,.25)}' +
    '.fl-btn svg{width:22px;height:22px;color:#fff}' +

    // REVEAL + ANIMATIONS
    '.rv{opacity:0;transform:translateY(16px);transition:opacity .7s,transform .7s}' +
    '.rv.on{opacity:1;transform:none}' +
    '@keyframes fu{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}' +

    // MOBILE
    '@media(max-width:768px){' +
    'nav{padding:1rem 1.2rem}.nav-links{display:none}' +
    '.inner{padding:0 1.2rem}' +
    '.stats{grid-template-columns:repeat(2,1fr)}.stat:nth-child(2){border-right:none}' +
    '.svc-grid{grid-template-columns:1fr}' +
    '.gallery-grid{columns:2}' +
    '.booking-inner,.loc-grid{grid-template-columns:1fr;gap:2.5rem}' +
    '.rev-grid{grid-template-columns:1fr}' +
    '.rev-hdr,.rev-cta{flex-direction:column;align-items:center;gap:1rem}' +
    'footer{flex-direction:column;gap:.6rem;text-align:center}.ft-loc{text-align:center}' +
    '}' +
    '@media(min-width:769px){.gallery-grid{columns:3}}' +
    '</style>';

  const body = '<body>' +
    '<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-KFKP424L" height="0" width="0" style="display:none;visibility:hidden" title="GTM"></iframe></noscript>' +

    // NAV
    '<nav id="nav">' +
    '<a href="#" class="nav-logo"><div class="nav-mono">EF</div><span class="nav-name">Edwin Fox</span></a>' +
    '<ul class="nav-links"><li><a href="#servicios">Servicios</a></li><li><a href="#galeria">Galería</a></li><li><a href="#reservas">Reservas</a></li><li><a href="#resenas">Reseñas</a></li><li><a href="#ubicacion">Ubicación</a></li></ul>' +
    '<a href="https://wa.me/' + WA_NUMBER + '?text=Hola%2C%20quiero%20reservar" class="nav-cta" target="_blank" rel="noopener">Reservar</a>' +
    '</nav>' +

    // HERO
    '<section class="hero">' +
    '<p class="hero-ey">Est. Maipú · Santiago · Chile</p>' +
    '<p class="hero-the">The</p>' +
    '<h1 class="hero-main">Barber</h1>' +
    '<div class="hero-line"></div>' +
    '<p class="hero-sub">Edwin Fox Barber Style — Modern Heritage · Alto estándar</p>' +
    '<div class="hero-acts">' +
    '<a href="#reservas" class="btn-p">Reservar ahora</a>' +
    '<a href="' + SETMORE_URL + '" class="btn-s" target="_blank" rel="noopener">Reserva online →</a>' +
    '</div>' +
    '</section>' +

    // STATS
    '<div class="stats rv"><div class="stat"><div class="stat-n">13</div><div class="stat-l">Servicios</div></div><div class="stat"><div class="stat-n">5★</div><div class="stat-l">Google</div></div><div class="stat"><div class="stat-n">2</div><div class="stat-l">Especialistas</div></div><div class="stat"><div class="stat-n">VIP</div><div class="stat-l">Paquete</div></div></div>' +

    // SERVICES
    '<section class="services" id="servicios"><div class="inner">' +
    '<div class="svc-hdr rv"><p class="sec-label">Servicios</p><h2 class="sec-title">Cada servicio, una <em>intención</em></h2></div>' +
    '<div class="svc-grid">' +
    servicios.map(function(s) {
      return '<div class="svc-card rv"><div class="svc-sym">◈</div><h3 class="svc-name">' + s.nombre + '</h3><p class="svc-desc">' + s.descripcion + '</p><span class="svc-price">$' + s.precio.toLocaleString('es-CL') + '</span></div>';
    }).join('') +
    '</div></div></section>' +

    // GALLERY
    '<section class="gallery" id="galeria"><div class="inner">' +
    '<div class="gallery-hdr rv"><p class="sec-label">Galería</p><h2 class="sec-title">Nuestro <em>trabajo</em></h2></div>' +
    '<div class="gallery-grid" id="gallery-grid">' +
    '<div class="gallery-empty">Las fotos del estudio se cargan aquí.<br>Sube imágenes vía /admin/upload</div>' +
    '</div>' +
    '<div style="text-align:center"><a href="' + INSTAGRAM_URL + '" class="btn-outline" target="_blank" rel="noopener">Ver más en Instagram →</a></div>' +
    '</div></section>' +

    // LIGHTBOX
    '<div class="lb" id="lightbox" role="dialog" aria-modal="true" aria-label="Imagen ampliada">' +
    '<button class="lb-close" id="lb-close" aria-label="Cerrar">×</button>' +
    '<img class="lb-img" id="lb-img" src="" alt="Foto del estudio">' +
    '</div>' +

    // BOOKING
    '<section class="booking" id="reservas"><div class="inner">' +
    '<div class="booking-inner">' +
    '<div class="rv">' +
    '<p class="sec-label">¿Listo?</p>' +
    '<h2 class="sec-title">Reserva tu <em>hora</em></h2>' +
    '<p style="font-size:.84rem;color:var(--muted);margin-bottom:1.5rem">Completa el formulario y te enviamos el link de confirmación por WhatsApp.</p>' +
    '<p style="font-size:.78rem;color:var(--muted);margin-bottom:.5rem">O reserva directamente:</p>' +
    '<div style="display:flex;flex-direction:column;gap:.7rem;margin-top:.5rem">' +
    '<a href="https://wa.me/' + WA_NUMBER + '?text=Hola%2C%20quiero%20reservar" class="btn-p" target="_blank" rel="noopener">WhatsApp directo</a>' +
    '<a href="' + SETMORE_URL + '" class="btn-outline" target="_blank" rel="noopener">Reserva online — J. Márquez</a>' +
    '</div>' +
    '</div>' +
    '<form class="book-form rv" id="booking-form" novalidate>' +
    '<div class="form-group">' +
    '<label class="form-label" for="b-nombre">Nombre completo</label>' +
    '<input type="text" id="b-nombre" placeholder="Tu nombre" required>' +
    '<span class="form-error" id="err-nombre">Por favor ingresa tu nombre</span>' +
    '</div>' +
    '<div class="form-group">' +
    '<label class="form-label" for="b-tel">Teléfono</label>' +
    '<input type="tel" id="b-tel" placeholder="+56 9 XXXX XXXX" required>' +
    '<span class="form-error" id="err-tel">Por favor ingresa tu teléfono</span>' +
    '</div>' +
    '<div class="form-group">' +
    '<label class="form-label" for="b-svc">Servicio</label>' +
    '<select id="b-svc" required><option value="">Selecciona un servicio</option>' + optsServicios + '</select>' +
    '<span class="form-error" id="err-svc">Selecciona un servicio</span>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.8rem">' +
    '<div class="form-group">' +
    '<label class="form-label" for="b-fecha">Fecha</label>' +
    '<input type="date" id="b-fecha" required>' +
    '<span class="form-error" id="err-fecha">Fecha no válida</span>' +
    '</div>' +
    '<div class="form-group">' +
    '<label class="form-label" for="b-hora">Hora</label>' +
    '<input type="time" id="b-hora" min="10:00" max="19:00" required>' +
    '<span class="form-error" id="err-hora">Horario: 10:00–19:00</span>' +
    '</div>' +
    '</div>' +
    '<div class="form-msg" id="form-preview"></div>' +
    '<button type="submit" class="btn-p" style="width:100%;text-align:center;border:none;cursor:pointer;margin-top:.5rem">Confirmar por WhatsApp</button>' +
    '</form>' +
    '</div>' +
    '</div></section>' +

    // REVIEWS
    '<section class="reviews" id="resenas"><div class="inner">' +
    '<div class="rev-hdr">' +
    '<div class="rv"><p class="sec-label">Lo que dicen</p><h2 class="sec-title">Reseñas <em>reales</em></h2></div>' +
    '<div class="rev-rating rv"><div class="rev-big">5.0</div><div><div class="rev-stars">★★★★★</div><div class="rev-lbl">Google Reviews</div></div></div>' +
    '</div>' +
    '<div class="rev-grid">' +
    '<div class="rev-card rv"><div class="rev-top"><div class="rev-av">C</div><div><p class="rev-name">Carlos M.</p><p class="rev-date">Hace 2 semanas</p></div></div><div class="rev-s">★★★★★</div><p class="rev-txt">"Excelente servicio. Edwin tiene un ojo increíble para lo que le queda bien a cada persona."</p></div>' +
    '<div class="rev-card rv"><div class="rev-top"><div class="rev-av">A</div><div><p class="rev-name">Alejandro R.</p><p class="rev-date">Hace 1 mes</p></div></div><div class="rev-s">★★★★★</div><p class="rev-txt">"El mejor corte que he tenido en Maipú. Ambiente profesional y resultado impecable."</p></div>' +
    '<div class="rev-card rv"><div class="rev-top"><div class="rev-av">M</div><div><p class="rev-name">Marcelo T.</p><p class="rev-date">Hace 3 semanas</p></div></div><div class="rev-s">★★★★★</div><p class="rev-txt">"Vine por el corte y salí con corte y barba. La atención es otra categoría."</p></div>' +
    '</div>' +
    '<div class="rev-cta rv">' +
    '<a href="' + GOOGLE_MAPS + '" class="btn-p" target="_blank" rel="noopener">Deja tu reseña en Google</a>' +
    '<a href="' + GOOGLE_MAPS + '" class="btn-s" target="_blank" rel="noopener">Ver perfil en Google →</a>' +
    '</div>' +
    '</div></section>' +

    // LOCATION
    '<section class="location" id="ubicacion"><div class="inner">' +
    '<div class="loc-grid">' +
    '<div class="rv"><p class="sec-label">Dónde encontrarnos</p><h2 class="sec-title">Maipú, <em>Santiago</em></h2>' +
    '<div class="loc-item"><p class="loc-lbl">Estudio</p><p class="loc-val">J. Márquez Barber Shop<br>Maipú, Región Metropolitana</p></div>' +
    '<div class="loc-item"><p class="loc-lbl">Contacto</p><p class="loc-val"><a href="https://wa.me/' + WA_NUMBER + '" target="_blank">+56 9 8650 5521</a><br><a href="mailto:hola@edwinfoxbarberstyle.com">hola@edwinfoxbarberstyle.com</a></p></div>' +
    '<div class="loc-item"><p class="loc-lbl">Horario</p><p class="loc-val">Lun–Sáb · 10:00–20:00<br>Domingo cerrado</p></div>' +
    '<div class="loc-item"><p class="loc-lbl">Reserva online</p><p class="loc-val"><a href="' + SETMORE_URL + '" target="_blank" rel="noopener" style="color:var(--gold)">' + SETMORE_URL.replace('https://', '') + ' →</a></p></div>' +
    '</div>' +
    '<div class="loc-map rv" style="flex-direction:column;gap:.8rem">' +
    '<p style="font-family:var(--serif);font-style:italic;color:var(--text)">J. Márquez Barber Shop</p>' +
    '<p style="font-size:.8rem;color:var(--muted)">Maipú, Santiago</p>' +
    '<a href="' + GOOGLE_MAPS + '" style="font-size:.68rem;letter-spacing:.15em;text-transform:uppercase;color:var(--gold);border-bottom:.5px solid var(--b2);padding-bottom:1px" target="_blank" rel="noopener">Ver en Google Maps →</a>' +
    '</div>' +
    '</div>' +
    '</div></section>' +

    // SOCIAL BAR
    '<div class="social-bar">' +
    '<p class="soc-lbl">Síguenos</p>' +
    '<div class="soc-links">' +
    '<a href="' + INSTAGRAM_URL + '" class="soc-link" target="_blank" rel="noopener">Instagram @edwinfoxbarberstyle</a>' +
    '<a href="https://wa.me/' + WA_NUMBER + '" class="soc-link" target="_blank">WhatsApp +56 9 8650 5521</a>' +
    '<a href="mailto:hola@edwinfoxbarberstyle.com" class="soc-link">hola@edwinfoxbarberstyle.com</a>' +
    '</div>' +
    '</div>' +

    // FOOTER
    '<footer><span class="ft-logo">Edwin Fox Barber Style</span><span class="ft-copy">© 2026</span><span class="ft-loc">Maipú · Santiago · Chile</span></footer>' +

    // FLOATS
    '<div class="floats">' +
    '<a href="' + INSTAGRAM_URL + '" class="fl-btn fl-ig" target="_blank" rel="noopener" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg></a>' +
    '<a href="https://wa.me/' + WA_NUMBER + '?text=Hola%2C%20quiero%20reservar" class="fl-btn fl-wa" target="_blank" rel="noopener" aria-label="WhatsApp"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></a>' +
    '</div>';

  const js = '<script>' +
    // Nav scroll
    'var nav=document.getElementById("nav");' +
    'window.addEventListener("scroll",function(){nav.classList.toggle("sc",scrollY>40)});' +

    // Scroll reveal
    'var obs=new IntersectionObserver(function(e){e.forEach(function(el,i){if(el.isIntersecting){setTimeout(function(){el.target.classList.add("on")},i*60);obs.unobserve(el.target)}})},{threshold:.1});' +
    'document.querySelectorAll(".rv").forEach(function(el){obs.observe(el)});' +

    // Gallery loader
    'async function loadGallery(){' +
    'try{' +
    'var r=await fetch("/api/galeria");' +
    'var d=await r.json();' +
    'var g=document.getElementById("gallery-grid");' +
    'if(!d.items||d.items.length===0)return;' +
    'g.innerHTML="";' +
    'd.items.forEach(function(item){' +
    'var a=document.createElement("a");' +
    'a.className="gallery-item";' +
    'a.href="#";' +
    'var imgUrl="/img/"+item.key+"?width=800&quality=85&format=auto";' +
    'a.innerHTML="<img src=\\"/img/"+item.key+"?width=400&quality=80&format=auto\\" alt=\\"Trabajo en Edwin Fox\\" loading=\\"lazy\\" width=\\"400\\">";' +
    'a.addEventListener("click",function(e){e.preventDefault();openLightbox(imgUrl)});' +
    'g.appendChild(a);' +
    '})' +
    '}catch(err){console.log("Gallery:",err)}' +
    '}' +
    'loadGallery();' +

    // Lightbox
    'function openLightbox(src){' +
    'document.getElementById("lb-img").src=src;' +
    'document.getElementById("lightbox").classList.add("open");' +
    'document.body.style.overflow="hidden"' +
    '}' +
    'function closeLightbox(){' +
    'document.getElementById("lightbox").classList.remove("open");' +
    'document.body.style.overflow=""' +
    '}' +
    'document.getElementById("lb-close").addEventListener("click",closeLightbox);' +
    'document.getElementById("lightbox").addEventListener("click",function(e){if(e.target===this)closeLightbox()});' +
    'document.addEventListener("keydown",function(e){if(e.key==="Escape")closeLightbox()});' +

    // Set min date for booking
    '(function(){' +
    'var d=document.getElementById("b-fecha");' +
    'if(d){var t=new Date();t.setDate(t.getDate()+1);d.min=t.toISOString().split("T")[0]}' +
    '})();' +

    // Booking form submit
    'document.getElementById("booking-form").addEventListener("submit",function(e){' +
    'e.preventDefault();' +
    'var ok=true;' +
    'var nombre=document.getElementById("b-nombre").value.trim();' +
    'var tel=document.getElementById("b-tel").value.trim();' +
    'var svc=document.getElementById("b-svc").value;' +
    'var fecha=document.getElementById("b-fecha").value;' +
    'var hora=document.getElementById("b-hora").value;' +

    // Validar nombre
    'var errNombre=document.getElementById("err-nombre");' +
    'if(!nombre){errNombre.classList.add("show");ok=false}else{errNombre.classList.remove("show")}' +

    // Validar teléfono
    'var errTel=document.getElementById("err-tel");' +
    'if(!tel||tel.replace(/\\D/g,"").length<9){errTel.classList.add("show");ok=false}else{errTel.classList.remove("show")}' +

    // Validar servicio
    'var errSvc=document.getElementById("err-svc");' +
    'if(!svc){errSvc.classList.add("show");ok=false}else{errSvc.classList.remove("show")}' +

    // Validar fecha (no pasada, no domingo)
    'var errFecha=document.getElementById("err-fecha");' +
    'var fechaOk=false;' +
    'if(fecha){' +
    'var fDate=new Date(fecha+"T12:00:00");' +
    'var hoy=new Date();hoy.setHours(0,0,0,0);' +
    'if(fDate<hoy){errFecha.textContent="La fecha no puede ser pasada";errFecha.classList.add("show");ok=false}' +
    'else if(fDate.getDay()===0){errFecha.textContent="Domingo cerrado";errFecha.classList.add("show");ok=false}' +
    'else{errFecha.classList.remove("show");fechaOk=true}' +
    '}else{errFecha.textContent="Selecciona una fecha";errFecha.classList.add("show");ok=false}' +

    // Validar hora
    'var errHora=document.getElementById("err-hora");' +
    'if(!hora){errHora.classList.add("show");ok=false}else{errHora.classList.remove("show")}' +

    'if(!ok)return;' +

    // Construir mensaje WhatsApp
    'var dias=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];' +
    'var fDisplay=fecha?new Date(fecha+"T12:00:00").toLocaleDateString("es-CL",{weekday:"long",year:"numeric",month:"long",day:"numeric"}):"";' +
    'var msg="Hola%20Edwin%20Fox%20Barber%20Style!%0A%0AQuiero%20reservar%20una%20cita:%0A%0A"' +
    '+"*Nombre:*%20"+encodeURIComponent(nombre)+"%0A"' +
    '+"*Teléfono:*%20"+encodeURIComponent(tel)+"%0A"' +
    '+"*Servicio:*%20"+encodeURIComponent(svc)+"%0A"' +
    '+"*Fecha:*%20"+encodeURIComponent(fDisplay)+"%0A"' +
    '+"*Hora:*%20"+encodeURIComponent(hora)+"%0A%0AGracias!";' +

    'var preview=document.getElementById("form-preview");' +
    'preview.className="form-msg info";' +
    'preview.innerHTML="Redirigiendo a WhatsApp para confirmar tu cita...";' +
    'setTimeout(function(){window.open("https://wa.me/' + WA_NUMBER + '?text="+msg,"_blank")},800)' +
    '});' +
    '</script>';

  return head + css + body + js + '</body></html>';
}
