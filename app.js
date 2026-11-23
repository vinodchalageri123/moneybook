"use strict";
const EXP = {Food:"🍛",Groceries:"🛒",Rent:"🏠",EMI:"🏦",Transport:"🛵",Vehicle:"🔧",Bills:"💡",Gadgets:"🎧",Shopping:"🛍️",Health:"💊",Entertainment:"🎬",Family:"👪",Education:"📚",Other:"•"};
const INC = {Salary:"💼",Freelance:"🧑‍💻","Side hustle":"🎥",Reimbursement:"↩️",Interest:"📈",Gift:"🎁",Other:"•"};
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
const fmt = n => (n<0?"−":"")+"₹"+Math.abs(Math.round(n)).toLocaleString("en-IN");
const iso = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const today = () => iso(new Date());
const mkey = d => d.slice(0,7);
const monthName = k => new Date(k+"-01T00:00:00").toLocaleDateString("en-IN",{month:"long",year:"numeric"});
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let S = {config:{accounts:[],goals:[],budgets:{},bills:[],plans:[]}, months:{}};
let viewMonth = mkey(today());
let filter = "all";
/* ---------- storage: phone cache + Supabase sync ---------- */
const KEY="moneybook", SB_KEY="mb-sb", SYNCED_KEY="mb-synced", DIRTY_KEY="mb-dirty";
const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lsSet=(k,v)=>{try{localStorage.setItem(k,v);return true}catch(e){return false}};
const lsDel=k=>{try{localStorage.removeItem(k)}catch(e){}};
const BASE_EXP={...EXP};
const blank=()=>({config:{accounts:[],goals:[],budgets:{},bills:[],plans:[],buttons:null,cats:{}},months:{}});
const clip=(v,n)=>String(v??"").slice(0,n);
function normalize(x){
  const out=blank();
  if(!x||typeof x!=="object") throw new Error("bad");
  const c=x.config||{};
  ["accounts","goals","bills","plans"].forEach(k=>{ if(Array.isArray(c[k])) out.config[k]=c[k].filter(v=>v&&typeof v==="object"); });
  if(c.budgets&&typeof c.budgets==="object") out.config.budgets=c.budgets;
  if(Array.isArray(c.challenges)) out.config.challenges=c.challenges.filter(h=>h&&typeof h==="object"&&/^\d{4}-\d{2}-\d{2}$/.test(h.startDate||"")).slice(0,20)
    .map(h=>({id:clip(h.id||uid(),64),name:clip(h.name||"Challenge",30),start:Math.max(0,+h.start||0),step:Math.max(0,+h.step||0),days:Math.min(366,Math.max(1,Math.round(+h.days||1))),startDate:h.startDate,acc:clip(h.acc||"",64),cashAt:Math.max(0,+h.cashAt||0)}));
  if(Array.isArray(c.buttons)) out.config.buttons=c.buttons.filter(b=>b&&typeof b.name==="string"&&b.name.trim()).slice(0,60)
    .map(b=>({id:clip(b.id||uid(),64),name:clip(b.name,24),emoji:clip(b.emoji||"•",8),cat:clip(b.cat||"Other",24)}));
  if(c.cats&&typeof c.cats==="object") Object.keys(c.cats).slice(0,40).forEach(k=>{ const n=clip(k,24).trim(); if(n&&!(n in BASE_EXP)) out.config.cats[n]=clip(c.cats[k]||"🏷️",8); });
  const m=x.months||{};
  Object.keys(m).forEach(k=>{ if(/^\d{4}-\d{2}$/.test(k)&&Array.isArray(m[k])) out.months[k]=m[k].filter(t=>t&&typeof t==="object"&&typeof t.amount==="number"&&t.amount>0&&/^\d{4}-\d{2}-\d{2}$/.test(t.date||"")&&["expense","income","transfer","save"].includes(t.type)); });
  return out;
}
function applyCats(){ Object.keys(EXP).forEach(k=>{ if(!(k in BASE_EXP)) delete EXP[k]; }); Object.assign(EXP,S.config.cats||{}); }
let synced={}, dirty={months:[],config:false};
function loadMeta(){
  try{ synced=JSON.parse(lsGet(SYNCED_KEY)||"{}")||{}; }catch(e){ synced={}; }
  try{ const d=JSON.parse(lsGet(DIRTY_KEY)||"null"); if(d&&Array.isArray(d.months)) dirty={months:d.months,config:!!d.config}; }catch(e){}
}
function saveMeta(){ lsSet(SYNCED_KEY,JSON.stringify(synced)); lsSet(DIRTY_KEY,JSON.stringify(dirty)); }
function loadLocal(){
  try{ const raw=lsGet(KEY); if(raw) S=normalize(JSON.parse(raw)); }catch(e){ S=blank(); }
  applyCats(); render();
}
function saveLocal(){ if(!lsSet(KEY, JSON.stringify(S))) toast("Couldn't save on this phone. Free up some space."); }
function persist(which){
  if(which==="config") dirty.config=true; else if(which&&!dirty.months.includes(which)) dirty.months.push(which);
  applyCats(); saveLocal(); saveMeta(); scheduleSync();
}

let sb=null, sbUser=null, syncing=false, syncAgain=false, syncTimer=null, lastSynced=null;
const toRow=t=>({id:String(t.id),date:t.date,type:t.type,amount:Math.round(Number(t.amount)*100)/100,cat:t.cat??null,acc:String(t.acc),to_acc:t.to??null,
  note:t.note?clip(t.note,200):null,goal:t.goal??null,bill:t.bill??null,period:t.period??null,plan:t.plan??null,reimb:t.reimb??null});
const rowKey=r=>JSON.stringify([r.date,r.type,r.amount,r.cat,r.acc,r.to_acc,r.note,r.goal,r.bill,r.period,r.plan,r.reimb]);
function fromRow(r){
  const t={id:r.id,date:r.date,type:r.type,amount:Number(r.amount),acc:r.acc};
  [["cat","cat"],["to_acc","to"],["note","note"],["goal","goal"],["bill","bill"],["period","period"],["plan","plan"],["reimb","reimb"]].forEach(([a,b])=>{ if(r[a]!=null) t[b]=r[a]; });
  return t;
}
function setSync(t,state){ const el=$("#sync"); el.textContent=t; el.dataset.state=state||""; }
function syncLabel(){
  if(!sb||!sbUser) return setSync(getSbCfg()?"Sign in to sync":"Not synced · set up","off");
  const pending=dirty.months.length||dirty.config;
  if(!navigator.onLine) return setSync(pending?"Offline · will sync":"Offline","wait");
  setSync(pending||syncing?"Syncing…":"Synced","ok");
}
function scheduleSync(ms){ syncLabel(); clearTimeout(syncTimer); syncTimer=setTimeout(syncNow, ms??400); }
async function syncNow(){
  if(!sb||!sbUser||!navigator.onLine){ syncLabel(); return; }
  if(syncing){ syncAgain=true; return; }
  syncing=true; syncLabel();
  try{ await push(); await pull(); lastSynced=new Date(); syncing=false; syncLabel(); }
  catch(e){ syncing=false; setSync("Sync failed · retrying","err"); clearTimeout(syncTimer); syncTimer=setTimeout(syncNow,30000); }
  finally{ if(syncAgain){ syncAgain=false; scheduleSync(100); } }
}
async function push(){
  const me=sbUser.id;
  const localIds=new Set(allTx().map(t=>String(t.id)));
  for(const k of [...dirty.months]){
    const ups=(S.months[k]||[]).map(toRow).filter(r=>!synced[r.id]||synced[r.id].h!==rowKey(r));
    const dels=Object.keys(synced).filter(id=>synced[id].m===k&&!localIds.has(id));
    for(let i=0;i<ups.length;i+=500){
      const {error}=await sb.from("entries").upsert(ups.slice(i,i+500).map(r=>({...r,user_id:me})),{onConflict:"id"}); if(error) throw error; }
    if(dels.length){ const {error}=await sb.from("entries").delete().in("id",dels); if(error) throw error; }
    ups.forEach(r=>synced[r.id]={h:rowKey(r),m:k}); dels.forEach(id=>delete synced[id]);
    dirty.months=dirty.months.filter(x=>x!==k); saveMeta();
  }
  if(dirty.config){
    const {error}=await sb.from("settings").upsert({user_id:me,config:S.config},{onConflict:"user_id"}); if(error) throw error;
    dirty.config=false; saveMeta();
  }
}
async function pull(){
  if(dirty.months.length||dirty.config) return;
  const rows=[];
  for(let from=0;;from+=1000){
    const {data,error}=await sb.from("entries").select("id,date,type,amount,cat,acc,to_acc,note,goal,bill,period,plan,reimb").order("date").order("id").range(from,from+999);
    if(error) throw error; rows.push(...data); if(data.length<1000) break;
  }
  const {data:st,error:e2}=await sb.from("settings").select("config").maybeSingle(); if(e2) throw e2;
  if(dirty.months.length||dirty.config) return; // something new was added while fetching; next round handles it
  const next=blank();
  next.config = st&&st.config ? normalize({config:st.config}).config : S.config;
  const ns={};
  rows.forEach(r=>{ const t=fromRow(r); const k=mkey(t.date); (next.months[k]=next.months[k]||[]).push(t); ns[t.id]={h:rowKey(toRow(t)),m:k}; });
  const changed=JSON.stringify(next)!==JSON.stringify(S);
  S=next; synced=ns; applyCats(); saveLocal(); saveMeta(); if(changed) render();
  if(!st){ dirty.config=true; saveMeta(); scheduleSync(); }
}
function getSbCfg(){ try{ const c=JSON.parse(lsGet(SB_KEY)||"null"); return c&&c.url&&c.key?c:null; }catch(e){ return null; } }
function makeClient(cfg){
  if(!window.supabase||!window.supabase.createClient) return null;
  return window.supabase.createClient(cfg.url,cfg.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:"mb-auth"}});
}
async function initSupabase(){
  const cfg=getSbCfg(); if(!cfg){ syncLabel(); return; }
  sb=makeClient(cfg); if(!sb){ setSync("Sync unavailable offline","wait"); return; }
  sb.auth.onAuthStateChange((ev,session)=>{
    const was=sbUser; sbUser=session?session.user:null;
    if(!was&&sbUser) onSignedIn(); else syncLabel();
  });
  try{ const {data}=await sb.auth.getSession(); if(data.session&&!sbUser){ sbUser=data.session.user; onSignedIn(); } }catch(e){}
  syncLabel();
}
function onSignedIn(){
  // First connection from this phone: send what's on the phone up (merge), then pull everything down.
  if(!Object.keys(synced).length) dirty.months=[...new Set([...dirty.months,...Object.keys(S.months)])];
  saveMeta(); scheduleSync(0);
}
function initStore(){
  loadMeta(); loadLocal();
  try{ if(navigator.storage&&navigator.storage.persist) navigator.storage.persist(); }catch(e){}
  addEventListener("online",()=>scheduleSync(0));
  addEventListener("offline",syncLabel);
  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") scheduleSync(0); });
  initSupabase();
}

/* ---------- sync settings dialog ---------- */
const DEFAULT_SB={url:"https://gekzovocizallcfhzimn.supabase.co",key:"sb_publishable_Q7iZBi0TTRAAGuknPyC2NQ_UPH-vGbT"};
function openSync(){
  const signedIn=!!(sb&&sbUser);
  $("#sync-in").hidden=!signedIn; $("#sync-setup").hidden=signedIn;
  if(signedIn){ $("#sync-who").textContent=`Signed in as ${sbUser.email||"you"}${lastSynced?` · last synced ${lastSynced.toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"})}`:""}`; }
  else { const c=getSbCfg()||DEFAULT_SB; $("#sb-url").value=c.url; $("#sb-key").value=c.key; $("#sync-msg").textContent=""; }
  $("#d-sync").showModal();
}
function readSetup(){
  const url=$("#sb-url").value.trim().replace(/\/+$/,""), key=$("#sb-key").value.trim();
  const email=$("#sb-email").value.trim(), pass=$("#sb-pass").value;
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) throw "Project URL should look like https://xxxx.supabase.co";
  if(key.length<20||/\s/.test(key)) throw "Paste the publishable (anon) key from Project Settings → API.";
  if(/service_role|sb_secret_/i.test(key)) throw "That's the secret key. Never put it in an app. Use the publishable (anon) key.";
  if(!email||pass.length<8) throw "Enter your email and a password of at least 8 characters.";
  return {url,key,email,pass};
}
async function connect(mode){
  const msg=$("#sync-msg"); msg.textContent="";
  let v; try{ v=readSetup(); }catch(m){ msg.textContent=m; return; }
  if(!navigator.onLine){ msg.textContent="You're offline. Connect to the internet first."; return; }
  const cfg={url:v.url,key:v.key}; const prev=getSbCfg();
  if(!prev||prev.url!==cfg.url||prev.key!==cfg.key){ lsSet(SB_KEY,JSON.stringify(cfg)); sb=null; }
  if(!sb){ sb=makeClient(cfg); if(!sb){ msg.textContent="Couldn't load the sync library. Check your internet and reopen the app."; return; }
    sb.auth.onAuthStateChange((ev,session)=>{ const was=sbUser; sbUser=session?session.user:null; if(!was&&sbUser) onSignedIn(); else syncLabel(); }); }
  msg.textContent=mode==="up"?"Creating account…":"Signing in…";
  try{
    if(mode==="up"){
      const {data,error}=await sb.auth.signUp({email:v.email,password:v.pass,options:{emailRedirectTo:location.origin+location.pathname}});
      if(error) throw error;
      if(!data.session){ msg.textContent="Check your email and tap the confirmation link, then come back and tap Sign in."; return; }
    } else {
      const {error}=await sb.auth.signInWithPassword({email:v.email,password:v.pass}); if(error) throw error;
    }
    $("#sb-pass").value=""; $("#d-sync").close(); toast("Connected. Syncing your entries…");
  }catch(e){ msg.textContent=(e&&e.message)||"Couldn't connect. Check the URL, key and password."; }
}
$("#sync").onclick=openSync;
document.addEventListener("click",e=>{ if(e.target.closest("[data-opensync]")) openSync(); if(e.target.closest("[data-restore]")) $("#restore-file").click(); });
$("#f-sync").onsubmit=e=>{ e.preventDefault(); if(!$("#sync-setup").hidden) connect("in"); };
$("#sb-signup").onclick=()=>connect("up");
$("#sync-now").onclick=()=>{ $("#d-sync").close(); scheduleSync(0); };
$("#sync-out").onclick=async()=>{
  const pending=dirty.months.length||dirty.config;
  if(!confirm(pending?"Some entries haven't synced yet and will be lost. Sign out anyway?":"Sign out? Your entries stay safe in your database and are removed from this phone.")) return;
  try{ await sb.auth.signOut(); }catch(e){}
  sbUser=null; synced={}; dirty={months:[],config:false}; S=blank();
  [KEY,SYNCED_KEY,DIRTY_KEY].forEach(lsDel); applyCats(); render(); $("#d-sync").close(); syncLabel(); toast("Signed out");
};

/* ---------- derived ---------- */
const allTx = () => Object.values(S.months).flat();
function balances(){
  const b={}; S.config.accounts.forEach(a=>b[a.id]=+a.open||0);
  allTx().forEach(t=>{
    if(t.type==="income") b[t.acc]=(b[t.acc]||0)+t.amount;
    else if(t.type==="expense"||t.type==="save") b[t.acc]=(b[t.acc]||0)-t.amount;
    else if(t.type==="transfer"){ b[t.acc]=(b[t.acc]||0)-t.amount; b[t.to]=(b[t.to]||0)+t.amount; }
  });
  return b;
}
function goalSaved(g){ return (+g.init||0)+allTx().filter(t=>t.type==="save"&&t.goal===g.id).reduce((s,t)=>s+t.amount,0); }
function monthStats(k){
  const tx=S.months[k]||[]; let inn=0,out=0,save=0; const cats={};
  tx.forEach(t=>{ if(t.type==="income")inn+=t.amount; else if(t.type==="expense"){out+=t.amount;cats[t.cat]=(cats[t.cat]||0)+t.amount;} else if(t.type==="save")save+=t.amount; });
  return {inn,out,save,cats};
}
function goalMonthly(g){
  const saved=goalSaved(g), left=Math.max(0,g.target-saved); if(!left) return 0;
  if(g.start && new Date(g.start+"T00:00:00")>new Date()) return 0;
  const months=Math.max(1,(new Date(g.date)-new Date())/(1000*60*60*24*30.44));
  const thisMonth=(S.months[mkey(today())]||[]).filter(t=>t.type==="save"&&t.goal===g.id).reduce((s,t)=>s+t.amount,0);
  return Math.max(0,Math.ceil((left+thisMonth)/months)-thisMonth);
}
const billPaid = (b,period) => allTx().find(t=>t.bill===b.id&&t.period===period);
function nextDue(b){
  const now=new Date(); now.setHours(0,0,0,0);
  for(let i=0;i<3;i++){
    const d=new Date(now.getFullYear(),now.getMonth()+i,Math.min(28,b.day||1));
    const period=iso(d).slice(0,7);
    if(billPaid(b,period)) continue;
    if(i===0 && d<now) continue;
    return {date:d,period};
  }
  const d=new Date(now.getFullYear(),now.getMonth()+3,b.day||1); return {date:d,period:iso(d).slice(0,7)};
}
const planBought = p => allTx().find(t=>t.plan===p.id);
const planBack = p => allTx().find(t=>t.reimb===p.id);
function planSummary(){
  const bal=balances(); const cash=Object.values(bal).reduce((a,b)=>a+b,0);
  const horizon=new Date(); if(horizon.getDate()>=28) horizon.setMonth(horizon.getMonth()+2,0); else horizon.setMonth(horizon.getMonth()+1,0); horizon.setHours(23,59,59,999);
  const bills=(S.config.bills||[]).map(b=>({b,...nextDue(b)})).filter(x=>x.date<=horizon);
  const billsTotal=bills.reduce((s,x)=>s+x.b.amount,0);
  const open=(S.config.plans||[]).filter(p=>!planBought(p));
  const openTotal=open.reduce((s,p)=>s+p.amount,0);
  const back=(S.config.plans||[]).filter(p=>p.reimb&&!planBack(p)).reduce((s,p)=>s+p.amount,0);
  const goalsNeed=S.config.goals.reduce((s,g)=>s+goalMonthly(g),0);
  return {cash,bills,billsTotal,open,openTotal,back,goalsNeed,left:cash-billsTotal-openTotal-goalsNeed};
}
const dshort = d => d.toLocaleDateString("en-IN",{day:"numeric",month:"short"});
const ordinal = n => n+(n%10===1&&n!==11?"st":n%10===2&&n!==12?"nd":n%10===3&&n!==13?"rd":"th");
const accName = id => (String(id).startsWith("ch:")?((chList().find(h=>"ch:"+h.id===id)||{}).name||"Old challenge"):(S.config.accounts.find(a=>a.id===id)||{}).name)||"Deleted account";
const goalName = id => (S.config.goals.find(g=>g.id===id)||chList().find(h=>h.id===id)||{}).name||"Deleted goal";

/* ---------- render ---------- */
function render(){
  const bal=balances();
  const goalsTotal=S.config.goals.reduce((s,g)=>s+goalSaved(g),0);
  const chTotal=chList().reduce((s,h)=>s+chSaved(h),0);
  $("#worth").textContent=fmt(Object.values(bal).reduce((a,b)=>a+b,0)+goalsTotal+chTotal);
  const cur=mkey(today()), ms=monthStats(cur);
  $("#m-label").textContent=new Date().toLocaleDateString("en-IN",{month:"long"})+" in";
  $("#m-in").textContent=fmt(ms.inn); $("#m-out").textContent=fmt(ms.out); $("#m-save").textContent=fmt(ms.save);

  const cats=Object.entries(ms.cats).sort((a,b)=>b[1]-a[1]);
  const max=Math.max(1,...cats.map(c=>Math.max(c[1],+S.config.budgets[c[0]]||0)));
  $("#cats").innerHTML = cats.length ? cats.map(([c,v])=>{
    const lim=+S.config.budgets[c]||0, over=lim&&v>lim;
    return `<div class="cat-row"><span>${esc(EXP[c]||"•")} ${esc(c)}</span><span class="num">${fmt(v)}${lim?` <span style="color:var(--muted)">/ ${fmt(lim)}</span>`:""}</span>
      <div class="cat-track"><div class="cat-fill${over?" over":""}" style="width:${Math.min(100,v/(lim||max)*100)}%"></div></div></div>`;
  }).join("") : `<p class="hint">No spending logged this month yet.</p>`;

  renderGoals("#goals-mini", true); renderGoals("#goals", false);
  renderChallenges();
  renderPlan();
  $("#quick").innerHTML=buttons().map(b=>btnTile(b,false)).join("");

  const recent=allTx().sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id)).slice(0,6);
  $("#recent").innerHTML = recent.length ? recent.map(txRow).join("") : emptyStart();

  // transactions view
  $("#tx-month").textContent=monthName(viewMonth);
  const vs=monthStats(viewMonth);
  $("#t-in").textContent=fmt(vs.inn); $("#t-out").textContent=fmt(vs.out);
  const net=vs.inn-vs.out-vs.save; $("#t-net").textContent=fmt(net); $("#t-net").className=net<0?"out":"in";
  const used=[...new Set((S.months[viewMonth]||[]).filter(t=>t.type==="expense").map(t=>t.cat))];
  $("#filters").innerHTML=["all","income","save",...used].map(f=>`<button class="chip" aria-pressed="${filter===f}" data-f="${esc(f)}">${f==="all"?"All":f==="income"?"Received":f==="save"?"Goals":esc(f)}</button>`).join("");
  let list=(S.months[viewMonth]||[]).slice().sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
  if(filter==="income") list=list.filter(t=>t.type==="income");
  else if(filter==="save") list=list.filter(t=>t.type==="save");
  else if(filter!=="all") list=list.filter(t=>t.type==="expense"&&t.cat===filter);
  let html="",lastDay="";
  list.forEach(t=>{ if(t.date!==lastDay){lastDay=t.date; html+=`<div class="day">${new Date(t.date+"T00:00:00").toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})}</div>`;} html+=txRow(t); });
  $("#txlist").innerHTML = html || `<div class="empty">Nothing recorded for ${monthName(viewMonth)}.</div>`;

  // accounts
  $("#accts").innerHTML = S.config.accounts.length ? S.config.accounts.map(a=>`<button class="acct" data-acct="${esc(a.id)}"><small>${esc(a.type)}</small><span style="font-weight:700">${esc(a.name)}</span><b class="num ${bal[a.id]<0?"out":""}">${fmt(bal[a.id]||0)}</b></button>`).join("")
    : `<div class="empty" style="grid-column:1/-1">Add the places your money lives: bank accounts, cash, UPI wallets, cards.</div>`;
  $("#budgets").innerHTML = Object.keys(EXP).map(c=>`<label class="tx" style="grid-template-columns:auto 1fr 120px;cursor:default"><span class="ic">${esc(EXP[c])}</span><span class="t" style="color:var(--ink)">${esc(c)}</span><input type="number" inputmode="numeric" min="0" placeholder="No limit" data-budget="${esc(c)}" value="${esc(S.config.budgets[c]||"")}" style="padding:7px 10px;font-size:15px"></label>`).join("");
}
function renderPlan(){
  const p=planSummary();
  $("#plan-mini").innerHTML=`<button class="mini-plan" data-go="plan" style="width:100%;text-align:left"><span><span style="color:var(--muted);font-size:13px;display:block">Free after bills, planned buys and goal savings</span><b class="num ${p.left<0?"out":""}">${fmt(p.left)}</b></span><span class="link">Details</span></button>`;
  $("#plan-sum").innerHTML=`<h2>Free after bills, planned buys and goal savings</h2>
    <div class="worth num ${p.left<0?"out":""}">${fmt(p.left)}</div>
    <div class="ledger num">
      <div><span>In your accounts now</span><span>${fmt(p.cash)}</span></div>
      <div><span>Bills due before next salary (${p.bills.length})</span><span class="out">${fmt(-p.billsTotal)}</span></div>
      <div><span>Planned purchases (${p.open.length})</span><span class="out">${fmt(-p.openTotal)}</span></div>
      <div><span>Goal savings this month</span><span class="gold">${fmt(-p.goalsNeed)}</span></div>
      <div class="tot"><span>Free to use</span><span>${fmt(p.left)}</span></div>
      ${p.back?`<div><span>Money coming back later</span><span class="in">+${fmt(p.back)}</span></div>`:""}
    </div>`;
  const bills=(S.config.bills||[]).map(b=>({b,...nextDue(b)})).sort((a,c)=>a.date-c.date);
  $("#bills").innerHTML = bills.length ? bills.map(({b,date,period})=>`<div class="item">
      <span class="ic">${esc(EXP[b.cat]||"•")}</span>
      <button class="main" data-bill="${esc(b.id)}"><span class="t">${esc(b.name)}${b.varies?'<span class="tag est">varies</span>':""}</span><span class="s">${ordinal(b.day)} of every month · next ${dshort(date)}</span></button>
      <span class="side"><span class="num" style="font-weight:700">${b.varies?"≈":""}${fmt(b.amount)}</span><button class="btn ghost sm" data-paybill="${esc(b.id)}" data-period="${period}">Mark paid</button></span></div>`).join("")
    : `<div class="empty">Add things you pay every month, like rent or an EMI.</div>`;
  const plans=(S.config.plans||[]).slice().sort((a,c)=>(!!planBought(a)-!!planBought(c)));
  $("#plans").innerHTML = plans.length ? plans.map(p=>{
      const bought=planBought(p), back=planBack(p);
      let action = !bought ? `<button class="btn ghost sm" data-buy="${esc(p.id)}">Mark bought</button>`
        : p.reimb && !back ? `<button class="btn ghost sm" data-back="${esc(p.id)}">Got money back</button>` : `<span class="s">${back?"Reimbursed":"Bought"}</span>`;
      return `<div class="item${bought&&(!p.reimb||back)?" done":""}"><span class="ic">${esc(EXP[p.cat]||"•")}</span>
      <button class="main" data-plan="${esc(p.id)}"><span class="t">${esc(p.name)}${p.est?'<span class="tag est">estimate</span>':""}${p.reimb?'<span class="tag">reimbursable</span>':""}</span><span class="s">${esc(p.cat)}</span></button>
      <span class="side"><span class="num" style="font-weight:700">${p.est?"≈":""}${fmt(bought?bought.amount:p.amount)}</span>${action}</span></div>`;}).join("")
    : `<div class="empty">List things you need to buy soon so they're counted before you spend.</div>`;
}
function emptyStart(){
  return S.config.accounts.length ? `<div class="empty">No entries yet. Tap “Add entry” to log your first one.</div>`
   : `<div class="empty">Start by adding where your money is kept, or restore your backup file.<br><button class="btn sm" data-go="accounts">Add an account</button> <button class="btn ghost sm" data-opensync="1">Set up sync</button> <button class="btn ghost sm" data-restore="1">Restore backup</button></div>`;
}
function txRow(t){
  let icon,title,sub,amt,cls;
  if(t.type==="income"){icon=INC[t.cat]||"•";title=t.note||t.cat;sub=`${t.cat} · ${accName(t.acc)}`;amt="+"+fmt(t.amount);cls="in";}
  else if(t.type==="expense"){icon=EXP[t.cat]||"•";title=t.note||t.cat;sub=`${t.cat} · ${accName(t.acc)}`;amt=fmt(-t.amount);cls="out";}
  else if(t.type==="save"){icon="🫙";title=goalName(t.goal);sub=`Saved from ${accName(t.acc)}`;amt=fmt(t.amount);cls="gold";}
  else {icon="⇄";title=t.note||"Moved money";sub=`${accName(t.acc)} to ${accName(t.to)}`;amt=fmt(t.amount);cls="";}
  return `<button class="tx" data-tx="${esc(t.id)}" data-m="${mkey(t.date)}"><span class="ic">${esc(icon)}</span><span><span class="t">${esc(title)}</span><br><span class="s">${esc(sub)}</span></span><span class="a num ${cls}">${amt}</span></button>`;
}
function renderGoals(sel, mini){
  const gs=S.config.goals;
  if(!gs.length){ $(sel).innerHTML=`<div class="empty" style="grid-column:1/-1">Planning a big purchase? Add a goal and see how much to set aside each month.${mini?`<br><button class="btn sm" data-go="goals">Create a goal</button>`:""}</div>`; return; }
  $(sel).innerHTML=gs.map(g=>{
    const saved=goalSaved(g), pct=Math.min(100,saved/g.target*100), left=Math.max(0,g.target-saved);
    const months=Math.max(1,(new Date(g.date)-new Date())/(1000*60*60*24*30.44));
    const past=new Date(g.date)<new Date();
    const later=g.start && new Date(g.start+"T00:00:00")>new Date();
    if(later && left>0){
      const lm=Math.max(1,(new Date(g.date)-new Date(g.start+"T00:00:00"))/(1000*60*60*24*30.44));
      const sMon=new Date(g.start+"T00:00:00").toLocaleDateString("en-IN",{month:"short",year:"numeric"});
      return `<div class="goal">
      <div class="jar" aria-hidden="true"><div class="fill" style="height:${pct}%"></div><div class="pct">${Math.round(pct)}%</div></div>
      <div><h4>${esc(g.name)}</h4><p class="num">${fmt(saved)} of ${fmt(g.target)}</p>
      <p>By ${new Date(g.date+"T00:00:00").toLocaleDateString("en-IN",{month:"short",year:"numeric"})}</p>
      <div class="need num">Starts ${sMon} · then ${fmt(Math.ceil(left/lm))}/month</div></div>
      ${mini?"":`<div class="acts"><button class="btn sm" data-fund="${esc(g.id)}">Add money</button><button class="btn ghost sm" data-goal="${esc(g.id)}">Edit</button></div>`}
    </div>`;
    }
    const need = left<=0 ? "Goal reached" : past ? `Target date passed · ${fmt(left)} to go` : `Set aside ${fmt(Math.ceil(left/months))}/month`;
    return `<div class="goal${left<=0?" done":""}">
      <div class="jar" aria-hidden="true"><div class="fill" style="height:${pct}%"></div><div class="pct">${Math.round(pct)}%</div></div>
      <div><h4>${esc(g.name)}</h4><p class="num">${fmt(saved)} of ${fmt(g.target)}</p>
      <p>By ${new Date(g.date+"T00:00:00").toLocaleDateString("en-IN",{month:"short",year:"numeric"})}</p>
      <div class="need num">${need}</div></div>
      ${mini?"":`<div class="acts"><button class="btn sm" data-fund="${esc(g.id)}">Add money</button><button class="btn ghost sm" data-goal="${esc(g.id)}">Edit</button></div>`}
    </div>`;
  }).join("");
}

/* ---------- routing ---------- */
const VIEWS=["overview","plan","transactions","goals","challenges","accounts"];
function route(){
  const v=VIEWS.includes(location.hash.slice(1))?location.hash.slice(1):"overview";
  VIEWS.forEach(x=>{ $("#v-"+x).hidden=x!==v; });
  document.querySelectorAll("nav a").forEach(a=>a.setAttribute("aria-current",a.getAttribute("href")==="#"+v?"page":"false"));
  const cur=document.querySelector(`nav a[href="#${v}"]`); if(cur&&cur.scrollIntoView) cur.scrollIntoView({block:"nearest",inline:"nearest"});
}
addEventListener("hashchange",route);

/* ---------- dialogs ---------- */
let pendingLink=null, txType="expense", editTx=null, editGoal=null, editAcct=null, fundGoal=null;
function opts(sel,obj,val){ $(sel).innerHTML=Object.keys(obj).map(k=>`<option ${k===val?"selected":""}>${esc(k)}</option>`).join(""); }
function accOpts(sel,val){ $(sel).innerHTML=S.config.accounts.map(a=>`<option value="${esc(a.id)}" ${a.id===val?"selected":""}>${esc(a.name)}</option>`).join(""); }
function setType(t){
  txType=t;
  document.querySelectorAll("[data-type]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.type===t));
  $("#tx-cat-l").hidden=t==="transfer"; $("#tx-to-l").hidden=t!=="transfer";
  $("#tx-acc-l").firstChild.textContent = t==="income"?"Into account":"From account";
  const cur=$("#tx-cat").value;
  if(t==="income") opts("#tx-cat",INC,cur); else catOptions("#tx-cat", cur in EXP?cur:"Food");
  $("#tx-newcat-l").hidden=true; $("#tx-newcat").value=""; $("#tx-newemoji").value="";
}
$("#tx-cat").onchange=()=>{ $("#tx-newcat-l").hidden=$("#tx-cat").value!=="__new"; if($("#tx-cat").value==="__new") $("#tx-newcat").focus(); };
function openTx(t,pre){
  pendingLink=pre?pre.link:null;
  if(!S.config.accounts.length){ toast("Add an account first"); location.hash="accounts"; openAcct(); return; }
  if(t && ((t.type==="save" && /^cday:/.test(t.plan||""))||(t.type==="transfer"&&String(t.acc).startsWith("ch:")))){ location.hash="challenges"; toast("Tick or untick challenge days in the Challenges tab"); return; }
  if(t && t.type==="save"){ openFund(S.config.goals.find(g=>g.id===t.goal), t); return; }
  editTx=t||null;
  $("#tx-title").textContent=t?"Edit entry":"Add entry"; $("#tx-del").hidden=!t;
  const src=t||pre||{};
  opts("#tx-cat", src.type==="income"?INC:EXP, src.cat||"Food");
  setType(src.type||"expense");
  $("#tx-amt").value=src.amount||""; $("#tx-date").value=src.date||today(); $("#tx-note").value=src.note||"";
  accOpts("#tx-acc",src.acc||S.config.accounts[0].id); accOpts("#tx-to",t?t.to:(S.config.accounts[1]||S.config.accounts[0]).id);
  $("#d-tx").showModal(); setTimeout(()=>$("#tx-amt").focus(),50);
}
document.querySelectorAll("[data-type]").forEach(b=>b.onclick=()=>setType(b.dataset.type));
function removeTx(t){ const k=mkey(t.date); S.months[k]=(S.months[k]||[]).filter(x=>x.id!==t.id); return k; }
function putTx(t){ const k=mkey(t.date); (S.months[k]=S.months[k]||[]).push(t); return k; }
$("#f-tx").onsubmit=e=>{
  const amount=+$("#tx-amt").value; if(!(amount>0)){ e.preventDefault(); toast("Enter an amount above zero"); return; }
  if(txType==="transfer" && $("#tx-acc").value===$("#tx-to").value){ e.preventDefault(); toast("Pick two different accounts"); return; }
  const t={id:editTx?editTx.id:uid(),type:txType,amount,date:$("#tx-date").value,acc:$("#tx-acc").value,note:$("#tx-note").value.trim()};
  if(txType==="transfer") t.to=$("#tx-to").value; else t.cat=$("#tx-cat").value;
  if(t.cat==="__new"){
    try{ t.cat=addCategory($("#tx-newcat").value,[...$("#tx-newemoji").value.trim()].slice(0,2).join("")); }catch(m){ e.preventDefault(); toast(m); return; }
    persist("config");
  }
  const link = editTx ? {bill:editTx.bill,period:editTx.period,plan:editTx.plan,reimb:editTx.reimb} : (pendingLink||{});
  Object.keys(link).forEach(k=>{ if(link[k]!=null) t[k]=link[k]; });
  const touched=new Set();
  if(editTx) touched.add(removeTx(editTx));
  touched.add(putTx(t)); touched.forEach(persist); render(); toast(editTx?"Entry updated":"Entry saved");
};
$("#tx-del").onclick=()=>{ if(!confirm("Delete this entry?"))return; persist(removeTx(editTx)); $("#d-tx").close(); render(); toast("Entry deleted"); };

function openGoal(g){
  editGoal=g||null; $("#goal-title").textContent=g?"Edit goal":"New goal"; $("#g-del").hidden=!g;
  $("#g-name").value=g?g.name:""; $("#g-target").value=g?g.target:"";
  const d=new Date(); d.setFullYear(d.getFullYear()+1);
  $("#g-date").value=g?g.date:d.toISOString().slice(0,10); $("#g-init").value=g?g.init||0:0; $("#g-start").value=g&&g.start?g.start:"";
  $("#d-goal").showModal();
}
$("#f-goal").onsubmit=()=>{
  const g={id:editGoal?editGoal.id:uid(),name:$("#g-name").value.trim(),target:+$("#g-target").value,date:$("#g-date").value,init:+$("#g-init").value||0,start:$("#g-start").value||""};
  if(editGoal) Object.assign(S.config.goals.find(x=>x.id===g.id),g); else S.config.goals.push(g);
  persist("config"); render(); toast(editGoal?"Goal updated":"Goal created");
};
$("#g-del").onclick=()=>{ if(!confirm("Delete this goal? Money added to it will return to its accounts."))return;
  const id=editGoal.id; S.config.goals=S.config.goals.filter(g=>g.id!==id);
  Object.keys(S.months).forEach(k=>{ const b=S.months[k].length; S.months[k]=S.months[k].filter(t=>!(t.type==="save"&&t.goal===id)); if(S.months[k].length!==b) persist(k); });
  persist("config"); $("#d-goal").close(); render(); toast("Goal deleted"); };

let fundEdit=null;
function openFund(g,t){
  if(!S.config.accounts.length){ toast("Add an account first"); location.hash="accounts"; return; }
  fundGoal=g; fundEdit=t||null; $("#fund-title").textContent=(t?"Edit: ":"Add to ")+(g?g.name:"goal");
  $("#fd-amt").value=t?t.amount:""; $("#fd-date").value=t?t.date:today(); accOpts("#fd-acc",t?t.acc:S.config.accounts[0].id);
  $("#d-fund").showModal();
}
$("#f-fund").onsubmit=e=>{
  const amount=+$("#fd-amt").value; if(!(amount>0)){ e.preventDefault(); toast("Enter an amount above zero"); return; }
  const t={id:fundEdit?fundEdit.id:uid(),type:"save",goal:fundGoal?fundGoal.id:fundEdit.goal,amount,date:$("#fd-date").value,acc:$("#fd-acc").value};
  const touched=new Set(); if(fundEdit) touched.add(removeTx(fundEdit)); touched.add(putTx(t)); touched.forEach(persist); render(); toast("Added to goal");
};

function openAcct(a){
  editAcct=a||null; $("#acct-title").textContent=a?"Edit account":"Add account"; $("#a-del").hidden=!a;
  $("#a-name").value=a?a.name:""; $("#a-type").value=a?a.type:"Bank"; $("#a-open").value=a?a.open:0;
  $("#d-acct").showModal();
}
$("#f-acct").onsubmit=()=>{
  const a={id:editAcct?editAcct.id:uid(),name:$("#a-name").value.trim(),type:$("#a-type").value,open:+$("#a-open").value||0};
  if(editAcct) Object.assign(S.config.accounts.find(x=>x.id===a.id),a); else S.config.accounts.push(a);
  persist("config"); render(); toast(editAcct?"Account updated":"Account added");
};
$("#a-del").onclick=()=>{
  if(allTx().some(t=>t.acc===editAcct.id||t.to===editAcct.id)){ toast("This account has entries. Delete those first."); return; }
  if(!confirm("Delete this account?"))return;
  S.config.accounts=S.config.accounts.filter(a=>a.id!==editAcct.id); persist("config"); $("#d-acct").close(); render(); toast("Account deleted"); };

let editBill=null, editPlan=null;
function openBill(b){
  if(!S.config.accounts.length){ toast("Add an account first"); location.hash="accounts"; openAcct(); return; }
  editBill=b||null; $("#bill-title").textContent=b?"Edit bill":"Add monthly bill"; $("#b-del").hidden=!b;
  $("#b-name").value=b?b.name:""; $("#b-amt").value=b?b.amount:""; $("#b-day").value=b?b.day:1; $("#b-var").checked=!!(b&&b.varies);
  opts("#b-cat",EXP,b?b.cat:"Bills"); accOpts("#b-acc",b?b.acc:S.config.accounts[0].id);
  $("#d-bill").showModal();
}
$("#f-bill").onsubmit=()=>{
  const b={id:editBill?editBill.id:uid(),name:$("#b-name").value.trim(),amount:+$("#b-amt").value,day:Math.min(28,Math.max(1,+$("#b-day").value||1)),cat:$("#b-cat").value,acc:$("#b-acc").value,varies:$("#b-var").checked};
  if(editBill) Object.assign(S.config.bills.find(x=>x.id===b.id),b); else S.config.bills.push(b);
  persist("config"); render(); toast(editBill?"Bill updated":"Bill added");
};
$("#b-del").onclick=()=>{ if(!confirm("Delete this bill? Past payments stay in your transactions."))return;
  S.config.bills=S.config.bills.filter(b=>b.id!==editBill.id); persist("config"); $("#d-bill").close(); render(); toast("Bill deleted"); };
function openPlan(p){
  editPlan=p||null; $("#plan-title").textContent=p?"Edit planned purchase":"Add planned purchase"; $("#p-del").hidden=!p;
  $("#p-name").value=p?p.name:""; $("#p-amt").value=p?p.amount:""; $("#p-est").checked=!!(p&&p.est); $("#p-reimb").checked=!!(p&&p.reimb);
  opts("#p-cat",EXP,p?p.cat:"Shopping"); $("#d-plan").showModal();
}
$("#f-plan").onsubmit=()=>{
  const p={id:editPlan?editPlan.id:uid(),name:$("#p-name").value.trim(),amount:+$("#p-amt").value,cat:$("#p-cat").value,est:$("#p-est").checked,reimb:$("#p-reimb").checked};
  if(editPlan) Object.assign(S.config.plans.find(x=>x.id===p.id),p); else S.config.plans.push(p);
  persist("config"); render(); toast(editPlan?"Item updated":"Item added");
};
$("#p-del").onclick=()=>{ if(!confirm("Remove this item from your plan?"))return;
  S.config.plans=S.config.plans.filter(p=>p.id!==editPlan.id); persist("config"); $("#d-plan").close(); render(); toast("Item removed"); };
$("#new-bill").onclick=()=>openBill();
$("#new-plan").onclick=()=>openPlan();

/* ---------- quick buttons ---------- */
// Suggested from your spending: Nov 2026 entries (tea, water can, breakfast, petrol, Porter, groceries, DTH, movie, games, salon, gifts…)
const DEFAULT_BUTTONS=[
  ["Tea","☕","Food"],["Water can","💧","Food"],["Breakfast","🍳","Food"],["Lunch","🍛","Food"],["Dinner","🍽️","Food"],["Snacks / juice","🥤","Food"],
  ["Petrol","⛽","Transport"],["Porter / cab","🚚","Transport"],["Groceries","🛒","Groceries"],["Fruits / veg","🥬","Groceries"],
  ["Recharge / bills","📱","Bills"],["Gas cylinder","🔥","Bills"],["Movie","🎬","Entertainment"],["Games","🎮","Entertainment"],
  ["Salon","💇","Other"],["Shopping","🛍️","Shopping"],["Family","👪","Family"],["Gift","🎁","Family"],["Medicine","💊","Health"]
].map(([name,emoji,cat],i)=>({id:"d"+i,name,emoji,cat}));
const buttons=()=>S.config.buttons||DEFAULT_BUTTONS;
let qDay="today", qAcc=null, qBtn=null;
function lastAmount(b){
  const n=b.name.toLowerCase().split(/\s*\/\s*/)[0];
  const hit=allTx().filter(t=>t.type==="expense"&&(t.note||"").toLowerCase().startsWith(n)).sort((a,c)=>(c.date+c.id).localeCompare(a.date+a.id))[0];
  return hit?hit.amount:"";
}
const btnTile=(b,sel)=>`<button type="button" class="qbtn" data-qb="${esc(b.id)}" aria-pressed="${sel?"true":"false"}"><span class="e" aria-hidden="true">${esc(b.emoji)}</span>${esc(b.name)}</button>`;
function renderQuickTiles(){
  const tiles=buttons().map(b=>btnTile(b,qBtn===b.id)).join("");
  $("#q-btns").innerHTML=tiles+`<button type="button" class="qbtn add" data-editbtns="1"><span class="e" aria-hidden="true">＋</span>New</button>`;
}
function quickSave(t){
  t.id=uid(); const k=putTx(t); persist(k); render();
  toast(`Saved ${fmt(t.amount)} · ${t.note||t.cat}`,()=>{ persist(removeTx(t)); render(); toast("Removed"); });
}
function openQuick(btnId){
  if(!S.config.accounts.length){ toast("Add an account first"); location.hash="accounts"; openAcct(); return; }
  const saved=lsGet("mb-acc");
  qAcc=S.config.accounts.some(a=>a.id===saved)?saved:S.config.accounts[0].id; qDay="today"; qBtn=null;
  $("#q-form").hidden=true; $("#q-amt").value=""; $("#q-note").value="";
  renderQuickTiles(); renderQuickPicks();
  if(!$("#d-quick").open) $("#d-quick").showModal();
  if(btnId) pickButton(btnId);
}
function pickButton(id){
  const b=buttons().find(x=>x.id===id); if(!b) return;
  qBtn=id; renderQuickTiles();
  $("#q-sel").innerHTML=`${esc(b.emoji)} ${esc(b.name)} <span>· ${esc(b.cat)}</span>`;
  $("#q-form").hidden=false;
  const a=$("#q-amt"); a.value=lastAmount(b);
  setTimeout(()=>{ a.focus({preventScroll:true}); a.select(); $("#q-form").scrollIntoView({block:"start",behavior:"smooth"}); },50);
}
function renderQuickPicks(){
  $("#q-day").innerHTML=[["today","Today"],["yesterday","Yesterday"]].map(([v,l])=>`<button type="button" class="chip" data-qday="${v}" aria-pressed="${qDay===v}">${l}</button>`).join("");
  $("#q-acc").innerHTML=S.config.accounts.length>1?S.config.accounts.map(a=>`<button type="button" class="chip" data-qacc="${esc(a.id)}" aria-pressed="${qAcc===a.id}">${esc(a.name)}</button>`).join(""):"";
}
function qDate(){ const d=new Date(); if(qDay==="yesterday") d.setDate(d.getDate()-1); return iso(d); }
$("#f-quick").onsubmit=e=>{
  e.preventDefault();
  const b=buttons().find(x=>x.id===qBtn); if(!b) return;
  const amount=Math.round(+$("#q-amt").value*100)/100;
  if(!(amount>0)||amount>=1e8){ toast("Enter the amount"); $("#q-amt").focus(); return; }
  const note=$("#q-note").value.trim();
  $("#d-quick").close();
  quickSave({type:"expense",amount,cat:b.cat in EXP?b.cat:"Other",date:qDate(),acc:qAcc,note:note?`${b.name} – ${note}`:b.name});
};
$("#d-quick").addEventListener("click",e=>{
  const el=e.target.closest("[data-qday],[data-qacc],[data-qb]"); if(!el) return;
  if(el.dataset.qb){ pickButton(el.dataset.qb); return; }
  if(el.dataset.qday){ qDay=el.dataset.qday; renderQuickPicks(); return; }
  if(el.dataset.qacc){ qAcc=el.dataset.qacc; lsSet("mb-acc",qAcc); renderQuickPicks(); }
});
$("#q-more").onclick=()=>{ const amt=+$("#q-amt").value||""; $("#d-quick").close(); openTx(null,{type:"income",amount:amt,cat:"Salary",acc:qAcc,date:qDate()}); };
// Overview tiles open the quick screen with that button chosen
document.addEventListener("click",e=>{ const el=e.target.closest("#quick [data-qb]"); if(el) openQuick(el.dataset.qb); });

/* ---------- edit buttons & categories ---------- */
function catOptions(sel,val){
  $(sel).innerHTML=Object.keys(EXP).map(k=>`<option value="${esc(k)}" ${k===val?"selected":""}>${esc(EXP[k])} ${esc(k)}</option>`).join("")+`<option value="__new">＋ New category…</option>`;
}
function addCategory(name,emoji){
  const n=clip(name,24).trim(); if(!n) throw "Give the new category a name.";
  if(n==="__new") throw "Pick another name.";
  const existing=Object.keys(EXP).find(k=>k.toLowerCase()===n.toLowerCase()); if(existing) return existing;
  if(Object.keys(S.config.cats||{}).length>=40) throw "You have a lot of categories already. Remove one first.";
  S.config.cats={...(S.config.cats||{}),[n]:clip(emoji||"🏷️",8)}; applyCats(); return n;
}
function openBtns(){
  const list=buttons();
  $("#btn-list").innerHTML=list.map(b=>`<div class="bl"><span class="e" aria-hidden="true">${esc(b.emoji)}</span><span>${esc(b.name)}<small>${esc(b.cat)}</small></span><button type="button" aria-label="Remove ${esc(b.name)}" data-rmb="${esc(b.id)}">×</button></div>`).join("")||`<div class="empty">No buttons yet.</div>`;
  catOptions("#nb-cat","Food"); $("#nb-newcat-l").hidden=true; $("#nb-name").value=""; $("#nb-emoji").value=""; $("#nb-newcat").value="";
  if(!$("#d-btns").open) $("#d-btns").showModal();
}
document.addEventListener("click",e=>{ if(e.target.closest("[data-editbtns]")){ if($("#d-quick").open) $("#d-quick").close(); openBtns(); } });
$("#nb-cat").onchange=()=>{ $("#nb-newcat-l").hidden=$("#nb-cat").value!=="__new"; };
$("#btn-list").addEventListener("click",e=>{
  const id=e.target.closest("[data-rmb]")&&e.target.closest("[data-rmb]").dataset.rmb; if(!id) return;
  S.config.buttons=buttons().filter(b=>b.id!==id); persist("config"); render(); openBtns();
});
$("#nb-reset").onclick=()=>{ if(!confirm("Bring back the suggested buttons? Your own buttons will be removed.")) return; S.config.buttons=null; persist("config"); render(); openBtns(); };
$("#f-btns").onsubmit=e=>{
  e.preventDefault();
  const name=$("#nb-name").value.trim(); if(!name){ toast("Give the button a name"); $("#nb-name").focus(); return; }
  if(buttons().length>=60){ toast("That's the maximum number of buttons"); return; }
  const emoji=[...$("#nb-emoji").value.trim()].slice(0,2).join("")||"🏷️";
  let cat=$("#nb-cat").value;
  try{ if(cat==="__new") cat=addCategory($("#nb-newcat").value,emoji); }catch(m){ toast(m); return; }
  S.config.buttons=[...buttons(),{id:uid(),name:clip(name,24),emoji,cat}];
  persist("config"); render(); toast(`Added “${name}”`); openBtns();
};

/* ---------- match bank balance ---------- */
function openMatch(){
  if(!S.config.accounts.length){ toast("Add an account first"); return; }
  accOpts("#mt-acc",S.config.accounts[0].id); $("#mt-amt").value=""; matchDiff(); $("#d-match").showModal();
  setTimeout(()=>$("#mt-amt").focus(),50);
}
function matchDiff(){
  const book=balances()[$("#mt-acc").value]||0, v=$("#mt-amt").value;
  if(v===""){ $("#mt-diff").textContent=`Money Book shows ${fmt(book)} for this account.`; return; }
  const d=Math.round((book-(+v))*100)/100;
  $("#mt-diff").textContent = d===0?"Already matches. Nothing to add."
    : d>0 ? `Book shows ${fmt(book)}. Adds ${fmt(d)} of untracked spending.` : `Book shows ${fmt(book)}. Adds ${fmt(-d)} of unrecorded money in.`;
}
$("#mt-amt").oninput=matchDiff; $("#mt-acc").onchange=matchDiff;
$("#f-match").onsubmit=e=>{
  const acc=$("#mt-acc").value, v=$("#mt-amt").value; if(v===""){ e.preventDefault(); return; }
  const d=Math.round(((balances()[acc]||0)-(+v))*100)/100;
  if(d===0){ toast("Already matches"); return; }
  const t={id:uid(),acc,date:today(),cat:"Other",amount:Math.abs(d),
    type:d>0?"expense":"income",note:d>0?`Miscellaneous – untracked spends (matched to bank: ${fmt(+v)})`:`Unrecorded money in (matched to bank: ${fmt(+v)})`};
  persist(putTx(t)); render(); toast("Balance matched");
};

document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>b.closest("dialog").close());

/* ---------- events ---------- */
$("#fab").onclick=()=>openQuick();
document.addEventListener("click",e=>{ if(e.target.closest("[data-match]")) openMatch(); });
$("#new-goal").onclick=()=>openGoal();
$("#new-acct").onclick=()=>openAcct();
$("#prev").onclick=()=>{ const d=new Date(viewMonth+"-01T00:00:00"); d.setMonth(d.getMonth()-1); viewMonth=d.toISOString().slice(0,7); filter="all"; render(); };
$("#next").onclick=()=>{ const d=new Date(viewMonth+"-15T00:00:00"); d.setMonth(d.getMonth()+1); viewMonth=d.toISOString().slice(0,7); filter="all"; render(); };
document.addEventListener("click",e=>{
  const el=e.target.closest("[data-go],[data-tx],[data-f],[data-goal],[data-fund],[data-acct],[data-bill],[data-paybill],[data-plan],[data-buy],[data-back]"); if(!el) return;
  const d=el.dataset;
  if(d.bill){ openBill(S.config.bills.find(b=>b.id===d.bill)); return; }
  if(d.paybill){ const b=S.config.bills.find(x=>x.id===d.paybill); const due=d.period+"-"+String(Math.min(28,b.day)).padStart(2,"0");
    openTx(null,{type:"expense",amount:b.amount,cat:b.cat,acc:b.acc,note:b.name,date:due<today()?due:today(),link:{bill:b.id,period:d.period}}); return; }
  if(d.plan){ openPlan(S.config.plans.find(p=>p.id===d.plan)); return; }
  if(d.buy){ const p=S.config.plans.find(x=>x.id===d.buy); openTx(null,{type:"expense",amount:p.amount,cat:p.cat,note:p.name,link:{plan:p.id}}); return; }
  if(d.back){ const p=S.config.plans.find(x=>x.id===d.back); openTx(null,{type:"income",amount:planBought(p)?planBought(p).amount:p.amount,cat:"Reimbursement",note:p.name,link:{reimb:p.id}}); return; }
  if(el.dataset.go){ location.hash=el.dataset.go; if(el.dataset.go==="accounts"&&!S.config.accounts.length) openAcct(); if(el.dataset.go==="goals"&&!S.config.goals.length&&el.textContent.includes("Create")) openGoal(); }
  else if(el.dataset.tx){ openTx((S.months[el.dataset.m]||[]).find(t=>t.id===el.dataset.tx)); }
  else if(el.dataset.f){ filter=el.dataset.f; render(); }
  else if(el.dataset.goal){ openGoal(S.config.goals.find(g=>g.id===el.dataset.goal)); }
  else if(el.dataset.fund){ openFund(S.config.goals.find(g=>g.id===el.dataset.fund)); }
  else if(el.dataset.acct){ openAcct(S.config.accounts.find(a=>a.id===el.dataset.acct)); }
});
document.addEventListener("change",e=>{
  const c=e.target.dataset&&e.target.dataset.budget; if(!c) return;
  const v=+e.target.value; if(v>0) S.config.budgets[c]=v; else delete S.config.budgets[c];
  persist("config"); render(); toast("Limit saved");
});
$("#export").onclick=async()=>{
  const rows=[["Date","Type","Category / Goal","Amount","Account","To account","Note"]];
  allTx().sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>rows.push([t.date,t.type,t.type==="save"?goalName(t.goal):(t.cat||""),t.amount,accName(t.acc),t.to?accName(t.to):"",t.note||""]));
  const cell=v=>{ let s=String(v); if(/^[=+\-@\t\r]/.test(s)&&typeof v!=="number") s="'"+s; return `"${s.replace(/"/g,'""')}"`; };
  const csv=rows.map(r=>r.map(cell).join(",")).join("\n");
  download(`money-book-${today()}.csv`,"﻿"+csv,"text/csv");
};
async function download(name,text,type){
  const blob=new Blob([text],{type});
  try{
    const file=new File([blob],name,{type});
    if(navigator.canShare&&navigator.canShare({files:[file]})){ await navigator.share({files:[file],title:name}); return true; }
  }catch(e){ if(e&&e.name==="AbortError") return false; }
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000); return true;
}
function showLastBackup(){ const v=(()=>{try{return localStorage.getItem("mb-last-backup")}catch(e){return null}})();
  $("#last-backup").textContent = v ? `Last backup: ${new Date(v).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}.` : "No backup saved yet."; }
$("#backup").onclick=async()=>{
  const ok=await download(`money-book-backup-${today()}.json`,JSON.stringify({app:"moneybook",version:1,saved:new Date().toISOString(),...S}),"application/json");
  if(ok){ try{localStorage.setItem("mb-last-backup",new Date().toISOString())}catch(e){} showLastBackup(); toast("Backup saved"); }
};
$("#restore").onclick=()=>$("#restore-file").click();
$("#restore-file").onchange=async e=>{
  const f=e.target.files&&e.target.files[0]; e.target.value=""; if(!f) return;
  if(f.size>5e6){ toast("That file is too large to be a Money Book backup"); return; }
  let data; try{ data=normalize(JSON.parse(await f.text())); }catch(err){ toast("That isn't a Money Book backup file"); return; }
  const n=Object.values(data.months).flat().length;
  const hasData=Object.values(S.months).flat().length>0;
  if(!confirm(`Restore ${n} entries and ${data.config.accounts.length} accounts from this backup?${hasData?" This replaces your current entries"+(sb&&sbUser?" here and in your database.":"."):""}`)) return;
  const months=new Set([...Object.keys(S.months),...Object.keys(data.months),...Object.values(synced).map(x=>x.m)]);
  S=data; dirty.months=[...months]; dirty.config=true;
  applyCats(); saveLocal(); saveMeta(); render(); scheduleSync(0);
  toast(sb&&sbUser?`Restored ${n} entries · syncing`:`Restored ${n} entries`);
};
showLastBackup();
if("serviceWorker" in navigator && window.isSecureContext){ addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{})); }
let tt; function toast(m,undo){
  const t=$("#toast"); t.textContent=m; t.classList.toggle("act",!!undo);
  if(undo){ const b=document.createElement("button"); b.type="button"; b.textContent="Undo"; b.onclick=()=>{ t.classList.remove("show","act"); clearTimeout(tt); undo(); }; t.appendChild(b); }
  t.classList.add("show"); clearTimeout(tt); tt=setTimeout(()=>t.classList.remove("show","act"),undo?5000:2000);
}

/* ---------- savings challenges ---------- */
const chList=()=>S.config.challenges||[];
const r2=n=>Math.round(n*100)/100;
const chAmt=(h,n)=>r2(h.start+(n-1)*h.step);
const chTarget=h=>r2(h.days*h.start+h.step*h.days*(h.days-1)/2);
const addDays=(d,n)=>{ const x=new Date(d+"T00:00:00"); x.setDate(x.getDate()+n); return iso(x); };
const chDayDate=(h,n)=>addDays(h.startDate,n-1);
const chTodayN=h=>Math.floor((new Date(today()+"T00:00:00")-new Date(h.startDate+"T00:00:00"))/86400000)+1;
function chEntries(h){ const m={}; allTx().forEach(t=>{ if(t.type==="save"&&t.goal===h.id&&/^cday:\d+$/.test(t.plan||"")) m[+t.plan.slice(5)]=t; }); return m; }
const chSaved=h=>Object.values(chEntries(h)).reduce((s,t)=>s+t.amount,0);
function chStats(h){
  const done=chEntries(h), tn=chTodayN(h), last=Math.min(h.days,tn);
  let missed=0; for(let n=1;n<Math.min(tn,h.days+1);n++) if(!done[n]) missed++;
  let streak=0; for(let n=done[last]?last:last-1;n>=1&&done[n];n--) streak++;
  let next7=0; for(let n=Math.max(1,tn+(done[tn]?1:0));n<=Math.min(h.days,tn+6);n++) if(!done[n]) next7+=chAmt(h,n);
  const saved=Object.values(done).reduce((s,t)=>s+t.amount,0);
  const withdrawn=r2(allTx().filter(t=>t.type==="transfer"&&t.acc==="ch:"+h.id).reduce((s,t)=>s+t.amount,0));
  return {done,tn,missed,streak,next7:r2(next7),saved:r2(saved),withdrawn,pot:r2(saved-withdrawn),target:chTarget(h),count:Object.keys(done).length,finished:tn>h.days};
}
const dshortD=d=>new Date(d+"T00:00:00").toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"});
function dayRow(h,st,n){
  const d=!!st.done[n], fut=n>st.tn, isToday=n===st.tn, missed=!d&&n<st.tn;
  const amt=d?st.done[n].amount:chAmt(h,n);
  const cls=["day-r",d?"done":"",isToday?"today":"",missed?"missed":""].join(" ");
  const tag=isToday?"Today":missed?"Missed":fut?"":"";
  return `<button type="button" class="${cls}" data-chday="${esc(h.id)}:${n}" data-n="${n}" ${fut?"disabled":""} role="checkbox" aria-checked="${d}" aria-label="Day ${n}, ${dshortD(chDayDate(h,n))}, ${fmt(amt)}${d?", done":fut?", upcoming":", not done"}">
    <span class="box" aria-hidden="true">${d?"✓":""}</span>
    <span class="lbl"><b>Day ${n}</b>${tag?` <em>${tag}</em>`:""}<small>${dshortD(chDayDate(h,n))}</small></span>
    <span class="num amt-r">${fmt(amt)}</span></button>`;
}
function chCard(h,mini){
  const st=chStats(h), pct=Math.min(100,st.saved/st.target*100);
  const top=`<div class="ch-top"><div><h4>${esc(h.name)}</h4><p class="num">${fmt(h.start)} on day 1${h.step?`, +${fmt(h.step)} each day`:" every day"} · ${h.days} days</p></div>${mini?"":`<button type="button" class="link" data-chedit="${esc(h.id)}">Edit</button>`}</div>`;
  const savedBox=`<div class="ch-today ok"><span><small>Saved so far</small><span class="amt num">${fmt(st.saved)}</span></span><span class="num" style="text-align:right;color:var(--muted);font-size:13px">of ${fmt(st.target)}<br>${st.count}/${h.days} days</span></div>`;
  const bar=`<div class="ch-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="${esc(h.name)} progress"><div style="width:${pct}%"></div></div>`;
  let todayLine;
  if(st.tn<1) todayLine=`<div class="ch-nums num"><span>Starts ${dshortD(h.startDate)}</span><span>Day 1 · <b>${fmt(chAmt(h,1))}</b></span></div>`;
  else if(st.finished) todayLine=`<div class="ch-nums"><span>Challenge finished</span><span><b>${st.count}</b> of ${h.days} days saved</span></div>`;
  else { const td=st.done[st.tn], a=td?td.amount:chAmt(h,st.tn);
    todayLine=`<div class="ch-nums num" style="align-items:center"><span>Today · Day ${st.tn} · <b>${fmt(a)}</b></span>${td?`<span class="in" style="font-weight:700">✓ Saved</span>`:`<button type="button" class="btn sm" data-chday="${esc(h.id)}:${st.tn}">Mark saved</button>`}</div>`; }
  const remind=h.cashAt>0&&st.pot>=h.cashAt;
  const potLine=(st.withdrawn>0||st.pot>0)?`<div class="ch-pot${remind?" hit":""}"><span>${remind?`<b>${fmt(h.cashAt)} reached!</b> `:""}In challenge <b class="num">${fmt(st.pot)}</b>${st.withdrawn?` · Moved to cash <b class="num">${fmt(st.withdrawn)}</b>`:""}</span><button type="button" class="btn ${remind?"":"ghost "}sm" data-chwd="${esc(h.id)}">Move to cash</button></div>`:"";
  if(mini){
    const from=Math.max(1,Math.min(st.tn-2,h.days-4)), to=Math.min(h.days,from+4);
    let rows=""; for(let n=from;n<=to;n++) rows+=dayRow(h,st,n);
    return `<div class="ch">${top}${savedBox}${potLine}${bar}${todayLine}<div class="day-rows mini">${rows}</div></div>`;
  }
  const stats=`<div class="ch-stats num"><div><b>${st.streak}🔥</b>day streak</div><div><b class="${st.missed?"out":""}">${st.missed}</b>missed days</div><div><b>${fmt(st.next7)}</b>next 7 days</div></div>`;
  let rows=""; for(let n=1;n<=h.days;n++) rows+=dayRow(h,st,n);
  return `<div class="ch${st.finished&&st.count===h.days?" done":""}">${top}${savedBox}${potLine}${bar}${todayLine}${stats}<div class="day-rows" data-rows="${esc(h.id)}">${rows}</div><p class="hint">Tap a day to mark it done, tap again to undo. Missed days can be caught up any time.</p></div>`;
}
const chScroll={};
function renderChallenges(){
  document.querySelectorAll("#ch-list [data-rows]").forEach(el=>{ chScroll[el.dataset.rows]=el.scrollTop; });
  const list=chList();
  $("#ch-list").innerHTML=list.length?list.map(h=>chCard(h,false)).join(""):`<div class="empty">No challenge yet. Start small, like ₹5 today and ₹5 more each day.<br><button class="btn sm" id="ch-empty-new" type="button">Start a challenge</button></div>`;
  document.querySelectorAll("#ch-list [data-rows]").forEach(el=>{
    const id=el.dataset.rows;
    if(id in chScroll) el.scrollTop=chScroll[id];
    else { const h=list.find(x=>x.id===id); const n=Math.max(1,Math.min(h.days,chTodayN(h))-2); const row=el.querySelector(`[data-n="${n}"]`); if(row) el.scrollTop=row.offsetTop-el.offsetTop; }
  });
  const active=list.filter(h=>{ const n=chTodayN(h); return n>=1&&n<=h.days; });
  $("#ch-mini-block").hidden=!active.length;
  $("#ch-mini").innerHTML=active.map(h=>chCard(h,true)).join("");
}
function chToggle(id,n){
  const h=chList().find(x=>x.id===id); if(!h||n<1||n>h.days||n>chTodayN(h)) return;
  const ex=chEntries(h)[n];
  if(ex){ const k=removeTx(ex); persist(k); render(); toast(`Day ${n} unticked`,()=>{ persist(putTx(ex)); render(); }); return; }
  if(!S.config.accounts.some(a=>a.id===h.acc)){ toast("Pick which account the money comes from"); openCh(h); return; }
  const d=chDayDate(h,n), t={id:uid(),type:"save",goal:h.id,plan:"cday:"+n,amount:chAmt(h,n),acc:h.acc,date:d>today()?today():d,note:`${h.name} · day ${n}`};
  persist(putTx(t)); render();
  toast(`Day ${n} saved · ${fmt(t.amount)}`,()=>{ persist(removeTx(t)); render(); });
}
let editCh=null;
function openCh(h){
  if(!S.config.accounts.length){ toast("Add an account first"); location.hash="accounts"; openAcct(); return; }
  editCh=h||null;
  $("#ch-title").textContent=h?"Edit challenge":"New savings challenge"; $("#ch-save").textContent=h?"Save changes":"Start challenge";
  $("#ch-del").hidden=!h; $("#ch-note").hidden=!h||!Object.keys(chEntries(h)).length; $("#ch-presets").hidden=!!h;
  $("#ch-name").value=h?h.name:"100-day challenge"; $("#ch-start").value=h?h.start:5; $("#ch-step").value=h?h.step:5; $("#ch-days").value=h?h.days:100;
  $("#ch-cashat").value=h?(h.cashAt||""):500;
  $("#ch-date").value=h?h.startDate:today(); accOpts("#ch-acc",h&&h.acc?h.acc:(lsGet("mb-acc")||S.config.accounts[0].id));
  chPreview(); $("#d-ch").showModal();
}
function chForm(){ return {name:$("#ch-name").value.trim(),start:r2(+$("#ch-start").value),step:r2(+$("#ch-step").value),days:Math.round(+$("#ch-days").value),startDate:$("#ch-date").value,acc:$("#ch-acc").value,cashAt:Math.max(0,r2(+$("#ch-cashat").value||0))}; }
function chPreview(){
  const f=chForm(), el=$("#ch-prev");
  if(!(f.start>0)||f.step<0||!(f.days>=1&&f.days<=366)||!f.startDate){ el.innerHTML="Enter the day 1 amount, the daily increase (0 for the same amount every day) and the number of days."; return; }
  const total=chTarget(f), lastAmt=chAmt(f,f.days), end=new Date(chDayDate(f,f.days)+"T00:00:00");
  const months={}; for(let n=1;n<=f.days;n++){ const k=chDayDate(f,n).slice(0,7); months[k]=(months[k]||0)+chAmt(f,n); }
  const mlist=Object.entries(months).map(([k,v])=>`${new Date(k+"-01T00:00:00").toLocaleDateString("en-IN",{month:"short",year:"2-digit"})} ${fmt(v)}`).join(" · ");
  el.innerHTML=`<span>Day 1 <b>${fmt(f.start)}</b> → Day ${f.days} <b>${fmt(lastAmt)}</b></span><span>Total saved: <b>${fmt(total)}</b> by ${end.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</span><span style="color:var(--muted)">${mlist}</span>`;
}
["#ch-start","#ch-step","#ch-days","#ch-date"].forEach(s=>$(s).addEventListener("input",chPreview));
$("#ch-presets").addEventListener("click",e=>{ const b=e.target.closest("[data-chp]"); if(!b) return; const [a,s,d]=b.dataset.chp.split(",").map(Number);
  $("#ch-start").value=a; $("#ch-step").value=s; $("#ch-days").value=d; $("#ch-name").value=s?`${d}-day challenge`:`${fmt(a)} a day`; chPreview(); });
$("#f-ch").onsubmit=e=>{
  const f=chForm();
  if(!f.name||!(f.start>0)||f.start>100000||f.step<0||f.step>100000||!(f.days>=1&&f.days<=366)||!f.startDate){ e.preventDefault(); toast("Check the amounts and number of days"); return; }
  if(chTarget(f)>=1e8){ e.preventDefault(); toast("That challenge is too large"); return; }
  if(editCh){
    const maxDone=Math.max(0,...Object.keys(chEntries(editCh)).map(Number));
    if(f.days<maxDone){ e.preventDefault(); toast(`You've already ticked day ${maxDone}. Keep at least ${maxDone} days.`); return; }
    if(f.startDate!==editCh.startDate&&Object.keys(chEntries(editCh)).length){ e.preventDefault(); toast("The start date can't change after you've ticked days"); return; }
    Object.assign(S.config.challenges.find(x=>x.id===editCh.id),f);
  } else {
    if(chList().length>=20){ e.preventDefault(); toast("That's the maximum number of challenges"); return; }
    S.config.challenges=[...chList(),{id:"ch-"+uid(),...f}];
  }
  lsSet("mb-acc",f.acc); persist("config"); render(); toast(editCh?"Challenge updated":"Challenge started. Tick today when you save!");
};
$("#ch-del").onclick=()=>{
  const n=Object.keys(chEntries(editCh)).length;
  if(!confirm(n?`Delete this challenge? Its ${n} saved days are removed and the money goes back to the account in your book.`:"Delete this challenge?")) return;
  const id=editCh.id; S.config.challenges=chList().filter(h=>h.id!==id);
  Object.keys(S.months).forEach(k=>{ const b=S.months[k].length; S.months[k]=S.months[k].filter(t=>!(t.type==="save"&&t.goal===id)); if(S.months[k].length!==b) persist(k); });
  persist("config"); $("#d-ch").close(); render(); toast("Challenge deleted");
};
$("#new-ch").onclick=()=>openCh();
document.addEventListener("click",e=>{
  const d=e.target.closest("[data-chday]"); if(d){ const i=d.dataset.chday.lastIndexOf(":"); chToggle(d.dataset.chday.slice(0,i),+d.dataset.chday.slice(i+1)); return; }
  const ed=e.target.closest("[data-chedit]"); if(ed){ openCh(chList().find(h=>h.id===ed.dataset.chedit)); return; }
  if(e.target.closest("#ch-empty-new")) openCh();
  const w=e.target.closest("[data-chwd]"); if(w) openWd(w.dataset.chwd);
});

/* ---------- move challenge money to cash ---------- */
let wdCh=null;
function openWd(id){
  const h=chList().find(x=>x.id===id); if(!h) return; const st=chStats(h);
  if(!(st.pot>0)){ toast("Nothing in this challenge to move yet"); return; }
  wdCh=h; $("#wd-title").textContent=`Move ${h.name} money`;
  $("#wd-amt").value=st.pot; $("#wd-amt").max=st.pot; $("#wd-date").value=today();
  const cash=S.config.accounts.find(a=>a.type==="Cash"); accOpts("#wd-acc",cash?cash.id:S.config.accounts[0].id);
  $("#wd-hint").textContent=`Up to ${fmt(st.pot)} is in this challenge. Your days and streak stay exactly as they are.`;
  $("#d-wd").showModal();
}
$("#f-wd").onsubmit=e=>{
  const st=chStats(wdCh), amount=r2(+$("#wd-amt").value);
  if(!(amount>0)||amount>st.pot+0.001){ e.preventDefault(); toast(`Enter up to ${fmt(st.pot)}`); return; }
  const t={id:uid(),type:"transfer",acc:"ch:"+wdCh.id,to:$("#wd-acc").value,amount,date:$("#wd-date").value||today(),note:`${wdCh.name} savings`};
  persist(putTx(t)); render();
  toast(`${fmt(amount)} moved to ${accName(t.to)}`,()=>{ persist(removeTx(t)); render(); });
};

route(); initStore();
if(new URLSearchParams(location.search).has("add")){ history.replaceState(null,"",location.pathname+location.hash); setTimeout(openQuick,200); }
