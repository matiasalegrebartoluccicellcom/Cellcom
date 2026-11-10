// ================================================================
// stock.js — preparar, pistolear (cámara en vivo, pistola, foto),
// resultado, revisión, cierre, reparto y trabajo sin conexión
// ================================================================
const ST={
  rubros:[], rubrosSel:new Set(), lista:[], stock:null, local:false,
  productos:[], idx:{}, totalesServidor:{}, porSector:{},
  cola:[], historial:[], sector:'', enviando:false, enVuelo:new Set(), anularDespues:[],
  timer:null, ticks:0, ultimoSync:null, ultimo:null,
  cam:{stream:null,detector:null,loop:false,h5:null,codigo:'',visto:0,linterna:false},
  res:null, comp:null, audio:null, archivos:[]
};

function stMostrar(panel){
  ['stLista','stConteo','stResultado'].forEach(id=>document.getElementById(id).style.display=id===panel?'block':'none');
  if(panel!=='stConteo'){ stDetenerCamara(); clearInterval(ST.timer); }
}
function stNormCod(v){ let s=String(v==null?'':v).trim().replace(/\s+/g,'').toUpperCase(); if(/^\d+\.0+$/.test(s)) s=s.replace(/\.0+$/,''); return s; }
function stBeep(ok){
  try{
    ST.audio=ST.audio||new (window.AudioContext||window.webkitAudioContext)();
    const o=ST.audio.createOscillator(),g=ST.audio.createGain();
    o.frequency.value=ok?1400:300; o.type=ok?'sine':'square'; g.gain.value=0.18;
    o.connect(g); g.connect(ST.audio.destination); o.start(); o.stop(ST.audio.currentTime+(ok?0.09:0.35));
  }catch(e){}
  if(navigator.vibrate) navigator.vibrate(ok?40:[80,60,80]);
}
function stDescargarJSON(nombre, datos){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(datos)],{type:'application/json'}));
  a.download=nombre.replace(/[^\w.\-]/g,'_'); document.body.appendChild(a); a.click(); a.remove();
}

// ---------- guardado en el equipo ----------
// Stocks abiertos alguna vez con internet: se guardan para poder seguir contando sin conexión.
function stGuardarCacheStock(d){
  lsSet('st_datos_'+d.stock.id,{stock:d.stock,sistema:d.sistema,totales:d.totales,porSector:d.porSector,guardado:Date.now()});
  const idx=(lsGet('st_cache_index')||[]).filter(x=>x.id!==d.stock.id);
  idx.unshift({id:d.stock.id,sucursal:d.stock.sucursal,vuelta:d.stock.vuelta,tipo:d.stock.tipo,fecha:d.stock.fecha,sectores:d.stock.sectores,estado:d.stock.estado});
  lsSet('st_cache_index',idx.slice(0,8));
}
function stLocales(){ return lsGet('st_locales')||[]; }
function stEsLocal(id){ return String(id||'').indexOf('LOCAL-')===0; }

// La lista de artículos se guarda en el equipo y solo se vuelve a bajar si cambió la base.
async function stDescomprimir(b64){
  const bin=atob(b64); const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
async function stObtenerProductos(d){
  const guardado=lsGet('cellcom_productos2');
  if(!d.productosGz && guardado && guardado.v===d.productosVersion) return guardado.tsv;
  let tsv;
  if(d.productosGz && 'DecompressionStream' in window) tsv=await stDescomprimir(d.productosGz);
  else tsv=(await api('getProductosTexto')).tsv;
  try{ localStorage.setItem('cellcom_productos2',JSON.stringify({v:d.productosVersion,tsv})); }catch(e){}
  return tsv;
}
function stArmarProductos(tsv, sistema){
  const vistos={}; ST.productos=[];
  // fila: [codigo, nombre, rubro, marca, stockSistema, codigoRubro]
  (tsv||'').split('\n').forEach(l=>{ if(!l) return; const p=l.split('\t'); vistos[p[0]]=1; ST.productos.push([p[0],p[1]||'',p[2]||'',p[3]||'',sistema[p[0]]||0,p[4]||'']); });
  Object.keys(sistema).forEach(c=>{ if(!vistos[c]&&c!=='__nombres') ST.productos.push([c,(sistema.__nombres&&sistema.__nombres[c])||'(no está en la base)','','',sistema[c],'']); });
  ST.productos=ST.productos.filter(p=>p[0]!=='__nombres');
  ST.idx={};
  ST.productos.forEach((p,i)=>{
    const c=stNormCod(p[0]); if(ST.idx[c]===undefined) ST.idx[c]=i;
    if(/^\d+$/.test(c)){ const sin=c.replace(/^0+(?=\d)/,''); if(ST.idx[sin]===undefined) ST.idx[sin]=i; }
  });
}

// ---------- lista y preparar ----------
function stAbrir(){
  stMostrar('stLista');
  const f=document.getElementById('stFecha'); if(!f.value) f.value=hoyISO();
  api('getDatosNuevoStock').then(d=>{
    const sel=document.getElementById('stSucursal');
    sel.innerHTML=(d.sucursales.length>1?'<option value="">Seleccionar sucursal</option>':'')+d.sucursales.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
    lsSet('st_sucursales',d.sucursales);
    const sec=document.getElementById('stSectores'); if(!sec.value) sec.value=d.sectoresDefault;
    ST.rubros=d.rubros; ST.rubrosNunca=d.rubrosNunca||[]; ST.rubrosFundas=d.rubrosFundas||[]; ST.rubrosMuertos=d.rubrosMuertos||[];
    lsSet('st_rubros',{rubros:d.rubros,nunca:ST.rubrosNunca,fundas:ST.rubrosFundas,muertos:ST.rubrosMuertos});
    stRubrosPorDefecto();
  }).catch(e=>{
    // Sin conexión: se usa lo último guardado.
    const sucs=lsGet('st_sucursales')||(YO.sucursal?[YO.sucursal]:[]);
    document.getElementById('stSucursal').innerHTML=sucs.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
    const sec=document.getElementById('stSectores'); if(!sec.value) sec.value='A,B,C,D,E';
    const rg=lsGet('st_rubros')||{}; ST.rubros=Array.isArray(rg)?rg:(rg.rubros||[]); ST.rubrosNunca=rg.nunca||[]; ST.rubrosFundas=rg.fundas||[]; ST.rubrosMuertos=rg.muertos||[];
    stRubrosPorDefecto();
    if(!esSinConexion(e)) errorUI(e);
  });
  stListar(); stPintarLocales(); cajaIniciar();
}
function stListar(){
  const aviso=document.getElementById('stAvisoOffline');
  api('listarStocks').then(rows=>{
    aviso.style.display='none';
    ST.lista=rows;
    document.getElementById('stExportarBox').style.display=rows.length?'flex':'none';
    renderTable('stTablaStocks',['','Fecha','Sucursal','Vuelta','Tipo','Estado','Art. sistema','Unid. contadas',''],
      rows.map(s=>[html(`<input type="checkbox" class="stSel" value="${esc(s.id)}">`),s.fecha,s.sucursal,s.vuelta,s.tipo,html(`<span class="tag ${esc(s.estado)}">${esc(s.estado)}</span>`),num(s.articulosSistema),num(s.unidadesContadas),
        html((s.estado==='CONTANDO'?`<button class="btn-mini" onclick="stAbrirConteo('${esc(s.id)}')">Pistolear</button> `:'')+`<button class="btn-mini" onclick="stVerResultado('${esc(s.id)}')">${s.estado==='CERRADO'?'Ver':'Resultado'}</button>`)]),
      'Todavía no hay stocks.');
  }).catch(e=>{
    if(!esSinConexion(e)) return errorUI(e);
    const cache=(lsGet('st_cache_index')||[]).filter(s=>s.estado==='CONTANDO');
    ST.lista=cache;
    document.getElementById('stExportarBox').style.display='none';
    aviso.style.display='block';
    aviso.textContent='Sin conexión: se muestran los stocks que ya abriste en este equipo. Podés seguir contando y se envía cuando vuelva internet.';
    renderTable('stTablaStocks',['Fecha','Sucursal','Vuelta','Tipo',''],cache.map(s=>[s.fecha,s.sucursal,s.vuelta,s.tipo,
      html(`<button class="btn-mini" onclick="stAbrirConteo('${esc(s.id)}')">Pistolear</button>`)]),'No hay stocks guardados en este equipo. Usá "Crear sin conexión".');
  });
}
function stPintarRubros(){
  const box=document.getElementById('stRubros');
  const q=normTxt(document.getElementById('stBuscarRubro').value);
  box.innerHTML=ST.rubros.filter(r=>!q||normTxt(r.nombre+' '+r.codigo).includes(q)||ST.rubrosSel.has(r.codigo))
    .map(r=>`<button type="button" class="chip${ST.rubrosSel.has(r.codigo)?' active':''}" onclick="stToggleRubro('${encodeURIComponent(r.codigo)}')">${esc(r.nombre)}<small>${esc(r.codigo)}</small></button>`).join('')
    || '<span class="hint">Primero importá los rubros en Configuración.</span>';
}
function stToggleRubro(c){ c=decodeURIComponent(c); ST.rubrosSel.has(c)?ST.rubrosSel.delete(c):ST.rubrosSel.add(c); stPintarRubros(); }
// ST.rubrosSel = rubros que SE CUENTAN (chip negro).
function stRubrosPorDefecto(){
  const tipo=document.getElementById('stTipo').value;
  const nunca=new Set(ST.rubrosNunca||[]), fundas=new Set(ST.rubrosFundas||[]), muertos=new Set(ST.rubrosMuertos||[]);
  ST.rubrosSel=new Set((ST.rubros||[]).map(r=>r.codigo).filter(c=>tipo==='FUNDAS'?fundas.has(c):!nunca.has(c)&&!fundas.has(c)&&!muertos.has(c)));
  stPintarRubros();
}
function stRubrosTodos(si){ ST.rubrosSel=new Set(si?(ST.rubros||[]).map(r=>r.codigo):[]); stPintarRubros(); }

function stDatosFormulario(){
  return { sucursal:document.getElementById('stSucursal').value, vuelta:document.getElementById('stVuelta').value.trim().toUpperCase(),
    fecha:document.getElementById('stFecha').value, tipo:document.getElementById('stTipo').value,
    sectores:document.getElementById('stSectores').value.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean),
    rubros:[...ST.rubrosSel], rubrosExcluidos:(ST.rubros||[]).map(r=>r.codigo).filter(c=>!ST.rubrosSel.has(c)) };
}
async function stLeerStockSucursal(){
  const file=document.getElementById('stArchivoStock').files[0];
  if(!file) throw new Error('Subí el stock de la sucursal.');
  const filas=await leerArchivo(file);
  const kA=columna(filas[0],['ARTICULO','CODIGO']), kS=columna(filas[0],['STOCK','CANTIDAD']), kN=columna(filas[0],['NOMBRE']);
  if(!kA||!kS) throw new Error('El archivo necesita las columnas ARTICULO y STOCK.');
  return filas.filter(f=>String(f[kA]).trim()!=='').map(f=>({ARTICULO:f[kA],STOCK:f[kS],NOMBRE:kN?f[kN]:''}));
}
async function stCrear(){
  const st=document.getElementById('stCrearEstado'), btn=document.getElementById('stBtnCrear');
  const datos=stDatosFormulario();
  if(!datos.sucursal) return toast('Elegí la sucursal',true);
  if(!datos.vuelta) return toast('Escribí la vuelta',true);
  btn.disabled=true; st.textContent='Leyendo archivo...';
  try{
    const filas=(await stLeerStockSucursal()).map(f=>({ARTICULO:f.ARTICULO,STOCK:f.STOCK}));
    st.textContent=`Creando stock con ${filas.length} artículos...`;
    const r=await api('crearStock',datos,filas);
    st.textContent=`Stock creado: ${r.articulos} artículos con stock en sistema.`;
    document.getElementById('stArchivoStock').value=''; document.getElementById('stVuelta').value='';
    stRubrosPorDefecto();
    await stListarPromesa();
    stAbrirConteo(r.id);
  }catch(e){ st.textContent=esSinConexion(e)?'Sin conexión. Usá "Crear sin conexión".':e.message; }
  btn.disabled=false;
}
function stListarPromesa(){ return api('listarStocks').then(rows=>{ ST.lista=rows; }).catch(()=>{}); }

// Conteo que vive solo en este equipo (sin internet). Después se sube.
async function stCrearLocal(){
  const st=document.getElementById('stCrearEstado');
  const datos=stDatosFormulario();
  if(!datos.sucursal) return toast('Elegí o escribí la sucursal',true);
  if(!datos.vuelta) return toast('Escribí la vuelta',true);
  if(!datos.sectores.length) return toast('Indicá los sectores',true);
  try{
    st.textContent='Leyendo archivo...';
    const filas=await stLeerStockSucursal();
    const sistema={}, nombres={};
    filas.forEach(f=>{ const a=stNormCod(f.ARTICULO); if(!a) return; sistema[a]=(sistema[a]||0)+(Number(f.STOCK)||0); if(f.NOMBRE) nombres[a]=String(f.NOMBRE); });
    const id='LOCAL-'+Date.now().toString(36).toUpperCase();
    const meta={id,sucursal:String(datos.sucursal).toUpperCase(),vuelta:datos.vuelta,fecha:datos.fecha,tipo:datos.tipo,sectores:datos.sectores,rubros:datos.rubros,rubrosExcluidos:datos.rubrosExcluidos,
      estado:'LOCAL',articulosSistema:Object.keys(sistema).length,usuario:YO.nombre,creado:Date.now()};
    lsSet('st_local_'+id,{meta,sistema,nombres});
    lsSet('st_locales',[id].concat(stLocales()));
    document.getElementById('stArchivoStock').value='';
    st.textContent='Conteo creado en este equipo.';
    if(!lsGet('cellcom_productos2')) toast('Este equipo no tiene la lista de artículos: se van a ver los nombres del archivo de la sucursal.',true);
    stPintarLocales(); stAbrirConteo(id);
  }catch(e){ st.textContent=e.message; }
}
function stVolver(){ stMostrar('stLista'); stListar(); stPintarLocales(); }

// ---------- conteo ----------
async function stAbrirConteo(id){
  stMostrar('stConteo');
  const scan=document.getElementById('stScan');
  scan.disabled=true; scan.placeholder='Cargando artículos...';
  document.getElementById('stLectura').innerHTML='';
  ST.local=stEsLocal(id);
  document.getElementById('stBtnVerResultado').style.display=ST.local?'none':'';
  document.getElementById('stBtnExportarLocal').style.display=ST.local?'':'none';

  const previo=(ST.lista||[]).find(s=>s.id===id);
  if(previo){
    ST.stock=previo; ST.porSector={}; ST.sector=lsGet('st_'+id+'_sector')||previo.sectores[0]||'';
    document.getElementById('stConteoTitulo').textContent=`${previo.sucursal} · ${previo.vuelta} · ${previo.tipo}`;
    document.getElementById('stConteoSub').textContent='Cargando artículos...';
    stPintarSectores();
  } else { document.getElementById('stConteoTitulo').textContent='Cargando...'; document.getElementById('stSectoresConteo').innerHTML=''; }

  try{
    let sistema, sub;
    if(ST.local){
      const L=lsGet('st_local_'+id); if(!L) throw new Error('No se encontró el conteo en este equipo.');
      ST.stock=L.meta; ST.totalesServidor={}; ST.porSector={};
      sistema=Object.assign({},L.sistema); sistema.__nombres=L.nombres||{};
      const prods=lsGet('cellcom_productos2');
      stArmarProductos(prods?prods.tsv:'', sistema);
      sub=`Conteo sin conexión (solo en este equipo) · Stock del ${ST.stock.fecha} · cuenta ${YO.nombre}`;
    } else {
      let d=null;
      try{
        const guardado=lsGet('cellcom_productos2');
        d=await api('getDatosConteo',id,guardado?guardado.v:'');
        const tsv=await stObtenerProductos(d);
        stGuardarCacheStock(d);
        stArmarProductos(tsv, d.sistema||{});
        ST.stock=d.stock; ST.totalesServidor=d.totales||{}; ST.porSector=d.porSector||{};
        sub=`Stock del ${ST.stock.fecha} · ${num(ST.stock.articulosSistema)} artículos en sistema · Cuenta: ${YO.nombre}`;
      }catch(e){
        if(!esSinConexion(e)) throw e;
        const c=lsGet('st_datos_'+id), prods=lsGet('cellcom_productos2');
        if(!c||!prods) throw new Error('Sin conexión y este stock no está guardado en el equipo.');
        stArmarProductos(prods.tsv, c.sistema||{});
        ST.stock=c.stock; ST.totalesServidor=c.totales||{}; ST.porSector=c.porSector||{};
        sub=`Sin conexión · se envía cuando vuelva internet · Cuenta: ${YO.nombre}`;
      }
    }
    const k='st_'+ST.stock.id;
    ST.cola=lsGet(k+'_cola')||[]; ST.historial=lsGet(k+'_hist')||[];
    ST.sector=lsGet(k+'_sector')||ST.stock.sectores[0]||''; ST.ultimo=null;
    document.getElementById('stConteoTitulo').textContent=`${ST.stock.sucursal} · ${ST.stock.vuelta} · ${ST.stock.tipo}`;
    document.getElementById('stConteoSub').textContent=sub;
    stPintarSectores(); stPintarHistorial(); stPintarSync();
    document.getElementById('stBtnActSistema').style.display=(YO.rol==='admin'||YO.rol==='encargado'||ST.local)?'':'none';
    // Fundas se cuentan buscando por nombre; el resto escaneando. Se puede cambiar.
    stModo(lsGet('st_'+ST.stock.id+'_modo')||(ST.stock.tipo==='FUNDAS'?'lista':'escanear'));
    scan.disabled=false; scan.placeholder='Pistoleá o escribí el código + Enter';
    clearInterval(ST.timer);
    if(!ST.local){ ST.timer=setInterval(stTick,4000); stEnviar(true); }
    scan.focus();
  }catch(e){
    document.getElementById('stConteoSub').innerHTML=`<span class="err">${esc(e.message||e)}</span> <button class="btn-mini" onclick="stAbrirConteo('${esc(id)}')">Reintentar</button>`;
  }
}
function stPorSectorLocal(){ const o={}; ST.cola.forEach(x=>{ o[x.sector]=(o[x.sector]||0)+x.cantidad; }); return o; }
function stPintarSectores(){
  const ps=ST.local?stPorSectorLocal():ST.porSector;
  document.getElementById('stSectoresConteo').innerHTML=(ST.stock.sectores||[]).map(s=>
    `<button type="button" class="chip${s===ST.sector?' active':''}" onclick="stElegirSector('${esc(s)}')">${esc(s)}<small>${num(ps[s]||0)}</small></button>`).join('');
  document.getElementById('stSectorActual').textContent='Sector: '+(ST.sector||'—');
}
function stElegirSector(s){ ST.sector=s; lsSet('st_'+ST.stock.id+'_sector',s); stPintarSectores(); document.getElementById('stScan').focus(); }
function stBuscarIdx(codigo){
  const c=stNormCod(codigo); if(!c) return -1;
  if(ST.idx[c]!==undefined) return ST.idx[c];
  if(/^\d+$/.test(c)){ const sin=c.replace(/^0+(?=\d)/,''); if(ST.idx[sin]!==undefined) return ST.idx[sin]; }
  return -1;
}
function stTotal(art){ return (ST.totalesServidor[art]||0)+ST.cola.filter(x=>x.articulo===art).reduce((s,x)=>s+x.cantidad,0); }
function stProcesar(codigo){
  codigo=String(codigo||'').trim(); if(!codigo||!ST.productos.length) return false;
  if(!ST.sector){ toast('Elegí un sector',true); return false; }
  const i=stBuscarIdx(codigo);
  if(i<0){
    stBeep(false); stMarcoCam('mal');
    document.getElementById('stLectura').innerHTML=`<div class="lectura err"><h3>Código no encontrado</h3><div class="sub">${esc(codigo)}</div>
      <div class="actions"><button class="btn btn-secondary" onclick="stAgregar('${esc(stNormCod(codigo))}',1,true)">Registrar igual</button></div></div>`;
    return false;
  }
  stAgregar(ST.productos[i][0],1); return true;
}
function stAgregar(articulo,cantidad,sinBase){
  articulo=stNormCod(articulo); cantidad=Number(cantidad)||0; if(!cantidad) return;
  if(sinBase&&stBuscarIdx(articulo)<0){ ST.productos.push([articulo,'(no está en la base)','','',0]); ST.idx[articulo]=ST.productos.length-1; }
  const e={cid:'C'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),sector:ST.sector,articulo,cantidad,ts:Date.now()};
  ST.cola.push(e);
  ST.historial.unshift(Object.assign({},e,{estado:ST.local?'guardado':'pendiente'})); ST.historial=ST.historial.slice(0,60);
  const prev=ST.ultimo&&ST.ultimo.articulo===articulo&&ST.ultimo.ajustando;
  ST.ultimo={articulo,cantidadLectura:prev?ST.ultimo.cantidadLectura+cantidad:cantidad};
  stGuardarLocal(); stBeep(true); stMarcoCam('leyo'); stPintarLectura(); stPintarHistorial(); stPintarSync(); stPintarSectores();
  if(ST.modo==='lista') stActualizarFilaLista(articulo);
  document.getElementById('stResNombre').innerHTML='';
  if(!ST.local&&ST.cola.length>=15) stEnviar();
}
function stPintarLectura(){
  if(!ST.ultimo){ document.getElementById('stLectura').innerHTML=''; return; }
  const p=ST.productos[stBuscarIdx(ST.ultimo.articulo)]||[ST.ultimo.articulo,'','','',0];
  const total=stTotal(p[0]), dif=total-Number(p[4]||0);
  document.getElementById('stLectura').innerHTML=`<div class="lectura ok">
    <h3>${esc(p[1])}</h3><div class="sub">${esc(p[0])}${p[2]?' · '+esc(p[2]):''}${p[3]?' · '+esc(p[3]):''}</div>
    <div class="nums"><div><b>Sistema</b><span>${num(p[4])}</span></div><div><b>Contado</b><span>${num(total)}</span></div>
    <div><b>Diferencia</b><span style="color:${dif<0?'#b91c1c':dif>0?'#a16207':'#15803d'}">${dif>0?'+':''}${num(dif)}</span></div></div>
    <div class="qty"><label style="margin:0">Cantidad de esta lectura</label>
      <input id="stQty" type="number" min="0" step="1" value="${ST.ultimo.cantidadLectura}" onkeydown="if(event.key==='Enter'){event.preventDefault();stAplicarCantidad();}">
      <button class="btn btn-secondary" onclick="stAplicarCantidad()">Aplicar</button></div></div>`;
}
function stAplicarCantidad(){
  if(!ST.ultimo) return;
  const nuevo=Number(document.getElementById('stQty').value);
  if(!isFinite(nuevo)||nuevo<0) return toast('Cantidad inválida',true);
  const delta=nuevo-ST.ultimo.cantidadLectura;
  if(delta){ ST.ultimo.ajustando=true; stAgregar(ST.ultimo.articulo,delta); ST.ultimo.ajustando=false; }
  document.getElementById('stQty').blur();
}
function stPintarHistorial(){
  const box=document.getElementById('stHistorial');
  if(!ST.historial.length){ box.innerHTML='<div class="hint">Todavía no hay lecturas en este equipo.</div>'; return; }
  box.innerHTML=ST.historial.map(h=>{
    const p=ST.productos[stBuscarIdx(h.articulo)]||[h.articulo,''];
    const hora=new Date(h.ts).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    return `<div class="hist-row${h.estado==='anulado'?' anulado':''}"><div><b>${h.cantidad>0?'+':''}${num(h.cantidad)}</b> ${esc(p[1]||h.articulo)}
      <div class="hint" style="margin:2px 0 0">Sector ${esc(h.sector)} · ${hora} · ${h.estado}</div></div>
      ${h.estado!=='anulado'?`<button class="btn-mini" onclick="stDeshacer('${h.cid}')">Deshacer</button>`:''}</div>`;
  }).join('');
}
function stDeshacer(cid){
  const h=ST.historial.find(x=>x.cid===cid); if(!h) return;
  const i=ST.cola.findIndex(x=>x.cid===cid);
  if(i>=0&&!ST.enVuelo.has(cid)) ST.cola.splice(i,1);
  else if(ST.enVuelo.has(cid)) ST.anularDespues.push(cid);
  else api('anularConteo',ST.stock.id,cid).then(r=>{ if(r&&r.totales){ ST.totalesServidor=r.totales; ST.porSector=r.porSector||ST.porSector; } stPintarLectura(); stPintarSectores(); })
    .catch(e=>{ h.estado='enviado'; stGuardarLocal(); stPintarHistorial(); errorUI(e); });
  h.estado='anulado'; stGuardarLocal(); stPintarHistorial(); stPintarLectura(); stPintarSync(); stPintarSectores();
}
function stGuardarLocal(){ const k='st_'+ST.stock.id; lsSet(k+'_cola',ST.cola); lsSet(k+'_hist',ST.historial); }
function stPintarSync(){
  const el=document.getElementById('stSync'); const n=ST.cola.length;
  if(ST.local){ el.innerHTML=`<span class="pend">${n} lectura(s) guardadas en este equipo</span>`; return; }
  el.innerHTML=n?`<span class="pend">${n} lectura(s) sin enviar</span>${ST.enviando?' · enviando...':''}`
    :('Todo enviado'+(ST.ultimoSync?' · '+ST.ultimoSync.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}):''));
}
function stTick(){ ST.ticks++; if(ST.cola.length) stEnviar(); else if(ST.ticks%5===0) stEnviar(true); }
function stEnviar(forzar){
  if(ST.local||ST.enviando||!ST.stock) return;
  if(!ST.cola.length&&!forzar) return;
  const lote=ST.cola.slice(0,200);
  ST.enviando=true; ST.enVuelo=new Set(lote.map(x=>x.cid)); stPintarSync();
  api('registrarConteos',ST.stock.id,lote).then(r=>{
    const rec=new Set(r.recibidos||[]);
    ST.cola=ST.cola.filter(x=>!rec.has(x.cid));
    ST.historial.forEach(h=>{ if(rec.has(h.cid)&&h.estado==='pendiente') h.estado='enviado'; });
    ST.totalesServidor=r.totales||{}; ST.porSector=r.porSector||{};
    ST.enviando=false; ST.enVuelo=new Set(); ST.ultimoSync=new Date();
    ST.anularDespues.splice(0).forEach(cid=>api('anularConteo',ST.stock.id,cid).then(x=>{ if(x&&x.totales){ ST.totalesServidor=x.totales; ST.porSector=x.porSector||ST.porSector; stPintarLectura(); stPintarSectores(); } }).catch(()=>{}));
    const c=lsGet('st_datos_'+ST.stock.id); if(c){ c.totales=ST.totalesServidor; c.porSector=ST.porSector; lsSet('st_datos_'+ST.stock.id,c); }
    stGuardarLocal(); stPintarSync(); stPintarLectura(); stPintarSectores(); stPintarHistorial();
    if(ST.modo==='lista') stPintarLista();
    if(r.estado&&r.estado!=='CONTANDO'){ clearInterval(ST.timer); toast('El stock pasó a '+r.estado+'. Ya no se puede pistolear.',true); }
  }).catch(e=>{
    ST.enviando=false; ST.enVuelo=new Set();
    document.getElementById('stSync').innerHTML=`<span class="pend">${ST.cola.length} sin enviar · ${esc(esSinConexion(e)?'sin conexión, se reintenta solo':e.message)}</span>`;
    if(/REVISION|CERRADO|ANULADO/.test(e.message)) clearInterval(ST.timer);
  });
}
function stBuscarNombre(q){
  const box=document.getElementById('stResNombre');
  const pal=normTxt(q).split(/\s+/).filter(Boolean);
  if(!pal.length||pal.join('').length<3){ box.innerHTML=''; return; }
  const res=[];
  for(let i=0;i<ST.productos.length&&res.length<15;i++){ const p=ST.productos[i]; const t=normTxt(p[0]+' '+p[1]); if(pal.every(w=>t.includes(w))) res.push(p); }
  box.innerHTML=res.map(p=>`<button type="button" onclick="stAgregar('${esc(p[0])}',1);document.getElementById('stBuscarNombre').value='';">${esc(p[1])} <span class="hint">${esc(p[0])} · sistema ${num(p[4])}</span></button>`).join('')||'<div class="hint">Sin resultados</div>';
}

// ---------- modo lista (buscar por nombre) ----------
// Para fundas y artículos sin código: se busca por modelo o nombre y se suma con + / −.
function stModo(m){
  ST.modo=m==='lista'?'lista':'escanear';
  if(ST.stock) lsSet('st_'+ST.stock.id+'_modo',ST.modo);
  document.getElementById('stModoEscanear').classList.toggle('active',ST.modo==='escanear');
  document.getElementById('stModoLista').classList.toggle('active',ST.modo==='lista');
  document.getElementById('stPanelEscanear').style.display=ST.modo==='escanear'?'block':'none';
  document.getElementById('stPanelLista').style.display=ST.modo==='lista'?'block':'none';
  if(ST.modo==='lista'){ stDetenerCamara(); stPintarLista(); document.getElementById('stListaBuscar').focus(); }
  else document.getElementById('stScan').focus();
}
// Misma regla que el servidor: incluido → sí; excluido → no; sin definir → GENERAL sí, FUNDAS no.
function stEntraRubro(rc){
  if(!rc) return true;
  const inc=(ST.stock&&ST.stock.rubros)||[], exc=(ST.stock&&ST.stock.rubrosExcluidos)||[];
  if(ST.stock&&ST.stock.tipo==='FUNDAS'&&!inc.length) return true;
  if(inc.indexOf(rc)>=0) return true;
  if(exc.indexOf(rc)>=0) return false;
  return !(ST.stock&&ST.stock.tipo==='FUNDAS');
}
function stPintarLista(){
  const box=document.getElementById('stListaItems'), info=document.getElementById('stListaInfo');
  if(!ST.productos.length){ box.innerHTML=''; return; }
  const q=normTxt(document.getElementById('stListaBuscar').value).split(/\s+/).filter(Boolean);
  const soloStock=document.getElementById('stListaConStock').checked;
  const res=[];
  for(const p of ST.productos){
    if(!stEntraRubro(String(p[5]||''))) continue;
    if(soloStock&&!(Number(p[4])>0)) continue;
    if(q.length&&!q.every(w=>normTxt(p[0]+' '+p[1]).includes(w))) continue;
    if(!q.length&&!(Number(p[4])>0)&&!stTotal(p[0])) continue;
    res.push(p);
  }
  res.sort((a,b)=>(Number(b[4])>0)-(Number(a[4])>0)||a[1].localeCompare(b[1],'es'));
  const mostrar=res.slice(0,60);
  info.textContent='Rubros del stock · '+(res.length>60?`Mostrando 60 de ${res.length}: escribí más para filtrar.`:`${res.length} artículo(s)`);
  box.innerHTML=mostrar.map(p=>stFilaListaHTML(p)).join('')||'<div class="hint">Sin resultados.</div>';
}
function stFilaListaHTML(p){
  const t=stTotal(p[0]), d=t-Number(p[4]||0);
  const cl=d<0?'dif-neg':d>0?'dif-pos':'dif-ok';
  const id=encodeURIComponent(p[0]);
  return `<div class="item-lista ${cl}" data-cod="${esc(p[0])}">
    <div class="info"><b>${esc(p[1])}</b><small>${esc(p[0])} · sistema ${num(p[4])}${p[3]?' · '+esc(p[3]):''}</small></div>
    <div class="cont" title="Contado">${num(t)}</div>
    <div class="ctrl"><button onclick="stListaSumar('${id}',-1)">−</button><button onclick="stListaSumar('${id}',1)">+</button>
      <input type="number" min="1" step="1" placeholder="n" onkeydown="if(event.key==='Enter'){event.preventDefault();stListaSumarN('${id}',this);}"><button onclick="stListaSumarN('${id}',this.previousElementSibling)" style="width:auto;padding:0 10px;font-size:14px">Sumar</button></div>
  </div>`;
}
function stListaSumar(idEnc,n){
  const cod=decodeURIComponent(idEnc);
  if(!ST.sector) return toast('Elegí un sector',true);
  if(n<0&&stTotal(cod)<=0) return;
  stAgregar(cod,n);
}
function stListaSumarN(idEnc,input){
  const n=Number(input.value); if(!(n>0)) return toast('Poné una cantidad',true);
  input.value=''; stListaSumar(idEnc,n);
}
function stActualizarFilaLista(cod){
  const fila=[...document.querySelectorAll('#stListaItems .item-lista')].find(x=>x.dataset.cod===cod);
  const p=ST.productos[stBuscarIdx(cod)];
  if(fila&&p){ const tmp=document.createElement('div'); tmp.innerHTML=stFilaListaHTML(p); fila.replaceWith(tmp.firstElementChild); }
}

// ---------- actualizar el stock del sistema (ej. fundas, al día siguiente) ----------
async function stActualizarSistema(input){
  const file=input.files&&input.files[0]; input.value=''; if(!file||!ST.stock) return;
  if(!confirm('¿Reemplazar el stock del sistema de este conteo por el del archivo? Lo ya contado no se toca.')) return;
  try{
    const filas=await leerArchivo(file);
    const kA=columna(filas[0],['ARTICULO','CODIGO']), kS=columna(filas[0],['STOCK','CANTIDAD']), kN=columna(filas[0],['NOMBRE']);
    if(!kA||!kS) throw new Error('El archivo necesita las columnas ARTICULO y STOCK.');
    if(ST.local){
      const L=lsGet('st_local_'+ST.stock.id); const sis={}, nom=L.nombres||{};
      filas.forEach(f=>{ const a=stNormCod(f[kA]); if(!a) return; sis[a]=(sis[a]||0)+(Number(f[kS])||0); if(kN&&f[kN]) nom[a]=String(f[kN]); });
      L.sistema=sis; L.nombres=nom; L.meta.articulosSistema=Object.keys(sis).length; lsSet('st_local_'+ST.stock.id,L);
      toast('Stock del sistema actualizado ('+Object.keys(sis).length+' artículos)');
    } else {
      const r=await api('actualizarStockSistema',ST.stock.id,filas.filter(f=>String(f[kA]).trim()!=='').map(f=>({ARTICULO:f[kA],STOCK:f[kS]})));
      toast('Stock del sistema actualizado ('+r.articulos+' artículos)');
    }
    stAbrirConteo(ST.stock.id);
  }catch(e){ errorUI(e); }
}

// ---------- cámara en vivo ----------
// Un código que queda frente a la cámara cuenta UNA vez. Para otra unidad igual,
// sacalo del cuadro y volvé a apuntar (o corregí la cantidad).
function stCodigoCamara(txt){
  const ahora=Date.now(); txt=String(txt||'').trim(); if(!txt) return;
  if(txt===ST.cam.codigo&&ahora-ST.cam.visto<1200){ ST.cam.visto=ahora; return; }
  ST.cam.codigo=txt; ST.cam.visto=ahora; stProcesar(txt);
}
function stMarcoCam(cl){ const b=document.getElementById('camBox'); if(!b||b.style.display==='none') return; b.classList.remove('leyo','mal'); void b.offsetWidth; b.classList.add(cl); setTimeout(()=>b.classList.remove(cl),400); }
function stCargarH5(){
  return new Promise((ok,fail)=>{
    if(window.Html5Qrcode) return ok();
    const s=document.createElement('script'); s.src='lib/html5-qrcode.min.js';
    s.onload=()=>ok(); s.onerror=()=>fail(new Error('No se pudo cargar el lector.')); document.head.appendChild(s);
  });
}
async function stIniciarCamara(){
  if(ST.cam.loop||ST.cam.h5) return;
  if(!ST.productos.length) return toast('Esperá a que carguen los artículos',true);
  const btn=document.getElementById('stBtnCamara');
  try{
    if('BarcodeDetector' in window){
      const soportados=await BarcodeDetector.getSupportedFormats();
      const formatos=['ean_13','ean_8','code_128','code_39','code_93','upc_a','upc_e','itf','codabar','qr_code'].filter(f=>soportados.includes(f));
      ST.cam.detector=new BarcodeDetector({formats:formatos});
      ST.cam.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
      const v=document.getElementById('camVideo'); v.srcObject=ST.cam.stream; await v.play();
      document.getElementById('camBox').style.display='block'; btn.style.display='none';
      try{ const t=ST.cam.stream.getVideoTracks()[0]; if(t.getCapabilities&&t.getCapabilities().torch) document.getElementById('btnLinterna').style.display='inline-block'; }catch(e){}
      ST.cam.loop=true;
      const paso=async()=>{
        if(!ST.cam.loop) return;
        try{ if(v.readyState>=2){ const r=await ST.cam.detector.detect(v); if(r.length) stCodigoCamara(r[0].rawValue); } }catch(e){}
        setTimeout(paso,120);
      };
      paso();
    } else {
      // iPhone y navegadores sin lector nativo.
      await stCargarH5();
      document.getElementById('camH5').style.display='block';
      btn.textContent='⏹ Apagar cámara'; btn.onclick=stDetenerCamara;
      ST.cam.h5=new Html5Qrcode('camH5');
      await ST.cam.h5.start({facingMode:'environment'},{fps:12,qrbox:{width:280,height:130}},t=>stCodigoCamara(t),()=>{});
    }
    document.getElementById('stScan').blur();
  }catch(e){ stDetenerCamara(); toast('No se pudo abrir la cámara: '+((e&&e.message)||e),true); }
}
function stDetenerCamara(){
  ST.cam.loop=false;
  if(ST.cam.stream){ ST.cam.stream.getTracks().forEach(t=>t.stop()); ST.cam.stream=null; }
  if(ST.cam.h5){ const h=ST.cam.h5; ST.cam.h5=null; h.stop().catch(()=>{}).finally(()=>{ try{h.clear();}catch(e){} }); }
  const box=document.getElementById('camBox'); if(box) box.style.display='none';
  const h5=document.getElementById('camH5'); if(h5) h5.style.display='none';
  const lin=document.getElementById('btnLinterna'); if(lin) lin.style.display='none';
  const btn=document.getElementById('stBtnCamara'); if(btn){ btn.style.display=''; btn.textContent='📷 Cámara'; btn.onclick=stIniciarCamara; }
  ST.cam.linterna=false;
}
async function stLinterna(){
  try{ const t=ST.cam.stream.getVideoTracks()[0]; ST.cam.linterna=!ST.cam.linterna; await t.applyConstraints({advanced:[{torch:ST.cam.linterna}]}); }
  catch(e){ toast('Este celular no deja usar la linterna',true); }
}
document.addEventListener('visibilitychange',()=>{ if(document.hidden) stDetenerCamara(); });

// Plan B: sacar una foto del código y leerlo desde la imagen.
async function stLeerFoto(input){
  const file=input.files&&input.files[0]; input.value='';
  if(!file) return;
  try{
    let codigo='';
    if('BarcodeDetector' in window){
      const r=await new BarcodeDetector().detect(await createImageBitmap(file));
      if(r.length) codigo=r[0].rawValue;
    }
    if(!codigo){
      await stCargarH5();
      let div=document.getElementById('stFotoTmp');
      if(!div){ div=document.createElement('div'); div.id='stFotoTmp'; div.style.display='none'; document.body.appendChild(div); }
      codigo=await new Html5Qrcode('stFotoTmp').scanFile(file,false);
    }
    stProcesar(codigo);
  }catch(e){ stBeep(false); toast('No se pudo leer el código en la foto. Probá más cerca y con buena luz.',true); }
}

// ---------- conteos en este equipo (sin conexión) y archivos ----------
function stArchivoDeLocal(id){
  const L=lsGet('st_local_'+id); if(!L) return null;
  const cola=lsGet('st_'+id+'_cola')||[];
  const m=L.meta;
  return {formato:'cellcom-conteo-v1',sucursal:m.sucursal,vuelta:m.vuelta,fecha:m.fecha,tipo:m.tipo,sectores:m.sectores,
    sectoresContados:[...new Set(cola.map(x=>x.sector))],rubros:m.rubros||[],rubrosExcluidos:m.rubrosExcluidos||[],usuario:m.usuario||YO.nombre,dispositivo:id,exportado:new Date().toISOString(),
    sistema:Object.keys(L.sistema).map(a=>({ARTICULO:a,STOCK:L.sistema[a]})),lecturas:cola};
}
function stExportarLocal(id){
  const a=stArchivoDeLocal(id); if(!a) return;
  stDescargarJSON(`conteo_${a.sucursal}_${a.vuelta}_${a.tipo}_${a.usuario}.json`,a);
  toast('Archivo exportado');
}
async function stLeerArchivosConteo(input){
  for(const f of [...input.files]){
    try{
      const d=JSON.parse(await f.text());
      if(d.formato!=='cellcom-conteo-v1') throw new Error('no es un conteo de CELLCOM');
      ST.archivos.push({nombre:f.name,datos:d});
    }catch(e){ toast(f.name+': '+e.message,true); }
  }
  input.value=''; stPintarLocales();
}
function stPintarLocales(){
  const box=document.getElementById('stLocales');
  const items=stLocales().map(id=>({tipo:'local',id,datos:stArchivoDeLocal(id)})).filter(x=>x.datos)
    .concat(ST.archivos.map((a,i)=>({tipo:'archivo',id:'ARCH'+i,nombre:a.nombre,datos:a.datos})));
  if(!items.length){ box.innerHTML='<div class="hint">No hay conteos guardados en este equipo.</div>'; return; }
  const destinos=(ST.lista||[]).filter(s=>s.estado==='CONTANDO');
  box.innerHTML=items.map((it,i)=>{
    const d=it.datos, lect=(d.lecturas||[]).filter(x=>!x.anulado);
    const uni=lect.reduce((t,x)=>t+Number(x.cantidad||0),0);
    const opciones=destinos.filter(s=>s.sucursal===String(d.sucursal).toUpperCase());
    const sug=opciones.find(s=>s.vuelta===String(d.vuelta).toUpperCase()&&s.tipo===d.tipo);
    return `<div class="lectura"><h3>${esc(d.sucursal)} · ${esc(d.vuelta)} · ${esc(d.tipo)} <span class="tag LOCAL">${it.tipo==='local'?'en este equipo':'archivo'}</span></h3>
      <div class="sub">${it.nombre?esc(it.nombre)+' · ':''}contó ${esc(d.usuario)} · ${lect.length} lecturas · ${num(uni)} unidades</div>
      <div class="grid2"><div><label>Subir a</label><select id="stDest${i}">${opciones.map(s=>`<option value="${esc(s.id)}" ${sug&&sug.id===s.id?'selected':''}>${esc(s.sucursal)} ${esc(s.vuelta)} ${esc(s.tipo)} (${esc(s.fecha)})</option>`).join('')}
        <option value="" ${sug?'':'selected'}>Crear stock nuevo con estos datos</option></select></div></div>
      <div class="actions">
        <button class="btn btn-primary" onclick="stSubirConteo(${i},'${it.tipo}','${esc(it.id)}',this)">Subir a la app</button>
        ${it.tipo==='local'?`<button class="btn btn-secondary" onclick="stAbrirConteo('${esc(it.id)}')">Seguir contando</button>
        <button class="btn btn-secondary" onclick="stExportarLocal('${esc(it.id)}')">Exportar archivo</button>
        <button class="btn-mini" onclick="stBorrarLocal('${esc(it.id)}')">Borrar</button>`:''}
      </div></div>`;
  }).join('');
}
async function stSubirConteo(i,tipo,id,btn){
  const datos=tipo==='local'?stArchivoDeLocal(id):ST.archivos[Number(id.replace('ARCH',''))].datos;
  btn.disabled=true; btn.textContent='Subiendo...';
  try{
    const r=await api('importarConteoOffline',document.getElementById('stDest'+i).value,datos);
    toast(`${r.creado?'Stock creado. ':''}Subidas ${r.importadas} lecturas${r.repetidas?' ('+r.repetidas+' ya estaban)':''}`);
    if(tipo==='local'&&confirm('Conteo subido. ¿Lo borro de este equipo?')) stBorrarLocal(id,true);
    if(tipo==='archivo') ST.archivos.splice(Number(id.replace('ARCH','')),1);
    await stListarPromesa(); stListar(); stPintarLocales();
  }catch(e){ btn.disabled=false; btn.textContent='Subir a la app'; errorUI(e); }
}
function stBorrarLocal(id,sinPreguntar){
  if(!sinPreguntar&&!confirm('¿Borrar este conteo del equipo? Si no lo subiste ni lo exportaste, se pierde.')) return;
  ['st_local_'+id,'st_'+id+'_cola','st_'+id+'_hist','st_'+id+'_sector'].forEach(k=>localStorage.removeItem(k));
  lsSet('st_locales',stLocales().filter(x=>x!==id)); stPintarLocales();
}

// ---------- resultado ----------
function stVerResultado(id){
  if(!ST.res||ST.res.stock.id!==id) ST.filtroRev={q:'',rubro:'',sub:''};
  stMostrar('stResultado');
  document.getElementById('stResTitulo').textContent='Calculando...';
  const correr=()=>api('getResultadoStock',id).then(stPintarResultado).catch(e=>{ errorUI(e); if(esSinConexion(e)) stVolver(); });
  if(ST.stock&&ST.stock.id===id&&ST.cola.length&&!ST.local){
    api('registrarConteos',id,ST.cola.slice(0,500)).then(r=>{ const rec=new Set(r.recibidos||[]); ST.cola=ST.cola.filter(x=>!rec.has(x.cid)); stGuardarLocal(); correr(); }).catch(()=>correr());
  } else correr();
}
function stPintarResultado(r){
  ST.res=r; const s=r.stock;
  document.getElementById('stResTitulo').textContent=`${s.sucursal} · ${s.vuelta} · ${s.tipo}`;
  document.getElementById('stResSub').innerHTML=`Stock del ${esc(s.fecha)} · <span class="tag ${esc(s.estado)}">${esc(s.estado)}</span> · Cotización ${esc(money(s.cotizacion))}${s.preciosOrigen?' · Precios: '+esc(s.preciosOrigen):''}`;
  const bot=[`<button class="btn btn-secondary" onclick="stVolver()">Volver</button>`];
  if(s.estado==='CONTANDO') bot.push(`<button class="btn btn-secondary" onclick="stAbrirConteo('${esc(s.id)}')">Pistolear</button>`);
  if(!r.cerrado) bot.push(`<button class="btn btn-secondary" onclick="stVerResultado('${esc(s.id)}')">Actualizar</button>`);
  bot.push(`<button class="btn btn-primary" onclick="stExportar(['${esc(s.id)}'])">Exportar Excel (Zeppelin)</button>`);
  document.getElementById('stResBotones').innerHTML=bot.join('');

  const abierto=!r.cerrado;
  document.getElementById('stZonaAbierto').style.display=abierto?'block':'none';
  document.getElementById('stZonaCierre').style.display=abierto&&s.estado==='REVISION'&&YO.rol==='admin'?'block':'none';
  document.getElementById('stZonaReparto').style.display=r.cerrado?'block':'none';
  document.getElementById('stZonaRubros').style.display=abierto?'block':'none';

  if(abierto){
    const z=r.resumen;
    renderCards('stResCards',[['Unidades sistema / físico',num(z.unidadesSistema)+' / '+num(z.unidadesFisico)],['Artículos faltantes',z.faltantes],['Artículos sobrantes',z.sobrantes],
      ['Faltante bruto',money(z.faltanteBrutoARS)],['Faltante real',money(z.faltanteRealARS)],['Faltante real USD',usd(z.faltanteRealUSD)],['Sobrante real',money(z.sobranteRealARS)],['Sin precio',z.sinPrecio]]);
    const fuera=(r.rubrosPresentes||[]).filter(x=>!x.incluido);
    const dentro=(r.rubrosPresentes||[]).filter(x=>x.incluido&&x.codigo);
    document.getElementById('stResRubros').innerHTML=`Se cuentan ${dentro.length} rubros`+(fuera.length?(fuera.length<=6?` · Fuera: ${esc(fuera.map(x=>x.nombre).join(', '))}`:` · ${fuera.length} rubros fuera (ver abajo)`):'')+(r.automatico?' (fundas sin rubros elegidos: entran los rubros pistoleados)':'');
    ST.rubrosRes=new Set((r.rubrosPresentes||[]).filter(x=>x.incluido&&x.codigo).map(x=>x.codigo));
    ST.rubrosPresentes=r.rubrosPresentes||[];
    stPintarRubrosRes();
    const acc=[];
    if(s.estado==='CONTANDO') acc.push(`<button class="btn btn-primary" onclick="stEstado('REVISION')">Terminar conteo → revisión</button>`);
    if(s.estado==='REVISION') acc.push(`<button class="btn btn-secondary" onclick="stEstado('CONTANDO')">Volver a contar</button>`);
    if(YO.rol==='admin') acc.push(`<button class="btn btn-danger" onclick="stEstado('ANULADO')">Anular stock</button>`);
    document.getElementById('stResAcciones').innerHTML=acc.join('');

    ST.resFaltantes=r.faltantes; ST.resSobrantes=r.sobrantes;
    stFiltrarRev();
    ST.man={Falt:r.faltantesDisponibles||[],Sobr:r.sobrantesDisponibles||[]};
    stPintarMan('Falt',true); stPintarMan('Sobr',true);
  } else {
    renderCards('stResCards',[['Faltante real',money(s.faltanteRealARS)],['Saldo de caja aplicado',money(s.saldoCajaAplicado)],
      ['Neto a descontar',money(s.netoARS)],['Neto a descontar USD',usd(s.netoUSD)],['Sobrante real',money(s.sobranteRealARS)],
      ['Saldo de caja que queda',money(s.saldoCajaRestante)],['Cerrado',s.fechaCierre]]);
    document.getElementById('stResRubros').innerHTML=s.fechaLimiteReclamo?'Reclamos de vendedores hasta el '+esc(s.fechaLimiteReclamo):'';
    document.getElementById('stResAcciones').innerHTML='';
    const marcados=new Set((r.descuentos||[]).map(d=>d.usuarioId));
    const sinReparto=!r.descuentos.length;
    document.getElementById('stEmpleados').innerHTML=(r.empleados||[]).map(e=>`<label class="chip"><input type="checkbox" value="${esc(e.id)}" ${marcados.has(e.id)||sinReparto?'checked':''}> ${esc(e.nombre)} <small>${esc(e.rol)}</small></label>`).join('')
      || '<span class="hint">No hay empleados cargados para esta sucursal (Configuración → Usuarios).</span>';
    renderTable('stTablaDescuentos',['Empleado','Descuento $','Descuento USD','Estado'],(r.descuentos||[]).map(d=>[d.nombre,money(d.montoARS),usd(d.montoUSD),d.estado]),'Todavía no se repartió.');
  }
  renderTable('stTablaReales',['Código','Artículo','Rubro','Cant. real','Precio','Total $','Total USD'],
    r.faltantesReales.map(f=>[f.codigo,f.nombre,f.rubro,num(f.cantidadReal),money(f.precioARS),money(f.totalARS),usd(f.totalUSD)]),'No queda faltante real.');
  stPintarFuera('stZonaMuerto','stMuertoInfo','stTablaMuerto',r.stockMuerto,r);
  stPintarFuera('stZonaNoCuenta','stNoCuentaInfo','stTablaNoCuenta',r.noCuenta,r);
  renderTable('stTablaCruces',['Faltante','Sobrante','Cant.','Motivo',''],(r.cruces||[]).map(c=>[c.faltante,c.sobrante,num(c.cantidad),c.motivo,
    c.manualId&&abierto?html(`<button class="btn-mini" onclick="stQuitarCruce('${esc(c.manualId)}')">Quitar</button>`):'']),'Sin cruces.');
}
// Filtro de la lista de revisión (rubro / subrubro / texto). Solo afecta la vista.
function stFilaRev(f,tipo){
  const val=tipo==='F'?Math.max(0,f.ajuste):Math.max(0,-f.ajuste);
  return [f.codigo,f.nombre,f.rubro,f.subrubro||'',num(f.sistema),num(f.contado),html(`<b>${num(Math.abs(f.diferenciaConteo))}</b>`),
    f.sinPrecio?html('<span class="warn">Sin precio</span>'):money(f.precioARS),money(Math.abs(f.diferenciaConteo)*f.precioARS),
    html(`<input type="number" min="0" step="1" value="${val||''}" placeholder="0" data-cod="${esc(f.codigo)}"> <input class="nota" value="${esc(f.nota||'')}" placeholder="Nota"> <button class="btn-mini" onclick="stGuardarRev(this,'${tipo}')">Guardar</button>`),
    html(`<b>${num(Math.abs(f.diferencia))}</b>`)];
}
function stFiltrarRev(){
  if(!ST.filtroRev) ST.filtroRev={q:'',rubro:'',sub:''};
  const F=ST.filtroRev, todos=[...(ST.resFaltantes||[]),...(ST.resSobrantes||[])];
  const q=document.getElementById('stFiltQ'), sr=document.getElementById('stFiltRubro'), ss=document.getElementById('stFiltSub');
  if(q.value!==F.q) q.value=F.q;
  const uniq=a=>[...new Set(a.filter(Boolean))].sort((x,y)=>String(x).localeCompare(String(y),'es'));
  const rubros=uniq(todos.map(f=>f.rubro));
  if(F.rubro&&!rubros.includes(F.rubro)) F.rubro='';
  const subs=uniq(todos.filter(f=>!F.rubro||f.rubro===F.rubro).map(f=>f.subrubro));
  if(F.sub&&!subs.includes(F.sub)) F.sub='';
  sr.innerHTML='<option value="">Todos los rubros</option>'+rubros.map(x=>`<option${x===F.rubro?' selected':''}>${esc(x)}</option>`).join('');
  ss.innerHTML='<option value="">Todos los subrubros</option>'+subs.map(x=>`<option${x===F.sub?' selected':''}>${esc(x)}</option>`).join('');
  const t=F.q.trim().toUpperCase();
  const pasa=f=>(!F.rubro||f.rubro===F.rubro)&&(!F.sub||f.subrubro===F.sub)&&(!t||String(f.codigo).toUpperCase().includes(t)||String(f.nombre).toUpperCase().includes(t));
  const fa=(ST.resFaltantes||[]).filter(pasa), so=(ST.resSobrantes||[]).filter(pasa);
  const tot=l=>l.reduce((s,f)=>s+Math.abs(f.diferencia)*f.precioARS,0);
  const filtrando=F.q||F.rubro||F.sub;
  // Con un rubro o subrubro elegido, el admin lo puede sacar del conteo desde acá.
  const bm=document.getElementById('stFiltAcciones');
  let g=null;
  if(F.sub){ const f=todos.find(x=>x.subrubro===F.sub&&x.subrubroCod); if(f) g={nivel:'SUBRUBRO',codigo:f.subrubroCod,nombre:F.sub}; }
  else if(F.rubro){ const rp=(ST.rubrosPresentes||[]).find(x=>x.nombre===F.rubro&&x.codigo); const f=todos.find(x=>x.rubro===F.rubro&&x.rubroCod);
    const c=rp?rp.codigo:(f?f.rubroCod:''); if(c) g={nivel:'RUBRO',codigo:c,nombre:F.rubro}; }
  const puede=g&&YO.rol==='admin';
  bm.style.display=puede?'flex':'none';
  bm.innerHTML=puede?(()=>{ const a=`'${g.nivel}','${encodeURIComponent(g.codigo)}','${encodeURIComponent(g.nombre)}'`, que=(g.nivel==='RUBRO'?'rubro ':'subrubro ')+esc(g.nombre);
    return `<button type="button" class="btn btn-secondary" onclick="stMarcarGrupo(${a},'NUNCA')">No contar ${que}</button>
      <button type="button" class="btn btn-danger" onclick="stMarcarGrupo(${a},'MUERTO')">Mandar ${que} a stock muerto</button>
      <span class="hint">Deja de contarse en este stock y en los próximos.</span>`; })():'';
  document.getElementById('stFiltInfo').innerHTML=filtrando?`Mostrando ${fa.length} de ${(ST.resFaltantes||[]).length} faltantes (${money(tot(fa))} final) y ${so.length} de ${(ST.resSobrantes||[]).length} sobrantes (${money(tot(so))} final)`:'';
  const cab=x=>['Código','Artículo','Rubro','Subrubro','Sistema','Contado',x,'Precio','Total',x==='Falta'?'Apareció / nota':'De más / nota',x+' final'];
  renderTable('stTablaFaltantes',cab('Falta'),fa.map(f=>stFilaRev(f,'F')),filtrando?'Nada con ese filtro.':'No hay faltantes.');
  renderTable('stTablaSobrantes',cab('Sobra'),so.map(f=>stFilaRev(f,'S')),filtrando?'Nada con ese filtro.':'No hay sobrantes.');
}
function stMarcarGrupo(nivel,cod,nombre,destino){
  cod=decodeURIComponent(cod); nombre=decodeURIComponent(nombre);
  const que=(nivel==='RUBRO'?'el rubro ':'el subrubro ')+nombre;
  const msg={NUNCA:`¿No contar ${que}? Pasa a "No se cuenta" (en este stock y en los próximos).`,
    MUERTO:`¿Mandar ${que} a stock muerto? No se cuenta ni se descuenta (en este stock y en los próximos).`,
    CONTAR:`¿Volver a contar ${que}?`}[destino];
  if(!confirm(msg)) return;
  api('marcarGrupo',ST.res.stock.id,nivel,cod,destino).then(r=>{
    if(nivel==='RUBRO'){ const m=new Set(ST.rubrosMuertos||[]), n=new Set(ST.rubrosNunca||[]); m.delete(cod); n.delete(cod);
      if(destino==='MUERTO') m.add(cod); if(destino==='NUNCA') n.add(cod); ST.rubrosMuertos=[...m]; ST.rubrosNunca=[...n]; }
    if(destino!=='CONTAR') ST.filtroRev={q:'',rubro:'',sub:''};
    toast({NUNCA:nombre+' no se cuenta',MUERTO:nombre+' pasó a stock muerto',CONTAR:nombre+' vuelve a contarse'}[destino]); stPintarResultado(r);
  }).catch(errorUI);
}
function stPintarFuera(zona,info,tabla,m,r){
  m=m||{items:[],grupos:[],resumen:{}};
  document.getElementById(zona).style.display=m.items.length?'block':'none';
  if(!m.items.length) return;
  const z=m.resumen, puede=!r.cerrado&&YO.rol==='admin';
  document.getElementById(info).innerHTML=`${num(z.articulos)} artículos · ${num(z.unidades)} unidades · <b>${money(z.totalARS)}</b> (${usd(z.totalUSD)}) a lista 8${z.sinPrecio?' · '+z.sinPrecio+' sin precio':''}`
    +`<div class="chips" style="margin-top:6px">${(m.grupos||[]).map(g=>`<span class="chip">${g.nivel==='RUBRO'?'Rubro':'Subrubro'} ${esc(g.nombre)}<small>${num(g.unidades)} u. · ${money(g.totalARS)}</small>${puede?` <button type="button" class="btn-mini" onclick="stMarcarGrupo('${g.nivel}','${encodeURIComponent(g.codigo)}','${encodeURIComponent(g.nombre)}','CONTAR')">Volver a contar</button>`:''}</span>`).join('')}</div>`;
  renderTable(tabla,['Código','Artículo','Rubro','Subrubro','Por','Stock sistema','Precio','Total $','Total USD'],
    m.items.map(i=>[i.codigo,i.nombre,i.rubro,i.subrubro||'',i.grupo,num(i.stock),i.precioARS?money(i.precioARS):html('<span class="warn">Sin precio</span>'),money(i.totalARS),usd(i.totalUSD)]),'');
}
function stFiltroSet(k,v){ if(!ST.filtroRev) ST.filtroRev={q:'',rubro:'',sub:''}; ST.filtroRev[k]=v; if(k==='rubro') ST.filtroRev.sub=''; stFiltrarRev(); }
function stLimpiarFiltroRev(){ ST.filtroRev={q:'',rubro:'',sub:''}; document.getElementById('stFiltQ').value=''; stFiltrarRev(); }
function stPintarRubrosRes(){
  document.getElementById('stResRubrosChips').innerHTML=(ST.rubrosPresentes||[]).filter(x=>x.codigo).map(x=>
    `<button type="button" class="chip${ST.rubrosRes.has(x.codigo)?' active':''}" onclick="stToggleRubroRes('${encodeURIComponent(x.codigo)}')">${esc(x.nombre)}${x.muerto?' <small>(stock muerto)</small>':''}<small>${num(x.articulos)} art. · ${num(x.unidadesSistema)} u.</small></button>`).join('')
    ||'<span class="hint">No hay rubros en este stock.</span>';
}
function stToggleRubroRes(c){ c=decodeURIComponent(c); ST.rubrosRes.has(c)?ST.rubrosRes.delete(c):ST.rubrosRes.add(c); stPintarRubrosRes(); }
function stAplicarRubros(){
  const todos=(ST.rubrosPresentes||[]).filter(x=>x.codigo).map(x=>x.codigo);
  const inc=todos.filter(c=>ST.rubrosRes.has(c)), exc=todos.filter(c=>!ST.rubrosRes.has(c));
  api('actualizarRubrosStock',ST.res.stock.id,inc,exc).then(r=>{ toast('Rubros actualizados'); stPintarResultado(r); }).catch(errorUI);
}
function stGuardarRev(btn,tipo){
  const ins=btn.closest('tr').querySelectorAll('input');
  const n=Math.max(0,Number(ins[0].value)||0);
  btn.textContent='...';
  api('guardarRevision',ST.res.stock.id,ins[0].dataset.cod,tipo==='F'?n:-n,ins[1].value).then(stPintarResultado).catch(e=>{ btn.textContent='Guardar'; errorUI(e); });
}
// Cruce manual: buscador por código/nombre y filtro por rubro para cada lista.
function stPintarMan(k,reset){
  const lista=(ST.man&&ST.man[k])||[], q=document.getElementById('stMan'+k+'Q'), rs=document.getElementById('stMan'+k+'R'), sel=document.getElementById('stMan'+k);
  const elegido=sel.value;
  if(reset){ const ant=rs.value; const rubros=[...new Set(lista.map(x=>x.rubro).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
    rs.innerHTML='<option value="">Todos los rubros</option>'+rubros.map(x=>`<option${x===ant?' selected':''}>${esc(x)}</option>`).join(''); }
  const t=q.value.trim().toUpperCase(), rb=rs.value;
  const vis=lista.filter(x=>(!rb||x.rubro===rb)&&(!t||String(x.codigo).toUpperCase().includes(t)||String(x.nombre).toUpperCase().includes(t)));
  sel.innerHTML=vis.map(x=>`<option value="${esc(x.codigo)}"${x.codigo===elegido?' selected':''}>${esc(x.nombre)} · ${esc(x.codigo)} · ${esc(x.rubro)} (disp. ${num(x.cantidad)})</option>`).join('')
    ||`<option value="">${lista.length?'Nada con ese filtro':(k==='Falt'?'Sin faltantes':'Sin sobrantes')}</option>`;
  if(!sel.value&&vis.length) sel.selectedIndex=0;
}
function stAgregarCruce(){
  const f=document.getElementById('stManFalt').value, s=document.getElementById('stManSobr').value;
  if(!f||!s) return toast('Elegí un faltante y un sobrante',true);
  api('agregarCruceManual',ST.res.stock.id,f,s,document.getElementById('stManCant').value,document.getElementById('stManRecordar').checked)
    .then(r=>{ toast('Cruce agregado'); stPintarResultado(r); }).catch(errorUI);
}
function stQuitarCruce(id){ api('quitarCruceManual',ST.res.stock.id,id).then(stPintarResultado).catch(errorUI); }
function stEstado(estado){
  const txt={REVISION:'¿Terminar el conteo y pasar a revisión? Se puede volver a contar.',CONTANDO:'¿Volver a habilitar el conteo?',ANULADO:'¿Anular este stock? No se puede deshacer.'}[estado];
  if(!confirm(txt)) return;
  api('cambiarEstadoStock',ST.res.stock.id,estado).then(()=>estado==='ANULADO'?stVolver():stVerResultado(ST.res.stock.id)).catch(errorUI);
}
// ---------- exportar a Excel para cargar en Zeppelin ----------
// Hojas: PARA ZEPPELIN (código, nombre, cantidad, faltante/sobrante, precio),
// FALTANTE A DESCONTAR (después de cruces) y RESUMEN (totales y reparto).
function stExportarSeleccionados(){
  const ids=[...document.querySelectorAll('.stSel:checked')].map(x=>x.value);
  if(!ids.length) return toast('Marcá uno o más stocks',true);
  stExportar(ids);
}
async function stExportar(ids){
  toast('Armando el Excel...');
  try{
    const d=await api('exportarParaZeppelin',ids);
    const etiqueta=s=>`${s.sucursal} ${s.vuelta} ${s.tipo}`;
    const agrupar=tipo=>{
      const m={};
      d.stocks.forEach(x=>x.items.filter(i=>i.tipo===tipo).forEach(i=>{
        const k=i.codigo;
        if(!m[k]) m[k]={ARTICULO:i.codigo,CANTIDAD:0,NOMBRE:i.nombre,RUBRO:i.rubro,PRECIO_ARS:i.precioARS,TOTAL_ARS:0,STOCK:new Set()};
        m[k].CANTIDAD+=i.cantidad; m[k].TOTAL_ARS+=i.cantidad*i.precioARS; m[k].STOCK.add(etiqueta(x.stock));
      }));
      return Object.values(m).map(x=>Object.assign(x,{STOCK:[...x.STOCK].join(' + ')})).sort((a,b)=>String(a.NOMBRE).localeCompare(String(b.NOMBRE),'es'));
    };
    const hoja=(filas,cols)=>{ const ws=XLSX.utils.json_to_sheet(filas.length?filas:[{CODIGO:'(sin artículos)'}]); ws['!cols']=cols.map(w=>({wch:w})); return ws; };
    const wb=XLSX.utils.book_new();
    const falt=agrupar('FALTANTE'), sobr=agrupar('SOBRANTE');
    // Hoja principal para cargar en Zeppelin: solo código, nombre, cantidad, tipo y precio.
    const zeppelin=falt.map(x=>({CODIGO:x.ARTICULO,NOMBRE:x.NOMBRE,CANTIDAD:x.CANTIDAD,TIPO:'FALTANTE',PRECIO:x.PRECIO_ARS}))
      .concat(sobr.map(x=>({CODIGO:x.ARTICULO,NOMBRE:x.NOMBRE,CANTIDAD:x.CANTIDAD,TIPO:'SOBRANTE',PRECIO:x.PRECIO_ARS})));
    XLSX.utils.book_append_sheet(wb,hoja(zeppelin,[18,44,10,11,12]),'PARA ZEPPELIN');
    const reales=[]; d.stocks.forEach(x=>x.reales.forEach(i=>reales.push({STOCK:etiqueta(x.stock),ARTICULO:i.codigo,NOMBRE:i.nombre,RUBRO:i.rubro,CANTIDAD:i.cantidadReal,PRECIO_ARS:i.precioARS,TOTAL_ARS:i.totalARS,TOTAL_USD:i.totalUSD})));
    XLSX.utils.book_append_sheet(wb,hoja(reales,[24,18,42,22,10,12,14,12]),'FALTANTE A DESCONTAR');
    const res=d.stocks.map(x=>({SUCURSAL:x.stock.sucursal,VUELTA:x.stock.vuelta,TIPO:x.stock.tipo,FECHA:x.stock.fecha,ESTADO:x.stock.estado,
      FALTANTE_REAL_ARS:x.resumen.faltanteRealARS,FALTANTE_REAL_USD:x.resumen.faltanteRealUSD,SALDO_CAJA_APLICADO:x.resumen.saldoCajaAplicado||0,
      NETO_A_DESCONTAR_ARS:x.resumen.netoARS!==undefined?x.resumen.netoARS:x.resumen.faltanteRealARS,NETO_A_DESCONTAR_USD:x.resumen.netoUSD!==undefined?x.resumen.netoUSD:x.resumen.faltanteRealUSD,
      SOBRANTE_REAL_ARS:x.resumen.sobranteRealARS,SOBRANTE_REAL_USD:x.resumen.sobranteRealUSD}));
    const sum=k=>+res.reduce((t,x)=>t+Number(x[k]||0),0).toFixed(2);
    res.push({SUCURSAL:'TOTAL',FALTANTE_REAL_ARS:sum('FALTANTE_REAL_ARS'),FALTANTE_REAL_USD:sum('FALTANTE_REAL_USD'),SALDO_CAJA_APLICADO:sum('SALDO_CAJA_APLICADO'),
      NETO_A_DESCONTAR_ARS:sum('NETO_A_DESCONTAR_ARS'),NETO_A_DESCONTAR_USD:sum('NETO_A_DESCONTAR_USD'),
      SOBRANTE_REAL_ARS:res.reduce((t,x)=>t+Number(x.SOBRANTE_REAL_ARS||0),0),SOBRANTE_REAL_USD:+res.reduce((t,x)=>t+Number(x.SOBRANTE_REAL_USD||0),0).toFixed(2)});
    const fuera=k=>{ const o=[]; d.stocks.forEach(x=>(x[k]||[]).forEach(i=>o.push({STOCK:etiqueta(x.stock),CODIGO:i.codigo,NOMBRE:i.nombre,RUBRO:i.rubro,SUBRUBRO:i.subrubro||'',POR:i.grupo||'',STOCK_SISTEMA:i.stock,PRECIO_USD:i.precioUSD,PRECIO_ARS:i.precioARS,TOTAL_ARS:i.totalARS,TOTAL_USD:i.totalUSD}))); return o; };
    const muerto=fuera('muerto'), noCuenta=fuera('noCuenta');
    const wsR=XLSX.utils.json_to_sheet(res);
    const desc=[]; d.stocks.forEach(x=>x.descuentos.forEach(z=>desc.push({STOCK:etiqueta(x.stock),EMPLEADO:z.nombre,DESCUENTO_ARS:z.montoARS,DESCUENTO_USD:z.montoUSD,ESTADO:z.estado})));
    if(desc.length){
      // Total por empleado sumando todos los stocks exportados.
      const porEmp={}; desc.forEach(z=>{ porEmp[z.EMPLEADO]=porEmp[z.EMPLEADO]||{STOCK:'TOTAL',EMPLEADO:z.EMPLEADO,DESCUENTO_ARS:0,DESCUENTO_USD:0,ESTADO:''}; porEmp[z.EMPLEADO].DESCUENTO_ARS+=z.DESCUENTO_ARS; porEmp[z.EMPLEADO].DESCUENTO_USD=+(porEmp[z.EMPLEADO].DESCUENTO_USD+z.DESCUENTO_USD).toFixed(2); });
      XLSX.utils.sheet_add_aoa(wsR,[[''],['DESCUENTOS POR EMPLEADO']],{origin:-1});
      XLSX.utils.sheet_add_json(wsR,desc.concat(Object.values(porEmp)),{origin:-1});
    }
    wsR['!cols']=[{wch:24},{wch:18},{wch:16},{wch:14},{wch:12},{wch:18},{wch:18},{wch:18},{wch:20},{wch:20},{wch:18},{wch:18}];
    XLSX.utils.book_append_sheet(wb,wsR,'RESUMEN');
    if(muerto.length) XLSX.utils.book_append_sheet(wb,hoja(muerto,[24,18,42,22,22,26,12,10,12,14,12]),'STOCK MUERTO');
    if(noCuenta.length) XLSX.utils.book_append_sheet(wb,hoja(noCuenta,[24,18,42,22,22,26,12,10,12,14,12]),'NO SE CUENTA');
    const s0=d.stocks[0].stock;
    const nombre=`Zeppelin_${s0.sucursal}_${s0.vuelta}_${[...new Set(d.stocks.map(x=>x.stock.tipo))].join('+')}.xlsx`.replace(/[^\w.+\-]/g,'_');
    XLSX.writeFile(wb,nombre);
    toast(`Excel listo: ${falt.length} faltantes y ${sobr.length} sobrantes`);
  }catch(e){ errorUI(e); }
}

// ---------- cierre con comprobantes ----------
async function stLeerComprobantes(){
  const file=document.getElementById('stArchivoComp').files[0];
  const st=document.getElementById('stCompEstado'); ST.comp=null;
  document.getElementById('stCompFechaBox').style.display='none';
  if(!file){ st.textContent=''; return; }
  st.textContent='Leyendo...';
  try{
    const filas=await leerArchivo(file);
    const k={c:columna(filas[0],['COMPROBA','COMPROBANTE']),a:columna(filas[0],['ARTICULO']),v:columna(filas[0],['VENTA']),u:columna(filas[0],['COSTO']),f:columna(filas[0],['FECHA'])};
    if(!k.a||!k.v) throw new Error('El archivo necesita las columnas ARTICULO y VENTA.');
    const fechaTxt=v=>{ if(v instanceof Date) return v.toISOString().slice(0,10); if(typeof v==='number'){ const d=XLSX.SSF.parse_date_code(Math.round(v)); return d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:String(v);} return String(v||'').slice(0,10); };
    ST.comp=filas.filter(f=>!k.c||/AFB2|ACB2/i.test(String(f[k.c]))).map(f=>({ARTICULO:f[k.a],VENTA:f[k.v],COSTO:k.u?f[k.u]:0,FECHA:k.f?fechaTxt(f[k.f]):'',COMP:k.c?String(f[k.c]):''}));
    const fechas=[...new Set(ST.comp.map(x=>x.FECHA))].sort().reverse();
    document.getElementById('stCompFecha').innerHTML=fechas.map(f=>`<option value="${esc(f)}">${esc(f||'(sin fecha)')} · ${ST.comp.filter(x=>x.FECHA===f).length} líneas</option>`).join('');
    document.getElementById('stCompFechaBox').style.display=fechas.length>1?'block':'none';
    stResumenComp();
  }catch(e){ st.textContent=e.message; ST.comp=null; }
}
function stResumenComp(){
  if(!ST.comp) return;
  const f=document.getElementById('stCompFecha').value;
  const l=ST.comp.filter(x=>!f||x.FECHA===f);
  document.getElementById('stCompEstado').textContent=`${l.length} líneas de AFB2/ACB2 (${l.filter(x=>/AFB2/i.test(x.COMP)).length} faltantes, ${l.filter(x=>/ACB2/i.test(x.COMP)).length} sobrantes). Sus precios reemplazan a la lista.`;
}
function stCerrar(){
  if(!confirm('¿Cerrar el stock? Ya no se podrá modificar el conteo ni la revisión.')) return;
  let precios=[];
  if(ST.comp){ const f=document.getElementById('stCompFecha').value; precios=ST.comp.filter(x=>!f||x.FECHA===f).map(x=>({ARTICULO:x.ARTICULO,VENTA:x.VENTA,COSTO:x.COSTO})); }
  api('cerrarStock',ST.res.stock.id,precios).then(r=>{ toast('Stock cerrado. Faltante real '+money(r.resumen.faltanteRealARS)+(r.resumen.saldoCajaAplicado?' − caja '+money(r.resumen.saldoCajaAplicado):'')+' = neto '+money(r.resumen.netoARS)); cajaCargar(); document.getElementById('stArchivoComp').value=''; ST.comp=null; stVerResultado(ST.res.stock.id); }).catch(errorUI);
}
function stRepartir(){
  const ids=[...document.querySelectorAll('#stEmpleados input:checked')].map(x=>x.value);
  if(!ids.length) return toast('Marcá al menos un empleado',true);
  api('repartirDescuento',ST.res.stock.id,ids).then(r=>{ toast('Reparto guardado'); stPintarResultado(r); }).catch(errorUI);
}

// Cuando vuelve internet, manda lo pendiente.
window.addEventListener('online',()=>{ if(ST.stock&&!ST.local&&ST.cola.length) stEnviar(); });

// ---------- saldo a favor de caja ----------
function cajaIniciar(){
  const sel=document.getElementById('cajaSucursal');
  const sucs=[...document.getElementById('stSucursal').options].map(o=>o.value).filter(Boolean);
  const lista=sucs.length?sucs:(lsGet('st_sucursales')||[]);
  const actual=sel.value;
  sel.innerHTML=lista.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
  if(actual&&lista.includes(actual)) sel.value=actual;
  document.getElementById('cajaForm').style.display=YO.rol==='admin'?'block':'none';
  const f=document.getElementById('cajaFecha'); if(!f.value) f.value=hoyISO();
  if(lista.length) cajaCargar();
}
function cajaCargar(){
  const suc=document.getElementById('cajaSucursal').value; if(!suc) return;
  api('getCajaSucursal',suc).then(cajaPintar).catch(e=>{ if(!esSinConexion(e)) errorUI(e); });
}
function cajaPintar(c){
  renderCards('cajaCards',[['Saldo a favor actual',money(c.saldo)],['Sucursal',c.sucursal]]);
  renderTable('cajaTabla',['Fecha','Concepto','Ingreso','Aplicado / egreso','Saldo',''],c.movimientos.map(m=>[m.fecha,m.concepto,
    m.ingreso?money(m.ingreso):'-',m.egreso?money(m.egreso):'-',money(m.saldo),
    m.anulable&&YO.rol==='admin'?html(`<button class="btn-mini" onclick="cajaAnular('${esc(m.id)}')">Anular</button>`):'']),'Sin movimientos.');
}
function cajaAgregar(){
  const suc=document.getElementById('cajaSucursal').value;
  api('agregarMovimientoCaja',suc,document.getElementById('cajaFecha').value,document.getElementById('cajaImporte').value,
    document.getElementById('cajaDetalle').value,document.getElementById('cajaTipo').value)
    .then(c=>{ document.getElementById('cajaImporte').value=''; document.getElementById('cajaDetalle').value=''; toast('Movimiento cargado'); cajaPintar(c); })
    .catch(errorUI);
}
function cajaAnular(id){
  if(!confirm('¿Anular este movimiento de caja? Se recalculan los netos de los stocks.')) return;
  api('anularMovimientoCaja',id).then(c=>{ toast('Movimiento anulado'); cajaPintar(c); }).catch(errorUI);
}
