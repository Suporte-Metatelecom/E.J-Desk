/* =====================================================================
   E.J. Desk — camada de dados (Supabase)
   A tela continua a mesma do protótipo: ela trabalha com o objeto S em memória.
   Este arquivo:
     1. faz o login real (Supabase Auth);
     2. carrega os dados do banco para S (respeitando as permissões do servidor);
     3. depois de cada ação, compara S com a última versão salva e grava só o que mudou.
   As regras de negócio que importam (status, níveis, prazos) são conferidas de novo no
   servidor; se ele recusar, a tela recarrega os dados e mostra o motivo.
   ===================================================================== */
(function(){
"use strict";
const C = Object.assign({}, window.EJD_CONFIG || {});
// aceita o endereço copiado com "/rest/v1/" ou barra no fim: o cliente precisa só do endereço base
if(C.supabaseUrl) C.supabaseUrl = String(C.supabaseUrl).trim().replace(/\/(rest|auth|storage)\/v1\/?.*$/,"").replace(/\/+$/,"");
if(C.supabaseAnonKey) C.supabaseAnonKey = String(C.supabaseAnonKey).trim();
if(!C.supabaseUrl || !C.supabaseAnonKey || /COLE_AQUI/.test(C.supabaseUrl+C.supabaseAnonKey)){
  document.getElementById("root").innerHTML = `<div class="login"><div class="card stack" style="max-width:520px"><h2>Configuração pendente</h2><p class="small">Preencha <b>supabaseUrl</b> e <b>supabaseAnonKey</b> no arquivo <span class="mono">config.js</span>. No Supabase, use o botão <b>Connect</b> no topo do projeto, ou Project Settings › API Keys (chave publishable ou anon) e Project Settings › Data API (Project URL). Veja o Passo 6 do guia.</p></div></div>`;
  window.EJD_BLOQUEADO = true; return;
}
/* Link do convite / "esqueci a senha": guarda o endereço ANTES de criar o cliente (ele limpa o #… da URL).
   Atenção: o link traz "token_type=bearer" e "type=invite"; por isso o tipo é lido como parâmetro, não por busca de texto. */
const LINK0 = new URLSearchParams(location.hash.replace(/^#/,"")), BUSCA0 = new URLSearchParams(location.search);
const TIPO0 = LINK0.get("type") || BUSCA0.get("type") || "";
const ERRO0 = LINK0.get("error_code") || LINK0.get("error") || BUSCA0.get("error_code") || "";
const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
window.EJD_SB = sb;

const ms = v => v ? new Date(v).getTime() : null;
const iso = v => v==null ? null : new Date(v).toISOString();
const fmt = v => v ? fmtDataHora(new Date(v).getTime()) : "";
const clone = o => JSON.parse(JSON.stringify(o, (k,v)=> (k==="blob"||k==="url") ? undefined : v));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));
window.ejdUid = uid;

let BASE = null;              // última versão salva (para comparar)
let salvando = false, pendente = false, carregado = false;
const nomePorId = {}, idPorNome = {};

/* ---------------------------------------------------------------- login */
function telaLogin(msg, modo){
  modo = modo || "entrar";
  const t = {
    entrar: `<div class="field"><label for="lgEmail">E-mail corporativo</label><input class="in" id="lgEmail" type="email" autocomplete="username"></div>
      <div class="field"><label for="lgPass">Senha</label><input class="in" id="lgPass" type="password" autocomplete="current-password"></div>
      <span class="errtxt" id="lgErr">${msg?esc(msg):""}</span><button class="btn primary" style="justify-content:center">Entrar</button>
      <button type="button" class="linkbtn small" data-ejd="esqueci" style="align-self:flex-start">Esqueci a senha</button>`,
    esqueci: `<p class="small">Informe o seu e-mail. Você vai receber um link para criar uma nova senha.</p>
      <div class="field"><label for="lgEmail">E-mail corporativo</label><input class="in" id="lgEmail" type="email"></div>
      <span class="errtxt" id="lgErr">${msg?esc(msg):""}</span><button class="btn primary" style="justify-content:center">Enviar link</button>
      <button type="button" class="linkbtn small" data-ejd="voltar" style="align-self:flex-start">Voltar para o login</button>`,
    link: `<p class="small">${TIPO0==="recovery"?"Você pediu para criar uma nova senha.":"Você foi convidado para o E.J. Desk."} Clique no botão para continuar.</p>
      <span class="errtxt" id="lgErr">${msg?esc(msg):""}</span><button type="button" class="btn primary" data-ejd="verificar" style="justify-content:center">${TIPO0==="recovery"?"Continuar e criar nova senha":"Continuar e criar minha senha"}</button>`,
    senha: `<p class="small">Crie a sua senha de acesso ao E.J. Desk (mínimo de 8 caracteres).</p>
      <div class="field"><label for="lgPass">Nova senha</label><input class="in" id="lgPass" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="lgPass2">Repita a senha</label><input class="in" id="lgPass2" type="password" autocomplete="new-password"></div>
      <span class="errtxt" id="lgErr">${msg?esc(msg):""}</span><button class="btn primary" style="justify-content:center">Salvar senha e entrar</button>`
  }[modo];
  document.getElementById("root").innerHTML = `<div class="login"><form class="card stack" id="fEjdLogin" data-modo="${modo}" novalidate>
    <div class="brand" style="padding:0"><div class="mark">EJ</div><div><b style="color:var(--ink)">E.J. Desk</b><small style="color:var(--muted)">Central de chamados e suporte técnico</small></div></div>
    ${t}</form></div>`;
  setTimeout(()=>document.querySelector("#fEjdLogin input")?.focus(),0);
}
window.ejdTelaLogin = telaLogin;

document.addEventListener("click", e=>{
  const b=e.target.closest("[data-ejd]"); if(!b) return;
  if(b.dataset.ejd==="esqueci") telaLogin("", "esqueci");
  if(b.dataset.ejd==="verificar"){ verificarLink(b); return; }
  if(b.dataset.ejd==="voltar") telaLogin("", "entrar");
}, true);

document.addEventListener("submit", async e=>{
  const f=e.target; if(f.id!=="fEjdLogin") return;
  e.preventDefault(); e.stopImmediatePropagation();
  const err=f.querySelector("#lgErr"), modo=f.dataset.modo, bt=f.querySelector("button.btn");
  const email=f.querySelector("#lgEmail")?.value.trim().toLowerCase();
  bt.disabled=true;
  try{
    if(modo==="entrar"){
      const {error}=await sb.auth.signInWithPassword({email, password:f.querySelector("#lgPass").value});
      if(error){ err.textContent = /invalid/i.test(error.message) ? "E-mail ou senha incorretos." : error.message; return; }
      await entrar();
    } else if(modo==="esqueci"){
      const {error}=await sb.auth.resetPasswordForEmail(email, {redirectTo: location.origin+location.pathname});
      err.textContent = error ? error.message : "Se o e-mail estiver cadastrado, o link chega em alguns minutos.";
    } else if(modo==="senha"){
      const p1=f.querySelector("#lgPass").value, p2=f.querySelector("#lgPass2").value;
      if(p1.length<8){ err.textContent="A senha precisa ter pelo menos 8 caracteres."; return; }
      if(p1!==p2){ err.textContent="As duas senhas não são iguais."; return; }
      const {error}=await sb.auth.updateUser({password:p1});
      if(error){ err.textContent=error.message; return; }
      history.replaceState(null,"",location.pathname); await entrar();
    }
  } finally { bt.disabled=false; }
}, true);

/* ------------------------------------------------------------ carregar */
async function q(p){ const {data,error}=await p; if(error) throw error; return data; }

/* partes (Algar, Arqia, Links Field): o banco não guarda a ordem dos campos; volta na ordem da tela */
const ordemPartes = (op, p) => { const nomes=(typeof PARTES_OP!=="undefined"&&PARTES_OP[op])||Object.keys(p); const o={}; nomes.forEach(n=>{ if(n in p) o[n]=p[n]; }); Object.keys(p).forEach(n=>{ if(!(n in o)) o[n]=p[n]; }); return o; };
/* Registro de chamados: banco <-> tela */
const rcDoBanco = r => ({ id:r.id, em:fmt(r.criado_em), usuario:r.usuario||"", cliente:r.cliente, doc:r.doc, operadora:r.operadora, chips:r.chips||[],
  rede:r.rede||"", equip:r.equipamento, sms:r.recebe_sms||"", regiao:r.regiao||"", comandos:r.comandos||"",
  ...(r.editado_em ? {editadoPor:r.editado_por||"", editadoEm:fmt(r.editado_em)} : {}) });
const rcParaBanco = r => ({ cliente:r.cliente, doc:r.doc, operadora:r.operadora, chips:r.chips||[], rede:r.rede||null, equipamento:r.equip,
  recebe_sms:r.sms||null, regiao:r.regiao||"", comandos:r.comandos||"" });

async function carregar(){
  const [perfis, cfg, clientes, chamados, hist, coms, anx, base, regs, rcs, recs] = await Promise.all([
    q(sb.from("perfis").select("*").order("criado_em")),
    q(sb.from("config").select("*")),
    q(sb.from("clientes").select("*").order("nome")),
    q(sb.from("chamados").select("*").order("criado_em",{ascending:false})),
    q(sb.from("historico").select("*").order("id")),
    q(sb.from("comentarios").select("*").order("id")).catch(()=>[]),     // Bronze não lê comentários
    q(sb.from("anexos").select("*").order("em")),
    q(sb.from("inc_base").select("*")),
    q(sb.from("inc_registros").select("*").order("dia")),
    q(sb.from("registro_chamados").select("*").order("criado_em",{ascending:false})).catch(e=>{ console.warn("registro_chamados:", e); return []; }),   // antes do 003: lista vazia
    q(sb.from("recados_comercial").select("*").order("id")).catch(e=>{ console.warn("recados_comercial:", e); return []; })           // antes do 007: sem recados
  ]);
  for(const k in nomePorId) delete nomePorId[k];
  for(const k in idPorNome) delete idPorNome[k];
  perfis.forEach(p=>{ nomePorId[p.id]=p.nome; idPorNome[p.nome]=p.id; });
  const ano=new Date().getFullYear();
  S.users = perfis.map(p=>({ id:p.id, nome:p.nome, email:p.email, setor:p.setor, nivel:p.nivel, ativo:true, cargo:p.cargo||"Suporte",
    acum: chamados.filter(c=>c.resolvido_por===p.id && c.resolvido_em && new Date(c.resolvido_em).getFullYear()===ano).length,
    foto: p.foto||undefined, ...(p.admissao?{admissao:String(p.admissao).slice(0,10)}:{}), ...(p.status?{status:p.status, statusEm:fmt(p.status_em)}:{}), desativado: p.desativado_em ? {por:p.desativado_por||"", em:fmt(p.desativado_em)} : undefined }));

  const cf = Object.fromEntries(cfg.map(r=>[r.chave, r.valor]));
  if(Array.isArray(cf.casos)) CASOS.splice(0, CASOS.length, ...cf.casos);
  if(Array.isArray(cf.categorias)) CATEGORIAS.splice(0, CATEGORIAS.length, ...cf.categorias);
  S.sla = cf.sla || {};
  S.insModelo = typeof cf.insignias==="string" ? cf.insignias : "original";   // 02/10: modelo das insígnias (Diamante escolhe)
  if(cf.email){ S.noreply = cf.email.noreply || S.noreply; S.replyTo = cf.email.replyTo || S.replyTo; }

  S.clientes = clientes.map(c=>({id:c.id, nome:c.nome, doc:c.doc, email:c.email, tel:c.tel||""}));

  const porCh = (lista) => { const m={}; lista.forEach(x=>{(m[x.chamado_id]=m[x.chamado_id]||[]).push(x)}); return m; };
  const H=porCh(hist), CM=porCh(coms), AX=porCh(anx), RC=porCh(recs);
  const caminhos = anx.map(a=>a.caminho);
  let assinadas = {};
  if(caminhos.length){
    const {data} = await sb.storage.from("anexos").createSignedUrls(caminhos, 60*60*8);
    (data||[]).forEach(d=>{ if(d.signedUrl) assinadas[d.path]=d.signedUrl; });
  }
  // 02/10: chamados de cliente excluído guardam o cadastro em cliente_ref (nome, CNPJ/CPF, e-mail)
  S.cliExcl = {}; chamados.forEach(c=>{ if(!c.cliente_id && c.cliente_ref && c.cliente_ref.id) S.cliExcl[c.cliente_ref.id] = c.cliente_ref; });
  S.exclusoesCli = [];
  S.tickets = chamados.map(c=>T({
    id:c.id, titulo:c.titulo, cat:c.categoria, prioridade:c.prioridade, status:c.status, setor:c.setor,
    resp: c.responsavel_id ? (nomePorId[c.responsavel_id]||"—") : "—",
    criadoPor: nomePorId[c.criado_por]||"", quemAbriu:c.quem_abriu||"", cliente:c.cliente_id||(c.cliente_ref&&c.cliente_ref.id)||null, caso:c.caso||"",
    bo:c.bo||"", protAt:c.protocolo||"", cep:c.cep||"", equip:c.equipamentos||"", comandos:c.comandos||"", feito:c.feito||"", linha:c.linha||"",
    flags:{atrasado:!!c.atrasado, atipico:!!c.atipico}, solucao:c.solucao||null, obs:c.obs||"",
    pausas:c.pausas||[], encerraEm:ms(c.encerra_em), encerradoAuto:!!c.encerrado_auto, rascunho:c.rascunho||null,
    vinculadoA:c.vinculado_a||undefined, unificados:(c.unificados&&c.unificados.length)?c.unificados:undefined, excluido:c.excluido||null,
    aberto:fmt(c.criado_em), criadoEmMs:ms(c.criado_em), resolvidoEmMs:ms(c.resolvido_em), resolvidoPor:nomePorId[c.resolvido_por]||"",
    hist:(H[c.id]||[]).map(h=>[fmt(h.em), h.texto]),
    notasCom:(RC[c.id]||[]).map(m=>({a:m.autor_nome||nomePorId[m.autor]||"", t:fmt(m.em), txt:m.texto})),
    coments:(CM[c.id]||[]).map(m=>({a:m.autor_nome||nomePorId[m.autor]||"", t:fmt(m.em), txt:m.texto, anexos:m.anexos||[]})),
    anexos:(AX[c.id]||[]).map(a=>a.nome),
    arqs:(AX[c.id]||[]).map(a=>({id:a.id, nome:a.nome, tipo:tipoArq(a.nome), tam:a.tamanho||0, caminho:a.caminho, url:assinadas[a.caminho]||"", por:a.enviado_por||"", em:fmt(a.em), txt:null})),
    retornos:[]
  }));

  S.incBase = Object.fromEntries(base.map(b=>[b.operadora, b.linhas]));
  const ult = base.slice().sort((a,b)=>ms(b.atualizado_em)-ms(a.atualizado_em))[0];
  S.incBaseEm = ult ? fmt(ult.atualizado_em) : null; S.incBasePor = ult ? ult.atualizado_por : null;
  S.incidentes = regs.map(r=>({ id:r.id, dia:r.dia, turno:r.turno, em:fmt(r.em), operadora:r.operadora, linhas:r.linhas, base:r.base,
    nivel:r.nivel||undefined, obs:r.obs||"", por:r.por||"", corr:r.correcoes||[], ...(r.partes?{partes:ordemPartes(r.operadora, r.partes)}:{}) }));
  S.incPlat = [];
  S.regCham = rcs.map(rcDoBanco);
  calcularPainel();
  BASE = foto();
  carregado = true;
}

/* Painel: números reais (antes eram ilustrativos) */
function calcularPainel(){
  const vis = S.tickets.filter(t=>!t.excluido);
  const cont = f => vis.filter(f).length;
  const n = {"Novos":cont(t=>t.status==="Novo"), "Em análise":cont(t=>t.status==="Em análise"), "Resolvidos":cont(t=>t.status==="Resolvido"),
    "Atrasados":cont(t=>t.flags.atrasado), "Atípicos":cont(t=>t.flags.atipico), "Total":vis.length};
  KPIS.forEach(k=>{ if(k.k in n) k.n=n[k.k]; });
  const semana = d => { const x=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())); const dia=x.getUTCDay()||7; x.setUTCDate(x.getUTCDate()+4-dia);
    const a=new Date(Date.UTC(x.getUTCFullYear(),0,1)); return String(Math.ceil(((x-a)/86400000+1)/7)); };
  for(const k in WEEKS) delete WEEKS[k];
  const hoje=new Date(); const ks=[];
  for(let i=3;i>=0;i--) ks.push(semana(new Date(hoje.getTime()-i*7*86400000)));
  ks.forEach(k=>{ WEEKS[k]={}; S.users.filter(u=>u.setor==="suporte"&&LV[u.nivel]>=LV.Ouro&&!u.desativado).forEach(u=>WEEKS[k][u.nome]=0); });
  vis.forEach(t=>{ if(!t.resolvidoEmMs||!t.resolvidoPor) return; const k=semana(new Date(t.resolvidoEmMs)); if(WEEKS[k]) WEEKS[k][t.resolvidoPor]=(WEEKS[k][t.resolvidoPor]||0)+1; });
  ks.forEach(k=>{ if(!Object.keys(WEEKS[k]).length) WEEKS[k]={"—":0}; });
  S.week = ks[ks.length-1];
}

function foto(){
  return clone({ users:S.users, casos:CASOS, categorias:CATEGORIAS, sla:S.sla||{}, email:{noreply:S.noreply, replyTo:S.replyTo},
    insModelo:S.insModelo||"original", clientes:S.clientes, tickets:S.tickets, incBase:S.incBase, incidentes:S.incidentes, regCham:S.regCham||[] });
}

/* --------------------------------------------------------------- salvar */
const CAMPOS = { titulo:"titulo", cat:"categoria", prioridade:"prioridade", status:"status", setor:"setor", quemAbriu:"quem_abriu", cliente:"cliente_id",
  caso:"caso", bo:"bo", protAt:"protocolo", cep:"cep", equip:"equipamentos", comandos:"comandos", feito:"feito", linha:"linha",
  solucao:"solucao", obs:"obs", rascunho:"rascunho", vinculadoA:"vinculado_a", unificados:"unificados", excluido:"excluido" };
const igual = (a,b) => JSON.stringify(a??null)===JSON.stringify(b??null);
function linhaChamado(t, antes){
  const row={};
  for(const [k,col] of Object.entries(CAMPOS)){
    if(antes && igual(t[k], antes[k])) continue;
    let v=t[k]; if(k==="cliente" && v && !S.clientes.some(c=>c.id===v)) continue;   // cliente excluído: o chamado fica sem cliente_id (o servidor guarda em cliente_ref)
    if(k==="unificados") v=v||[]; if(k==="vinculadoA") v=v||null; if(k==="solucao"&&v==="") v=null;
    row[col]=v===undefined?null:v;
  }
  if(!antes || t.resp!==antes.resp) row.responsavel_id = t.resp && t.resp!=="—" ? (idPorNome[t.resp]||null) : null;
  if(!antes || !igual(t.flags, antes.flags)){ row.atipico=!!t.flags.atipico; }
  return row;
}

async function enviarArquivo(chamadoId, a){
  const caminho = `${chamadoId}/${uid()}-${a.nome.replace(/[^\w.\-]+/g,"_")}`;
  const {error} = await sb.storage.from("anexos").upload(caminho, a.blob, {contentType: a.blob.type || undefined});
  if(error) throw new Error("Falha ao enviar "+a.nome+": "+error.message);
  await q(sb.from("anexos").insert({chamado_id:chamadoId, nome:a.nome, tipo:a.tipo, tamanho:a.tam, caminho, enviado_por:a.por}));
  a.caminho = caminho;
}

async function salvarChamado(t, antes, tS){
  const eco = (o) => { Object.assign(t, o); if(tS) Object.assign(tS, JSON.parse(JSON.stringify(o))); };
  // chamado novo: o servidor gera o número do protocolo
  if(!antes){
    const row = linhaChamado(t, null); delete row.status; delete row.responsavel_id; delete row.vinculado_a; delete row.excluido;
    const novo = await q(sb.from("chamados").insert(row).select().single());
    const antigoId = t.id; eco({id:novo.id, aberto:fmt(novo.criado_em), criadoEmMs:ms(novo.criado_em)});
    document.querySelectorAll(`[data-novo-id="${antigoId}"]`).forEach(el=>{ el.textContent=novo.id; el.removeAttribute("data-novo-id"); });   // aviso "Chamado aberto" mostra o número definitivo
    if(S.sel===antigoId){ S.sel=novo.id; S._skipHash=true; history.replaceState(null,"","#/chamado/"+novo.id); }
    if(S.retSel===antigoId) S.retSel=novo.id;
    if(t.hist.length) await q(sb.from("historico").insert(t.hist.map(h=>({chamado_id:t.id, texto:h[1].replace(antigoId,t.id)}))));
    t.hist.forEach(h=>h[1]=h[1].replace(antigoId,t.id)); if(tS) tS.hist.forEach(h=>h[1]=h[1].replace(antigoId,t.id));
    for(const a of (t.arqs||[])) if(a.blob){ await enviarArquivo(t.id, a); const aS=tS&&(tS.arqs||[]).find(x=>x.id===a.id); if(aS) aS.caminho=a.caminho; }
    toast("Chamado "+t.id+" aberto");
    return;
  }
  const row = linhaChamado(t, antes);
  if(Object.keys(row).length){
    const r = await q(sb.from("chamados").update(row).eq("id", t.id).select().single());
    eco({status:r.status, encerraEm:ms(r.encerra_em), pausas:r.pausas||[], encerradoAuto:!!r.encerrado_auto,
      resolvidoEmMs:ms(r.resolvido_em), resolvidoPor:nomePorId[r.resolvido_por]||"", resp:r.responsavel_id?(nomePorId[r.responsavel_id]||"—"):"—"});
  }
  const novosH = t.hist.slice(antes.hist.length);
  if(novosH.length) await q(sb.from("historico").insert(novosH.map(h=>({chamado_id:t.id, texto:h[1]}))));
  const novosRec = (t.notasCom||[]).slice((antes.notasCom||[]).length);
  if(novosRec.length) await q(sb.from("recados_comercial").insert(novosRec.map(m=>({chamado_id:t.id, texto:m.txt}))));
  const novosC = t.coments.slice(antes.coments.length);
  if(novosC.length) await q(sb.from("comentarios").insert(novosC.map(m=>({chamado_id:t.id, autor_nome:m.a, texto:m.txt, anexos:m.anexos||[]}))));
  const ja = new Set((antes.arqs||[]).map(a=>a.id));
  for(const a of (t.arqs||[]).filter(a=>!ja.has(a.id))){
    if(a.blob){ await enviarArquivo(t.id, a); const aS=tS&&(tS.arqs||[]).find(x=>x.id===a.id); if(aS) aS.caminho=a.caminho; }
    else if(a.caminho) await q(sb.from("anexos").insert({chamado_id:t.id, nome:a.nome, tipo:a.tipo, tamanho:a.tam, caminho:a.caminho, enviado_por:a.por}));  // unificação
  }
  // retorno enviado: fica na fila de e-mails até o endereço só de envio existir (item 37)
  const novosR = (t.retornos||[]).slice((antes.retornos||[]).length);
  if(novosR.length){
    await q(sb.from("emails_pendentes").insert(novosR.map(r=>({chamado_id:t.id, para:r.para, cc:r.cc||null, cco:r.cco||null, assunto:r.assunto, corpo:r.corpo}))));   // 02/10: Cc e Cco
    enviarFila();        // envia na hora (sem travar a tela); se falhar, fica na fila e é tentado de novo no próximo envio
  }
}

/* Dispara a função que envia os e-mails da fila (Gmail). O resultado aparece num aviso. */
async function enviarFila(){
  try{
    const {data, error} = await sb.functions.invoke("enviar-emails", {body:{}});
    if(error) throw error;
    if(data?.erro) throw new Error(data.erro);
    if(data?.enviados) toast(`E-mail de retorno enviado (${data.enviados})`);
    if(data?.erros) toast(`Não foi possível enviar ${data.erros} e-mail(s): ${(data.detalhes?.[0]?.erro||"").slice(0,120)}. Ele fica na fila e será tentado de novo.`);
  }catch(e){
    console.warn(e);
    toast("O retorno foi registrado, mas o e-mail não saiu agora: "+(e.message||e)+". Ele fica na fila e será tentado de novo.");
  }
}
window.ejdEnviarFila = enviarFila;

async function sincronizar(){
  if(!carregado || !BASE) return;
  if(salvando){ pendente=true; return; }
  salvando=true;
  const agoraS = foto(); const antesEco = JSON.stringify(agoraS); let mudouNoServidor = false;
  try{
    // unificação de clientes: feita no servidor (Prata ou acima), que move os chamados e apaga os duplicados
    if(S.unificacoes && S.unificacoes.length){
      const fila=S.unificacoes.splice(0);
      for(const u of fila) await q(sb.rpc("unificar_clientes", {principal:u.principal, duplicados:u.duplicados}));
      await carregar(); mudouNoServidor=true; return;
    }
    // usuários (convite, nível, setor, desativação, foto)
    const bu = Object.fromEntries(BASE.users.map(u=>[u.id,u]));
    for(const u of S.users){
      const a=bu[u.id];
      if(!a){                                             // convite
        const {data, error} = await sb.functions.invoke("convidar-usuario", {body:{email:u.email, nome:u.nome, nivel:u.nivel, setor:u.setor, redirectTo:location.origin+location.pathname}});
        if(error || data?.erro) throw new Error("Convite não enviado: "+(data?.erro || error.message || "publique a função convidar-usuario"));
        toast("Convite enviado para "+u.email); pendente=true; carregado=false; await carregar(); carregado=true; salvando=false; render(); return;
      }
      const row={};
      if(u.nivel!==a.nivel) row.nivel=u.nivel;
      if(u.setor!==a.setor) row.setor=u.setor;
      if(!igual(u.foto||null, a.foto||null)) row.foto=u.foto||null;
      if((u.admissao||null)!==(a.admissao||null)) row.admissao=u.admissao||null;
      if((u.status||null)!==(a.status||null)) row.status=u.status||null;   // 02/10: status (só a própria pessoa; o servidor grava a data)   // 02/10: data de entrada (insígnias) — só o Diamante
      if(!!u.desativado!==!!a.desativado){ row.desativado_em = u.desativado ? new Date().toISOString() : null; row.desativado_por = u.desativado ? (u.desativado.por||"") : null; }
      if(Object.keys(row).length) await q(sb.from("perfis").update(row).eq("id",u.id));
    }
    // configurações
    const cfg=[];
    if(!igual(CASOS, BASE.casos)) cfg.push({chave:"casos", valor:CASOS});
    if(!igual(CATEGORIAS, BASE.categorias)) cfg.push({chave:"categorias", valor:CATEGORIAS});
    if(!igual(S.sla||{}, BASE.sla)) cfg.push({chave:"sla", valor:S.sla||{}});
    if(S.noreply!==BASE.email.noreply || S.replyTo!==BASE.email.replyTo) cfg.push({chave:"email", valor:{noreply:S.noreply, replyTo:S.replyTo}});
    if((S.insModelo||"original")!==BASE.insModelo) cfg.push({chave:"insignias", valor:S.insModelo||"original"});
    if(cfg.length) await q(sb.from("config").upsert(cfg));
    // clientes
    const bc = Object.fromEntries(BASE.clientes.map(c=>[c.id,c]));
    for(const c of S.clientes){
      const a=bc[c.id];
      if(!a) await q(sb.from("clientes").insert({id:c.id, nome:c.nome, doc:c.doc, email:c.email, tel:c.tel||""}));
      else if(!igual(c,a)) await q(sb.from("clientes").update({nome:c.nome, doc:c.doc, email:c.email, tel:c.tel||""}).eq("id",c.id));
    }
    // chamados (antes de apagar clientes unificados, para os chamados já apontarem para o cliente que fica)
    const bt = Object.fromEntries(BASE.tickets.map(t=>[t.id,t]));
    const snapT = Object.fromEntries(agoraS.tickets.map(t=>[t.id,t]));
    for(const t of S.tickets){ const a=bt[t.id]; if(!a || JSON.stringify(clone(t))!==JSON.stringify(a)) await salvarChamado(t, a, snapT[t.id]); }
    // 02/10: excluir cliente (Diamante) pelo servidor — guarda o cadastro nos chamados e exclui os ativos junto
    const feitos = new Set();
    for(const x of (S.exclusoesCli||[]).splice(0)){
      await q(sb.rpc("excluir_cliente", {cid:x.id, motivo:x.motivo||"", com_chamados:!!x.comChamados})); feitos.add(x.id); }
    const idsC = new Set(S.clientes.map(c=>c.id));
    for(const c of BASE.clientes) if(!idsC.has(c.id) && !feitos.has(c.id)) await q(sb.from("clientes").delete().eq("id",c.id));
    // incidentes
    for(const [op,v] of Object.entries(S.incBase)) if(BASE.incBase[op]!==v) await q(sb.from("inc_base").upsert({operadora:op, linhas:v, atualizado_em:new Date().toISOString(), atualizado_por:me().nome}));
    for(const op of Object.keys(BASE.incBase)) if(!(op in S.incBase)) await q(sb.from("inc_base").delete().eq("operadora",op));
    const br = Object.fromEntries(BASE.incidentes.map(r=>[r.id,r]));
    for(const r of S.incidentes){
      const a=br[r.id];
      if(!a){ const n=await q(sb.from("inc_registros").insert({dia:r.dia, turno:r.turno, operadora:r.operadora, linhas:r.linhas??null, nivel:r.nivel||null, obs:r.obs||"", ...(r.partes?{partes:r.partes}:{})}).select().single());
        const rS=agoraS.incidentes.find(x=>x.id===r.id); const e={id:n.id, base:n.base, por:n.por, em:fmt(n.em)}; Object.assign(r,e); if(rS) Object.assign(rS,e); }
      else if(r.linhas!==a.linhas || (r.nivel||null)!==(a.nivel||null) || !igual(r.corr,a.corr))
        await q(sb.from("inc_registros").update({linhas:r.linhas??null, nivel:r.nivel||null, correcoes:r.corr||[], ...(r.partes?{partes:r.partes}:{})}).eq("id",r.id));
    }
    // registro de chamados (Incidentes)
    const brc = Object.fromEntries((BASE.regCham||[]).map(r=>[r.id,r]));
    for(const r of S.regCham||[]){
      const a=brc[r.id];
      if(!a){ const n=await q(sb.from("registro_chamados").insert(rcParaBanco(r)).select().single());
        const e=rcDoBanco(n), rS=agoraS.regCham.find(x=>x.id===r.id); if(S.rcEdit===r.id) S.rcEdit=e.id; Object.assign(r,e); if(rS) Object.assign(rS,e); }
      else if(!igual(rcParaBanco(r), rcParaBanco(a))){ const n=await q(sb.from("registro_chamados").update(rcParaBanco(r)).eq("id",r.id).select().single());
        const e=rcDoBanco(n), rS=agoraS.regCham.find(x=>x.id===r.id); Object.assign(r,e); if(rS) Object.assign(rS,e); }
    }
    const idsRC = new Set((S.regCham||[]).map(r=>r.id));
    for(const r of BASE.regCham||[]) if(!idsRC.has(r.id)) await q(sb.from("registro_chamados").delete().eq("id",r.id).select().single());
    BASE = agoraS; calcularPainel();
    mudouNoServidor = JSON.stringify(agoraS)!==antesEco;          // o servidor devolveu algo novo (número, prazo, status)
  }catch(e){
    console.error(e);
    toast("Não foi possível salvar: "+(e.message||e)+". Os dados foram recarregados.");
    try{ await carregar(); mudouNoServidor=true; }catch(e2){ console.error(e2); }
  }finally{
    salvando=false;
    if(pendente){ pendente=false; setTimeout(sincronizar, 0); }
    else if(carregado && mudouNoServidor) renderSemSalvar();
  }
}

/* Depois de cada tela desenhada, salva o que mudou (com uma pequena espera para juntar ações). */
let tSync=null, desenhando=false;
const renderOriginal = window.render;
function renderSemSalvar(){ desenhando=true; try{ renderOriginal(); } finally { desenhando=false; } }
window.render = function(){
  renderOriginal();
  if(desenhando || !carregado) return;
  clearTimeout(tSync); tSync=setTimeout(sincronizar, 60);
};
render = window.render;   // as chamadas internas da tela passam a usar esta versão

/* Arquivo guardado no Storage: baixa quando precisa (visualizar ou salvar). */
window.blobDe = async a => {
  if(a.blob) return a.blob;
  if(!a.url && a.caminho){ const {data}=await sb.storage.from("anexos").createSignedUrl(a.caminho, 3600); a.url=data?.signedUrl; }
  const r = await fetch(a.url); if(!r.ok) throw new Error("Arquivo indisponível"); a.blob = await r.blob(); return a.blob;
};
window.prepararTxt = t => { (t?.arqs||[]).filter(a=>a.tipo==="txt"&&a.txt==null&&!a._lendo).forEach(a=>{ a._lendo=true;
  blobDe(a).then(b=>b.text()).then(x=>{a.txt=x.slice(0,1200); renderSemSalvar();}).catch(()=>{a.txt="(não foi possível ler o arquivo)"; renderSemSalvar();}); }); };

/* --------------------------------------------------------------- entrar */
async function entrar(){
  const {data:{user}} = await sb.auth.getUser();
  if(!user){ telaLogin(); return; }
  document.getElementById("root").innerHTML = `<div class="login"><div class="card"><p>Carregando…</p></div></div>`;
  const {data:perfil} = await sb.from("perfis").select("*").eq("id", user.id).maybeSingle();
  if(!perfil){ await sb.auth.signOut(); telaLogin("Seu usuário ainda não tem perfil no E.J. Desk. Fale com um Diamante."); return; }
  if(perfil.desativado_em){ await sb.auth.signOut(); telaLogin("Seu usuário está desativado. Fale com um Diamante."); return; }
  try{ await carregar(); }catch(e){ console.error(e); telaLogin("Não foi possível carregar os dados: "+e.message); return; }
  S.me=perfil.id; S.level=perfil.nivel; S.setor=perfil.setor; S.logged=true;
  const w=S.wanted; S.wanted=null;
  if(w){ Object.assign(S,w); go(S.route); } else go(primeiraRota());
}
window.ejdEntrar = entrar;
window.ejdSair = async ()=>{ await sb.auth.signOut(); carregado=false; BASE=null; S.logged=false; telaLogin(); };

/* Atualiza com o servidor a cada minuto (quando nada está sendo editado) */
setInterval(async ()=>{
  if(!carregado || salvando || document.querySelector(".scrim") || document.activeElement?.matches("input,textarea,select")) return;
  if(JSON.stringify(foto())!==JSON.stringify(BASE)) return;       // há alteração ainda não salva
  try{ await carregar(); renderSemSalvar(); }catch(e){ console.warn(e); }
}, 60000);

/* 02/10: link do e-mail com token_hash. A confirmação só acontece quando a pessoa clica no botão,
   assim o antivírus do e-mail (que abre os links sozinho) não "gasta" o link antes da pessoa. */
const TOKEN0 = LINK0.get("token_hash") || BUSCA0.get("token_hash") || "";
async function verificarLink(btn){
  btn.disabled=true; btn.textContent="Verificando…";
  const tipo = ["invite","recovery","signup","magiclink","email"].includes(TIPO0) ? TIPO0 : "invite";
  const {error} = await sb.auth.verifyOtp({token_hash: TOKEN0, type: tipo});
  history.replaceState(null,"",location.pathname);
  if(error){ telaLogin(/expired|invalid/i.test(error.message) ? "O link expirou ou já foi usado. Use \"Esqueci a senha\" para receber um novo, ou peça um novo convite ao Diamante." : "Não foi possível abrir o link: "+error.message); return; }
  telaLogin("", "senha");
}
/* Início: convite ou "esqueci a senha" chegam com um link que traz type=invite|recovery */
window.ejdBoot = async ()=>{
  const tipo=TIPO0, h=location.hash;
  if(TOKEN0){ S.wanted=null; await sb.auth.signOut({scope:"local"}).catch(()=>{}); telaLogin("", "link"); return; }   // 02/10: link novo (token_hash)
  const {data:{session}} = await sb.auth.getSession();
  if(/access_token|error/.test(h) || BUSCA0.has("code") || BUSCA0.has("error")) history.replaceState(null,"",location.pathname);
  if(session && (tipo==="invite"||tipo==="recovery"||tipo==="signup"||tipo==="magiclink")){ S.wanted=null; telaLogin("", "senha"); return; }
  if(ERRO0){ S.wanted=null; telaLogin(/expired|otp/.test(ERRO0) ? "O link expirou ou já foi usado. Peça um novo convite ao Diamante ou use \"Esqueci a senha\"." : "Não foi possível abrir o link: "+(LINK0.get("error_description")||ERRO0)); return; }
  if(session) await entrar(); else telaLogin();
};
sb.auth.onAuthStateChange(ev=>{ if(ev==="PASSWORD_RECOVERY") telaLogin("", "senha"); });
})();
