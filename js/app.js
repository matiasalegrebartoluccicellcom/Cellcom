// ================================================================
// App.html — sesión, menú, utilidades, Configuración y Mi sucursal
// ================================================================
let TOKEN = null;
let YO = null;

// ---------- llamadas al servidor ----------
// api('funcion', arg1, arg2) → Promise. Agrega el token solo.
// Si no hay conexión tira Error('SIN_CONEXION').
let API_URL = (typeof CELLCOM_API_URL !== 'undefined' && CELLCOM_API_URL) || '';
async function api(fn, ...args) {
  if (!API_URL) API_URL = lsGet('cellcom_api_url') || '';
  if (!API_URL) throw new Error('Falta el link del servidor.');
  let r;
  try {
    r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ fn, token: TOKEN, args }) });
  } catch (e) { marcarConexion(false); throw new Error('SIN_CONEXION'); }
  let j;
  try { j = await r.json(); }
  catch (e) { throw new Error('El servidor respondió algo inesperado. Revisá el link (/exec) y que esté implementado para "Cualquier persona".'); }
  marcarConexion(true);
  if (!j.ok) {
    if (String(j.error).indexOf('SESION_VENCIDA') >= 0) { sesionVencida(); }
    throw new Error(j.error);
  }
  return j.data;
}
function esSinConexion(e){ return e && e.message === 'SIN_CONEXION'; }
function marcarConexion(ok){ document.body.classList.toggle('sin-conexion', !ok); }
window.addEventListener('online', ()=>marcarConexion(true));
window.addEventListener('offline', ()=>marcarConexion(false));

// ---------- utilidades de pantalla ----------
function esc(v){ const d=document.createElement('div'); d.textContent = v==null ? '' : String(v); return d.innerHTML; }
function html(str){ return { __html: str }; }
function celda(c){ return (c && typeof c==='object' && '__html' in c) ? c.__html : esc(c); }
function renderTable(id, headers, rows, vacio){
  const el=document.getElementById(id); if(!el) return;
  if(!rows.length && vacio){ el.innerHTML=`<tbody><tr><td>${esc(vacio)}</td></tr></tbody>`; return; }
  el.innerHTML=`<thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${celda(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
}
function renderCards(id, cards){
  document.getElementById(id).innerHTML=cards.map(c=>`<div class="card"><div class="label">${esc(c[0])}</div><div class="value">${esc(c[1])}</div></div>`).join('');
}
function money(n){ return Number(n||0).toLocaleString('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}); }
function usd(n){ return 'US$ '+Number(n||0).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function num(n){ return Number(n||0).toLocaleString('es-AR',{maximumFractionDigits:2}); }
function hoyISO(){ const h=new Date(); return new Date(h.getTime()-h.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function normTxt(t){ return String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase(); }
function lsGet(k){ try{ const x=localStorage.getItem(k); return x?JSON.parse(x):null; }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
function toast(msg, error){
  const t=document.createElement('div'); t.className='toast'+(error?' err':''); t.textContent=msg;
  document.body.appendChild(t); setTimeout(()=>t.remove(), error?5000:2500);
}
function errorUI(e){ toast(esSinConexion(e)?'Sin conexión. Probá de nuevo cuando vuelva internet.':((e&&e.message)||String(e)), true); }

// Lee el primer hoja de un .xls/.xlsx/.csv/.dbf (los .XLS de Zeppelin son DBF).
function leerArchivo(file){
  return new Promise((ok,fail)=>{
    const r=new FileReader();
    r.onload=e=>{
      try{
        const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
        ok(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''}));
      }catch(err){ fail(new Error('No se pudo leer el archivo: '+err.message)); }
    };
    r.onerror=()=>fail(new Error('No se pudo leer el archivo.'));
    r.readAsArrayBuffer(file);
  });
}
function columna(fila, nombres){
  const ks=Object.keys(fila||{});
  for(const n of nombres){ const k=ks.find(x=>normTxt(x).trim()===n); if(k!==undefined) return k; }
  return null;
}

// ---------- sesión ----------
async function entrar(){
  const url=document.getElementById('loginUrl').value.trim();
  const u=document.getElementById('loginUsuario').value.trim();
  const p=document.getElementById('loginPin').value.trim();
  const err=document.getElementById('loginError'), btn=document.getElementById('btnEntrar');
  if(url){
    if(!/^https:\/\/script\.google\.com\/.+\/exec/.test(url)){ err.textContent='El link del servidor tiene que terminar en /exec.'; return; }
    API_URL=url; lsSet('cellcom_api_url',url);
  }
  if(!API_URL){ document.getElementById('boxUrl').style.display='block'; err.textContent='Pegá el link del servidor.'; return; }
  if(!u||!p){ err.textContent='Completá usuario y PIN.'; return; }
  btn.disabled=true; err.textContent='';
  try{
    const r=await api('login',u,p);
    TOKEN=r.token; lsSet('cellcom_token',TOKEN); lsSet('cellcom_yo',r.usuario);
    iniciarApp(r.usuario);
  }catch(e){ err.textContent=esSinConexion(e)?'Sin conexión. Para entrar la primera vez hace falta internet.':e.message; }
  btn.disabled=false;
}
function salir(){
  if(TOKEN) api('logout').catch(()=>{});
  TOKEN=null; YO=null; lsSet('cellcom_token',null); lsSet('cellcom_yo',null);
  document.getElementById('pantallaApp').style.display='none';
  document.getElementById('pantallaLogin').style.display='flex';
  document.getElementById('loginPin').value='';
  document.getElementById('boxUrl').style.display=API_URL?'none':'block';
}
function sesionVencida(){
  salir();
  document.getElementById('loginError').textContent='La sesión venció. Volvé a entrar.';
}
function abrirCambioPin(){
  const actual=prompt('PIN actual'); if(!actual) return;
  const nuevo=prompt('PIN nuevo (4 a 8 números)'); if(!nuevo) return;
  api('cambiarMiPin',actual,nuevo).then(()=>toast('PIN cambiado')).catch(errorUI);
}
function cambiarServidor(){
  const u=prompt('Link del servidor (termina en /exec)', API_URL||''); if(!u) return;
  if(!/^https:\/\/script\.google\.com\/.+\/exec/.test(u.trim())) return toast('El link tiene que terminar en /exec',true);
  API_URL=u.trim(); lsSet('cellcom_api_url',API_URL); toast('Link guardado');
}
function borrarCacheArticulos(){ localStorage.removeItem('cellcom_productos2'); toast('Se van a bajar de nuevo al abrir un stock'); }

const MODULOS = [
  { id:'secStock',      texto:'Stock',          roles:['admin','encargado'], abrir:()=>stAbrir() },
  { id:'secMiSucursal', texto:'Mi sucursal',    roles:['admin','encargado','vendedor'], abrir:()=>abrirMiSucursal() },
  { id:'secConfig',     texto:'Configuración',  roles:['admin'], abrir:()=>cargarConfig() }
];

function iniciarApp(usuario){
  YO=usuario;
  document.getElementById('pantallaLogin').style.display='none';
  document.getElementById('pantallaApp').style.display='block';
  document.getElementById('yoTexto').innerHTML=`${esc(YO.nombre)} <span class="tag ${esc(YO.rol)}">${esc(YO.rol)}</span>${YO.sucursal?' · '+esc(YO.sucursal):''}`;
  const mods=MODULOS.filter(m=>m.roles.indexOf(YO.rol)>=0);
  document.getElementById('menu').innerHTML=mods.map(m=>`<button data-sec="${m.id}" onclick="irA('${m.id}')">${esc(m.texto)}</button>`).join('');
  irA(lsGet('cellcom_seccion') && mods.some(m=>m.id===lsGet('cellcom_seccion')) ? lsGet('cellcom_seccion') : mods[0].id);
}
function irA(id){
  document.querySelectorAll('.section').forEach(s=>s.classList.toggle('active', s.id===id));
  document.querySelectorAll('#menu button').forEach(b=>b.classList.toggle('active', b.dataset.sec===id));
  lsSet('cellcom_seccion', id);
  const m=MODULOS.find(x=>x.id===id); if(m) m.abrir();
}

// Al abrir: si hay sesión guardada la reutiliza. Sin internet entra igual con la última sesión.
(async function arranque(){
  if(!API_URL) API_URL=lsGet('cellcom_api_url')||'';
  document.getElementById('boxUrl').style.display=API_URL?'none':'block';
  if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
  const t=lsGet('cellcom_token'), yoGuardado=lsGet('cellcom_yo');
  if(!t){ document.getElementById('pantallaLogin').style.display='flex'; return; }
  TOKEN=t;
  try{ const u=await api('getSesion'); lsSet('cellcom_yo',u); iniciarApp(u); }
  catch(e){
    if(esSinConexion(e)&&yoGuardado){ iniciarApp(yoGuardado); toast('Sin conexión: trabajando con lo guardado en este equipo'); }
    else { TOKEN=null; lsSet('cellcom_token',null); document.getElementById('pantallaLogin').style.display='flex'; }
  }
})();

// ================================================================
// Configuración
// ================================================================
let CFG=null;
function cargarConfig(){
  api('getConfigApp').then(c=>{
    CFG=c;
    document.getElementById('cfgCotizacion').value=c.cotizacion;
    document.getElementById('cfgSectores').value=c.sectoresDefault;
    document.getElementById('cfgDias').value=c.diasReclamo;
    document.getElementById('cfgLinks').innerHTML=`Planillas: <a href="${esc(c.urls.base)}" target="_blank">DB_Base</a> · <a href="${esc(c.urls.stock)}" target="_blank">DB_Stock</a>`;
    renderTable('cfgTablaBases',['Base','Registros','Actualizada'],c.bases.map(b=>[b.nombre,num(b.registros),b.fecha||'']));
    renderSucursalesCfg();
    renderUsuariosCfg();
    RUB_CFG={nunca:new Set(c.rubrosNunca||[]),fundas:new Set(c.rubrosFundas||[]),muertos:new Set(c.rubrosMuertos||[])};
    SUB_CFG={nunca:new Set(c.subrubrosNunca||[]),muertos:new Set(c.subrubrosMuertos||[])};
    pintarRubrosCfg();
    const prods=lsGet('cellcom_productos2');
    document.getElementById('cfgEquipo').textContent=`Servidor: ${API_URL||'(sin configurar)'} · Artículos guardados en este equipo: ${prods?prods.tsv.split('\n').length:0} · Versión pantallas: ${typeof CELLCOM_VERSION!=='undefined'?CELLCOM_VERSION:'-'}`;
  }).catch(errorUI);
}
function guardarConfigGeneral(){
  api('guardarConfigGeneral',document.getElementById('cfgCotizacion').value,document.getElementById('cfgSectores').value,document.getElementById('cfgDias').value)
    .then(()=>{toast('Guardado');cargarConfig();}).catch(errorUI);
}
async function importarBaseUI(){
  const tipo=document.getElementById('cfgTipoBase').value;
  const file=document.getElementById('cfgArchivoBase').files[0];
  const st=document.getElementById('cfgBaseEstado');
  if(!file){ toast('Elegí el archivo',true); return; }
  st.textContent='Leyendo archivo...';
  try{
    let filas=await leerArchivo(file);
    if(!filas.length) throw new Error('El archivo está vacío.');
    // Se mandan solo las columnas necesarias para que viaje liviano.
    const f0=filas[0];
    if(tipo==='articulos'){
      const k={a:columna(f0,['ARTICULO','CODIGO']),m:columna(f0,['MARCA']),r:columna(f0,['RUBRO']),s:columna(f0,['SUBRUBRO']),n:columna(f0,['NOMBRE','DETALLE','DESCRIPCION'])};
      if(!k.a) throw new Error('No encontré la columna ARTICULO.');
      filas=filas.map(f=>({ARTICULO:f[k.a],MARCA:k.m?f[k.m]:'',RUBRO:k.r?f[k.r]:'',SUBRUBRO:k.s?f[k.s]:'',NOMBRE:k.n?f[k.n]:''}));
    } else if(tipo==='precios'){
      const a=columna(f0,['ARTICULO','CODIGO']); const p=Object.keys(f0).find(x=>/^PRECIO/i.test(x.trim())); const n=columna(f0,['NOMBRE']);
      if(!a||!p) throw new Error('No encontré las columnas ARTICULO y PRECIO.');
      filas=filas.map(f=>({ARTICULO:f[a],NOMBRE:n?f[n]:'',[p.trim()]:f[p]}));
    }
    st.textContent=`Subiendo ${filas.length} registros...`;
    const r=await api('importarBase',tipo,filas);
    st.textContent=`Importado: ${num(r.cantidad)} registros${r.columna?' (precio: '+r.columna+')':''}.`;
    document.getElementById('cfgArchivoBase').value='';
    cargarConfig();
  }catch(e){ st.textContent=e.message; }
}

let RUB_CFG={nunca:new Set(),fundas:new Set(),muertos:new Set()}, SUB_CFG={nunca:new Set(),muertos:new Set()};
function pintarRubrosCfg(){
  const chips=(grupo,id)=>{ document.getElementById(id).innerHTML=(CFG.rubros||[]).map(r=>
    `<button type="button" class="chip${RUB_CFG[grupo].has(r.codigo)?' active':''}" onclick="toggleRubroCfg('${grupo}','${encodeURIComponent(r.codigo)}')">${esc(r.nombre)}<small>${esc(r.codigo)}</small></button>`).join('')
    ||'<span class="hint">Primero importá los rubros.</span>'; };
  chips('nunca','cfgRubrosNunca'); chips('fundas','cfgRubrosFundas'); chips('muertos','cfgRubrosMuertos');
  // Subrubros: son muchos, se muestran los marcados y los que coinciden con la búsqueda.
  const q=((document.getElementById('cfgBuscarSub')||{}).value||'').trim().toUpperCase();
  const subs=CFG.subrubros||[];
  const chipsSub=(grupo,id)=>{ const el=document.getElementById(id); if(!el) return;
    const lista=subs.filter(x=>SUB_CFG[grupo].has(x.codigo)||(q&&(x.nombre.toUpperCase().includes(q)||x.codigo.toUpperCase()===q))).slice(0,60);
    el.innerHTML=lista.map(x=>`<button type="button" class="chip${SUB_CFG[grupo].has(x.codigo)?' active':''}" onclick="toggleSubCfg('${grupo}','${encodeURIComponent(x.codigo)}')">${esc(x.nombre)}<small>${esc(x.codigo)}</small></button>`).join('')
      ||`<span class="hint">${subs.length?'Ninguno marcado. Buscá arriba para agregar.':'Primero importá los subrubros.'}</span>`; };
  chipsSub('nunca','cfgSubNunca'); chipsSub('muertos','cfgSubMuertos');
}
// Un rubro va en un solo grupo: al marcarlo en uno se saca de los otros.
function toggleRubroCfg(grupo,cod){ cod=decodeURIComponent(cod); const s=RUB_CFG[grupo];
  if(s.has(cod)) s.delete(cod); else { Object.keys(RUB_CFG).forEach(g=>RUB_CFG[g].delete(cod)); s.add(cod); }
  pintarRubrosCfg(); }
function toggleSubCfg(grupo,cod){ cod=decodeURIComponent(cod); const s=SUB_CFG[grupo];
  if(s.has(cod)) s.delete(cod); else { Object.keys(SUB_CFG).forEach(g=>SUB_CFG[g].delete(cod)); s.add(cod); }
  pintarRubrosCfg(); }
function guardarRubrosCfg(){ api('guardarRubrosConfig',[...RUB_CFG.nunca],[...RUB_CFG.fundas],[...RUB_CFG.muertos],[...SUB_CFG.nunca],[...SUB_CFG.muertos]).then(()=>toast('Rubros guardados')).catch(errorUI); }

let SUCS_CFG=[];
function renderSucursalesCfg(){
  SUCS_CFG=(CFG.sucursales||[]).map(s=>Object.assign({},s));
  pintarSucursalesCfg();
}
function pintarSucursalesCfg(){
  renderTable('cfgTablaSucursales',['Código','Nombre','Activa'],SUCS_CFG.map((s,i)=>[
    html(`<input value="${esc(s.codigo)}" onchange="SUCS_CFG[${i}].codigo=this.value" style="max-width:120px">`),
    html(`<input value="${esc(s.nombre)}" onchange="SUCS_CFG[${i}].nombre=this.value">`),
    html(`<input type="checkbox" ${s.activa?'checked':''} onchange="SUCS_CFG[${i}].activa=this.checked">`)
  ]));
  const sel=document.getElementById('usrSucursal');
  sel.innerHTML='<option value="">(sin sucursal)</option>'+SUCS_CFG.map(s=>`<option value="${esc(s.codigo)}">${esc(s.codigo)}</option>`).join('');
}
function agregarFilaSucursal(){ SUCS_CFG.push({codigo:'',nombre:'',activa:true}); pintarSucursalesCfg(); }
function guardarSucursalesUI(){ api('guardarSucursales',SUCS_CFG).then(()=>{toast('Sucursales guardadas');cargarConfig();}).catch(errorUI); }

function renderUsuariosCfg(){
  renderTable('cfgTablaUsuarios',['Usuario','Nombre','Rol','Sucursal','Activo',''],(CFG.usuarios||[]).map(u=>[
    u.usuario,u.nombre,html(`<span class="tag ${esc(u.rol)}">${esc(u.rol)}</span>`),u.sucursal,u.activo?'Sí':'No',
    html(`<button class="btn-mini" onclick="editarUsuario('${esc(u.id)}')">Editar</button>`)
  ]));
}
function editarUsuario(id){
  const u=CFG.usuarios.find(x=>x.id===id); if(!u) return;
  document.getElementById('usrFormTitulo').textContent='Editar usuario';
  document.getElementById('usrId').value=u.id;
  document.getElementById('usrUsuario').value=u.usuario;
  document.getElementById('usrNombre').value=u.nombre;
  document.getElementById('usrRol').value=u.rol;
  document.getElementById('usrSucursal').value=u.sucursal;
  document.getElementById('usrPin').value='';
  document.getElementById('usrActivo').value=u.activo?'SI':'NO';
  document.getElementById('usrUsuario').scrollIntoView({behavior:'smooth',block:'center'});
}
function limpiarFormUsuario(){
  document.getElementById('usrFormTitulo').textContent='Nuevo usuario';
  ['usrId','usrUsuario','usrNombre','usrPin'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('usrRol').value='vendedor'; document.getElementById('usrActivo').value='SI';
}
function guardarUsuarioUI(){
  const d={ id:document.getElementById('usrId').value||'', usuario:document.getElementById('usrUsuario').value,
    nombre:document.getElementById('usrNombre').value, rol:document.getElementById('usrRol').value,
    sucursal:document.getElementById('usrSucursal').value, pin:document.getElementById('usrPin').value,
    activo:document.getElementById('usrActivo').value==='SI' };
  api('guardarUsuario',d).then(()=>{toast('Usuario guardado');limpiarFormUsuario();cargarConfig();}).catch(errorUI);
}

// ================================================================
// Mi sucursal (vista de vendedores)
// ================================================================
function abrirMiSucursal(){
  const box=document.getElementById('miSucSelectorBox');
  document.getElementById('miSucDetalle').style.display='none';
  if(YO.rol==='admin'){
    box.style.display='block';
    api('getSucursales').then(sucs=>{
      const sel=document.getElementById('miSucSelector'); const actual=sel.value;
      sel.innerHTML='<option value="">Todas las sucursales</option>'+sucs.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
      sel.value=actual||''; cargarMiSucursal();
    }).catch(errorUI);
  } else { box.style.display='none'; cargarMiSucursal(); }
}
function cargarMiSucursal(){
  const suc=YO.rol==='admin'?document.getElementById('miSucSelector').value:'';
  const lista=document.getElementById('miSucLista');
  lista.innerHTML='<div class="hint">Cargando...</div>';
  api('getMiSucursal',suc).then(d=>{
    const saldos=Object.keys(d.saldosCaja||{}).map(k=>`${esc(k)}: <b>${esc(money(d.saldosCaja[k]))}</b>`).join(' · ');
    const cab=saldos?`<div class="hint">Saldo a favor de caja: ${saldos}</div>`:'';
    if(!d.stocks.length){ lista.innerHTML=cab+'<div class="hint">Todavía no hay stocks cerrados.</div>'; return; }
    lista.innerHTML=cab+d.stocks.map(s=>`<div class="stock-card" onclick="verDetalleMiSucursal('${esc(s.id)}')">
      <div class="head-row"><div><b>${esc(s.sucursal)} · ${esc(s.vuelta)} · ${esc(s.tipo)}</b><div class="hint" style="margin:2px 0">Stock del ${esc(s.fecha)}${s.fechaLimiteReclamo?' · Reclamos hasta el '+esc(s.fechaLimiteReclamo):''}</div></div>
      <div style="text-align:right"><div class="label">A descontar</div><div class="monto">${esc(money(s.netoARS))}</div><div class="hint" style="margin:0">${esc(usd(s.netoUSD))}${s.saldoCajaAplicado?' · faltante '+esc(money(s.faltanteRealARS))+' − caja '+esc(money(s.saldoCajaAplicado)):''}</div></div></div>
      ${s.miDescuentoARS?`<div class="mio">Tu descuento: ${esc(money(s.miDescuentoARS))} (${esc(usd(s.miDescuentoUSD))})</div>`:(s.repartido?`<div class="hint">Repartido entre ${s.empleados} empleado(s).</div>`:'<div class="hint">Reparto pendiente.</div>')}
    </div>`).join('');
  }).catch(e=>{ lista.innerHTML=''; errorUI(e); });
}
function verDetalleMiSucursal(id){
  const box=document.getElementById('miSucDetalle');
  box.style.display='block'; box.innerHTML='<div class="hint">Cargando...</div>';
  api('getDetalleMiSucursal',id).then(d=>{
    const s=d.stock;
    box.innerHTML=`<h2>${esc(s.sucursal)} · ${esc(s.vuelta)} · ${esc(s.tipo)}</h2>
      <div class="hint">Stock del ${esc(s.fecha)} · cerrado ${esc(s.fechaCierre)}${s.fechaLimiteReclamo?' · <b>reclamos hasta el '+esc(s.fechaLimiteReclamo)+'</b>':''}</div>
      <div class="cards" id="miSucCards"></div>
      <h3>Descuentos</h3><div class="table-wrap"><table id="miSucDesc"></table></div>
      <h3>Artículos faltantes</h3><div class="table-wrap"><table id="miSucItems"></table></div>`;
    renderCards('miSucCards',[['Faltante real',money(s.faltanteRealARS)],['Saldo de caja aplicado',money(s.saldoCajaAplicado)],['A descontar',money(s.netoARS)],['A descontar USD',usd(s.netoUSD)],['Artículos',d.faltantesReales.length],['Empleados',d.descuentos.length||'—']]);
    renderTable('miSucDesc',['Empleado','Descuento $','Descuento USD','Estado'],d.descuentos.map(x=>[x.nombre,money(x.montoARS),usd(x.montoUSD),x.estado]),'Todavía no se repartió.');
    renderTable('miSucItems',['Código','Artículo','Rubro','Cant.','Precio','Total $','Total USD'],d.faltantesReales.map(x=>[x.codigo,x.nombre,x.rubro,num(x.cantidadReal),money(x.precioARS),money(x.totalARS),usd(x.totalUSD)]),'No hubo faltantes.');
    box.scrollIntoView({behavior:'smooth',block:'start'});
  }).catch(e=>{ box.innerHTML=''; errorUI(e); });
}
