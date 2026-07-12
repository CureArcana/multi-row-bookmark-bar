(function(){"use strict";
const getFav=u=>{try{return`https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(u).hostname)}&sz=32`}catch{return""}};
const FOLD=`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="#F0B400" d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25V4.75A1.75 1.75 0 0 0 14.25 3H8L6.56 1.22A.75.75 0 0 0 6 1H1.75z"/><path fill="#F9D648" d="M0 5.5h16v7.75A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V5.5z"/></svg>')}`;
const LINK=`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#e8eaed" stroke="#9aa0a6" stroke-width="1"/><path fill="#5f6368" d="M5 8a3 3 0 0 1 3-3h1v1.5H8a1.5 1.5 0 0 0 0 3h1V11H8a3 3 0 0 1-3-3zm2-.25h2v.5H7v-.5zM8 5h1a3 3 0 0 1 0 6H8V9.5h1a1.5 1.5 0 0 0 0-3H8V5z"/></svg>')}`;
const SK="mrbb-settings",DF={enabled:true,maxRows:0,displayMode:"both",folderOpenMode:"hover",showCondition:"always",fontSize:12,barHeight:34};
let _c=null;
function tw(t,fs){if(!_c)_c=document.createElement("canvas");const x=_c.getContext("2d");x.font=`${fs}px "Segoe UI",system-ui,-apple-system,sans-serif`;return Math.min(x.measureText(t).width,150)}
function iw(bm,dm,fs=12){let w=16;if(dm!=="text_only")w+=16;if(dm!=="icon_only"&&bm.title){if(dm!=="text_only")w+=6;w+=tw(bm.title,fs)}return Math.ceil(w)}
function calcLayout(bms,ww,s){const r=[];if(!bms.length)return r;const fs=s.fontSize||12,GW=24,SW=24,av=ww-16;let cr=0,ru=0;
for(let i=0;i<bms.length;i++){const bm=bms[i],w=iw(bm,s.displayMode,fs),ef=cr===0?av-GW-SW:av;
if(ru+w>ef&&ru>0){cr++;ru=0;if(s.maxRows>0&&cr>=s.maxRows)break;r.push({bookmark:bm,width:w,row:cr});ru+=w;continue}
r.push({bookmark:bm,width:w,row:cr});ru+=w}return r}
function mkItem(bm,dm){const a=document.createElement("a");a.className="mrbb-item";a.dataset.bmId=bm.id;a.draggable=true;
if(bm.isFolder){a.classList.add("mrbb-folder");a.href="#";a.addEventListener("click",e=>e.preventDefault())}else{a.classList.add("mrbb-link");a.href=bm.url||"#"}
if(dm!=="text_only"){const img=document.createElement("img");img.className="mrbb-favicon";img.width=16;img.height=16;
if(bm.isFolder)img.src=FOLD;else if(bm.url){img.src=getFav(bm.url);img.onerror=()=>{img.src=LINK}}else img.src=LINK;a.appendChild(img)}
if(dm!=="icon_only"){const sp=document.createElement("span");sp.className="mrbb-title";sp.textContent=bm.title||(bm.isFolder?"フォルダ":"");a.appendChild(sp)}
return a}
let dsi=null,di=null,dt=null,ft=null,dg=null;
function isDrag(){return dsi!==null}
function setDS(id){dsi=id}
function setupDrag(bar){bar.addEventListener("dragstart",onDS);bar.addEventListener("dragover",onDO);bar.addEventListener("dragend",()=>cleanDrag());bar.addEventListener("drop",e=>{e.preventDefault();exDrop()})}
function setupDDD(dd,pid){dd.addEventListener("dragover",e=>{e.preventDefault();e.stopPropagation();if(!dsi)return;e.dataTransfer.dropEffect="move";
const rows=[...dd.querySelectorAll(".mrbb-dropdown-row")],ind=gInd();let bef=null,yp=0;
for(const row of rows){const rc=row.getBoundingClientRect();
if(row.classList.contains("mrbb-dropdown-folder")&&e.clientY>=rc.top+rc.height*.25&&e.clientY<=rc.top+rc.height*.75){cFT();row.classList.add("mrbb-folder-drop-target");ft=row;dt={parentId:row.dataset.bmId};hInd();return}
if(e.clientY<rc.top+rc.height/2){bef=row;yp=rc.top;break}}
cFT();if(!bef&&rows.length>0)yp=rows[rows.length-1].getBoundingClientRect().bottom;
const dr=dd.getBoundingClientRect();ind.style.cssText=`position:fixed;top:${yp-1}px;left:${dr.left+8}px;width:${dr.width-16}px;height:2px;z-index:2147483647`;
if(!ind.parentElement)document.body.appendChild(ind);dt=bef?{parentId:pid,index:rows.indexOf(bef)}:{parentId:pid,index:rows.length}});
dd.addEventListener("drop",e=>{e.preventDefault();e.stopPropagation();exDrop()})}
function gInd(){if(!di){di=document.createElement("div");di.className="mrbb-drop-indicator"}return di}
function cFT(){if(ft){ft.classList.remove("mrbb-folder-drop-target");ft=null}document.querySelectorAll(".mrbb-folder-drop-target").forEach(e=>e.classList.remove("mrbb-folder-drop-target"))}
function hInd(){if(di){di.remove();di=null}}
function onDS(e){const it=e.target.closest(".mrbb-item");if(!it?.dataset.bmId)return;dsi=it.dataset.bmId;it.classList.add("mrbb-dragging");e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",dsi);
if(e.dataTransfer.setDragImage){const cl=it.cloneNode(true);cl.style.cssText="opacity:0.8;position:absolute;top:-1000px;left:-1000px";document.body.appendChild(cl);e.dataTransfer.setDragImage(cl,e.offsetX,e.offsetY);dg=cl}}
function onDO(e){e.preventDefault();if(!dsi)return;e.dataTransfer.dropEffect="move";const bar=e.currentTarget;let tr=null;
for(const row of bar.querySelectorAll(".mrbb-row")){const rc=row.getBoundingClientRect();if(e.clientY>=rc.top&&e.clientY<=rc.bottom){tr=row;break}}
if(!tr){hInd();cFT();return}
const its=[...tr.querySelectorAll(".mrbb-item:not(.mrbb-dragging)")];let bef=null,xp=0;
for(const it of its){const rc=it.getBoundingClientRect();
if(it.classList.contains("mrbb-folder")&&e.clientX>=rc.left+rc.width*.25&&e.clientX<=rc.left+rc.width*.75){cFT();it.classList.add("mrbb-folder-drop-target");ft=it;dt={parentId:it.dataset.bmId};hInd();return}
if(e.clientX<rc.left+rc.width/2){bef=it;xp=rc.left;break}}
cFT();if(!bef&&its.length>0)xp=its[its.length-1].getBoundingClientRect().right;
const ind=gInd(),rr=tr.getBoundingClientRect();ind.style.cssText=`position:fixed;top:${rr.top+2}px;left:${xp-1}px;height:${rr.height-4}px;width:2px;z-index:2147483647`;
if(!ind.parentElement)document.body.appendChild(ind);
if(bef){const idx=[...bar.querySelectorAll(".mrbb-item")].indexOf(bef);dt={parentId:"1",index:idx>=0?idx:0}}else dt={parentId:"1",index:[...bar.querySelectorAll(".mrbb-item")].length}}
function exDrop(){if(!dsi||!dt){cleanDrag();return}try{const d={parentId:dt.parentId};if(dt.index!==undefined)d.index=dt.index;chrome.runtime.sendMessage({type:"MRBB_MOVE_BOOKMARK",id:dsi,destination:d})}catch(e){console.warn("[MRBB] move fail:",e)}cleanDrag()}
function cleanDrag(){if(rootEl)rootEl.querySelectorAll(".mrbb-dragging").forEach(e=>e.classList.remove("mrbb-dragging"));hInd();cFT();if(dg){dg.remove();dg=null}dsi=null;dt=null}
let cm=null,cms=false;
function setupCtx(bar){bar.addEventListener("contextmenu",e=>{e.preventDefault();e.stopPropagation();onBC(e)});if(!cms){document.addEventListener("click",()=>cC(),true);document.addEventListener("keydown",e=>{if(e.key==="Escape")cC()});cms=true}}
function sIC(el,id,isF,ti,url,pid){el.addEventListener("contextmenu",e=>{e.preventDefault();e.stopPropagation();cC();const m=document.createElement("div");m.className="mrbb-context-menu";aIM(m,id,isF,ti,url,pid);aCM(m,pid);pM(m,e.clientX,e.clientY)})}
function cC(){if(cm){cm.remove();cm=null}}
function onBC(e){cDD(true);cC();const it=e.target.closest(".mrbb-item"),m=document.createElement("div");m.className="mrbb-context-menu";
if(it?.dataset.bmId)aIM(m,it.dataset.bmId,it.classList.contains("mrbb-folder"),it.querySelector(".mrbb-title")?.textContent||"",it.getAttribute("href")||"","1");
aCM(m,"1");pM(m,e.clientX,e.clientY)}
function aIM(m,id,isF,ti,url,pid){if(!isF&&url&&url!=="#"){m.appendChild(mi("Open in new tab",()=>chrome.runtime.sendMessage({type:"MRBB_OPEN_TAB",url})));m.appendChild(sp())}
if(isF){m.appendChild(mi("Open all in tabs",()=>chrome.runtime.sendMessage({type:"MRBB_OPEN_ALL_IN_TABS",folderId:id})));m.appendChild(sp())}
m.appendChild(mi("Rename",()=>{const n=prompt("Enter new name:",ti);if(n!==null&&n!==ti)chrome.runtime.sendMessage({type:"MRBB_UPDATE_BOOKMARK",id,changes:{title:n}})}));
if(!isF)m.appendChild(mi("Edit URL",()=>{const u=prompt("Enter new URL:",url);if(u!==null&&u!==url)chrome.runtime.sendMessage({type:"MRBB_UPDATE_BOOKMARK",id,changes:{url:u}})}));
if(pid!=="1")m.appendChild(mi("Move to bookmark bar",()=>chrome.runtime.sendMessage({type:"MRBB_MOVE_BOOKMARK",id,destination:{parentId:"1"}})));
m.appendChild(sp());m.appendChild(mi("Delete",()=>chrome.runtime.sendMessage({type:"MRBB_DELETE_BOOKMARK",id,isFolder:isF})));m.appendChild(sp())}
function aCM(m,pid){m.appendChild(mi("Add page...",()=>{const t=prompt("Bookmark name:",document.title);if(t===null)return;const u=prompt("URL:",window.location.href);if(u!==null)chrome.runtime.sendMessage({type:"MRBB_CREATE_BOOKMARK",parentId:pid,title:t,url:u})}));
m.appendChild(mi("Add folder...",()=>{const t=prompt("Folder name:");if(t===null||!t.trim())return;chrome.runtime.sendMessage({type:"MRBB_CREATE_FOLDER",parentId:pid,title:t.trim()})}));m.appendChild(sp());
m.appendChild(mi("Sort by name",()=>chrome.runtime.sendMessage({type:"MRBB_SORT_BOOKMARKS",parentId:pid,sortBy:"title"})));
m.appendChild(mi("Sort by URL",()=>chrome.runtime.sendMessage({type:"MRBB_SORT_BOOKMARKS",parentId:pid,sortBy:"url"})));
m.appendChild(mi("Sort by date added",()=>chrome.runtime.sendMessage({type:"MRBB_SORT_BOOKMARKS",parentId:pid,sortBy:"dateAdded"})))}
function pM(m,x,y){m.style.cssText="position:fixed;z-index:2147483647;left:-9999px;top:-9999px";document.body.appendChild(m);const r=m.getBoundingClientRect();let l=x,t=y;if(l+r.width>window.innerWidth)l=window.innerWidth-r.width-4;if(t+r.height>window.innerHeight)t=window.innerHeight-r.height-4;m.style.left=`${l}px`;m.style.top=`${t}px`;cm=m;m.addEventListener("contextmenu",e=>{e.preventDefault();e.stopPropagation()})}
function mi(lb,fn){const d=document.createElement("div");d.className="mrbb-context-item";d.textContent=lb;d.addEventListener("mousedown",e=>{e.preventDefault();e.stopPropagation();cC();fn()});return d}
function sp(){const d=document.createElement("div");d.className="mrbb-context-separator";return d}
let ddE=null,ddT=null,ddCl=null,ddO=null;
function cDD(f=false){if(!f&&isDrag())return;if(ddO){document.removeEventListener("mousedown",ddO,true);ddO=null}if(ddCl){ddCl();ddCl=null}if(ddE){ddE.remove();ddE=null}ddT=null;document.querySelectorAll(".mrbb-sub-dropdown").forEach(e=>e.remove())}
function hClose(trig,dd,dl=500){let tm=null;const ins=(x,y)=>{const tr=trig.getBoundingClientRect();if(x>=tr.left-8&&x<=tr.right+8&&y>=tr.top-4&&y<=tr.bottom+4)return true;const dr=dd.getBoundingClientRect();if(x>=dr.left-4&&x<=dr.right+4&&y>=dr.top-12&&y<=dr.bottom+4)return true;if(y>=tr.bottom-4&&y<=dr.top+8&&x>=Math.min(tr.left,dr.left)-8&&x<=Math.max(tr.right,dr.right)+8)return true;for(const s of document.querySelectorAll(".mrbb-sub-dropdown")){const sr=s.getBoundingClientRect();if(x>=sr.left-4&&x<=sr.right+4&&y>=sr.top-4&&y<=sr.bottom+4)return true}return false};
const mv=e=>{if(isDrag()){if(tm){clearTimeout(tm);tm=null}return}if(ins(e.clientX,e.clientY)){if(tm){clearTimeout(tm);tm=null}}else if(!tm)tm=setTimeout(()=>cDD(true),dl)};
document.addEventListener("mousemove",mv,true);const cc=()=>{if(tm){clearTimeout(tm);tm=null}};dd.addEventListener("dragenter",cc);dd.addEventListener("dragover",cc);
return()=>{document.removeEventListener("mousemove",mv,true);dd.removeEventListener("dragenter",cc);dd.removeEventListener("dragover",cc);if(tm)clearTimeout(tm)}}
function openF(fo,trig,mode){if(mode==="click"&&ddT===trig&&ddE){cDD(true);return}cDD(true);
const dd=document.createElement("div");dd.className="mrbb-dropdown";dd.id=`mrbb-dropdown-${fo.id}`;
if(!fo.children?.length){const em=document.createElement("div");em.className="mrbb-dropdown-empty";em.textContent="(empty)";dd.appendChild(em)}
else for(const c of fo.children)dd.appendChild(mkDDR(c,fo.id));
setupDDD(dd,fo.id);const rc=trig.getBoundingClientRect();
dd.style.setProperty("position","fixed","important");dd.style.setProperty("top",`${rc.bottom-4}px`,"important");dd.style.setProperty("left",`${rc.left}px`,"important");dd.style.setProperty("z-index","2147483647","important");dd.style.setProperty("padding-top","4px","important");
document.body.appendChild(dd);ddE=dd;ddT=trig;
const dr=dd.getBoundingClientRect();if(dr.right>window.innerWidth)dd.style.setProperty("left",`${window.innerWidth-dr.width-4}px`,"important");
if(dr.bottom>window.innerHeight)dd.style.setProperty("top",`${Math.max(4,window.innerHeight-dr.height-4)}px`,"important");
if(mode==="hover")ddCl=hClose(trig,dd,400);
if(mode==="click"){const h=e=>{if(dd.contains(e.target)||trig.contains(e.target))return;for(const s of document.querySelectorAll(".mrbb-sub-dropdown"))if(s.contains(e.target))return;cDD(true)};setTimeout(()=>{document.addEventListener("mousedown",h,true);ddO=h},0)}}
function mkDDR(item,pid){const row=document.createElement("a");row.className="mrbb-dropdown-row";row.dataset.bmId=item.id;row.draggable=true;
row.addEventListener("dragstart",e=>{e.stopPropagation();setDS(item.id);e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",item.id)});
if(item.isFolder){row.classList.add("mrbb-dropdown-folder");row.href="#";row.addEventListener("click",e=>e.preventDefault());
let sc=null;row.addEventListener("mouseenter",()=>{if(isDrag())return;document.querySelectorAll(".mrbb-sub-dropdown").forEach(s=>s.remove());if(sc){sc();sc=null}
const sub=document.createElement("div");sub.className="mrbb-dropdown mrbb-sub-dropdown";
if(!item.children?.length){const em=document.createElement("div");em.className="mrbb-dropdown-empty";em.textContent="(empty)";sub.appendChild(em)}
else for(const c of item.children)sub.appendChild(mkDDR(c,item.id));
setupDDD(sub,item.id);const rr=row.getBoundingClientRect();
sub.style.setProperty("position","fixed","important");sub.style.setProperty("top",`${rr.top}px`,"important");sub.style.setProperty("left",`${rr.right-4}px`,"important");sub.style.setProperty("padding-left","4px","important");sub.style.setProperty("z-index","2147483647","important");
document.body.appendChild(sub);const sr=sub.getBoundingClientRect();
if(sr.right>window.innerWidth){sub.style.setProperty("left",`${rr.left-sr.width+4}px`,"important");sub.style.setProperty("padding-left","0","important");sub.style.setProperty("padding-right","4px","important")}
if(sr.bottom>window.innerHeight)sub.style.setProperty("top",`${Math.max(4,window.innerHeight-sr.height-4)}px`,"important");
let ht=null;const mv=ev=>{if(isDrag()){if(ht){clearTimeout(ht);ht=null}return}const a=row.getBoundingClientRect(),b=sub.getBoundingClientRect();
const inR=ev.clientX>=a.left-4&&ev.clientX<=a.right+4&&ev.clientY>=a.top-4&&ev.clientY<=a.bottom+4;
const inS=ev.clientX>=b.left-8&&ev.clientX<=b.right+4&&ev.clientY>=b.top-4&&ev.clientY<=b.bottom+4;
const br=ev.clientY>=Math.min(a.top,b.top)-4&&ev.clientY<=Math.max(a.bottom,b.bottom)+4&&ev.clientX>=a.right-8&&ev.clientX<=b.left+8;
if(inR||inS||br){if(ht){clearTimeout(ht);ht=null}}else if(!ht)ht=setTimeout(()=>{sub.remove();document.removeEventListener("mousemove",mv,true)},300)};
document.addEventListener("mousemove",mv,true);sc=()=>{document.removeEventListener("mousemove",mv,true);if(ht)clearTimeout(ht)}})}
else row.href=item.url||"#";
sIC(row,item.id,item.isFolder,item.title||"",item.url||"",pid);
const ic=document.createElement("img");ic.className="mrbb-dropdown-icon";ic.width=16;ic.height=16;
if(item.isFolder)ic.src=FOLD;else{ic.src=item.url?getFav(item.url):"";ic.onerror=()=>{ic.src=LINK}}row.appendChild(ic);
const tx=document.createElement("span");tx.className="mrbb-dropdown-text";tx.textContent=item.title||(item.url??"");row.appendChild(tx);
if(item.isFolder){const ar=document.createElement("span");ar.className="mrbb-dropdown-arrow";ar.textContent="▶";row.appendChild(ar)}return row}
let S={...DF},hostEl=null,shadowRoot=null,rootEl=null,bodyObs=null,padV="",cssOK=false;
async function fetchBM(){return new Promise(r=>{chrome.runtime.sendMessage({type:"MRBB_GET_BOOKMARKS"},d=>{if(chrome.runtime.lastError||!d){r([]);return}r(d.bookmarks||[])})})}
async function loadCSS(sh){if(cssOK)return;try{const u=chrome.runtime.getURL("content.css"),t=await(await fetch(u)).text(),s=document.createElement("style");s.textContent=t;sh.insertBefore(s,sh.firstChild);cssOK=true}catch(e){console.warn("[MRBB] CSS fail:",e)}}
async function ensureHost(){if(rootEl&&hostEl&&shadowRoot)return rootEl;hostEl=document.createElement("div");hostEl.id="mrbb-host";
document.documentElement.insertBefore(hostEl,document.body);shadowRoot=hostEl.attachShadow({mode:"open"});await loadCSS(shadowRoot);
rootEl=document.createElement("div");rootEl.id="mrbb-root";shadowRoot.appendChild(rootEl);setupDrag(rootEl);setupCtx(rootEl);return rootEl}
function mkGear(){const e=document.createElement("div");e.className="mrbb-gear-btn";e.title="Settings";
e.innerHTML=`<svg width="14" height="14" viewBox="0 0 20 20" fill="#5f6368"><path d="M8.58 2.06A1 1 0 0 1 9.56 1h.88a1 1 0 0 1 .98.84l.18 1.28a6.02 6.02 0 0 1 1.56.64l1.08-.72a1 1 0 0 1 1.28.14l.62.62a1 1 0 0 1 .14 1.28l-.72 1.08c.28.48.48 1 .64 1.56l1.28.18a1 1 0 0 1 .84.98v.88a1 1 0 0 1-.84.98l-1.28.18a6.02 6.02 0 0 1-.64 1.56l.72 1.08a1 1 0 0 1-.14 1.28l-.62.62a1 1 0 0 1-1.28.14l-1.08-.72c-.48.28-1 .48-1.56.64l-.18 1.28a1 1 0 0 1-.98.84h-.88a1 1 0 0 1-.98-.84l-.18-1.28a6.02 6.02 0 0 1-1.56-.64l-1.08.72a1 1 0 0 1-1.28-.14l-.62-.62a1 1 0 0 1-.14-1.28l.72-1.08a6.02 6.02 0 0 1-.64-1.56l-1.28-.18A1 1 0 0 1 1 10.44v-.88a1 1 0 0 1 .84-.98l1.28-.18a6.02 6.02 0 0 1 .64-1.56l-.72-1.08a1 1 0 0 1 .14-1.28l.62-.62a1 1 0 0 1 1.28-.14l1.08.72c.48-.28 1-.48 1.56-.64l.18-1.28zM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>`;
e.addEventListener("click",ev=>{ev.stopPropagation();openSet(e)});return e}
function openSet(gear){const old=document.getElementById("mrbb-settings-panel");if(old){old.remove();return}
const p=document.createElement("div");p.id="mrbb-settings-panel";p.className="mrbb-settings-panel";
const fs=S.fontSize||12,bh=S.barHeight||34;
p.innerHTML=`<div class="mrbb-settings-title">Multi-Row Bookmark Bar</div><div class="mrbb-settings-row"><span>Font size</span><div class="mrbb-settings-fontsize"><button data-a="fs-">-</button><span id="mrbb-fv">${fs}px</span><button data-a="fs+">+</button></div></div><div class="mrbb-settings-row"><span>Row height</span><div class="mrbb-settings-fontsize"><button data-a="bh-">-</button><span id="mrbb-bv">${bh}px</span><button data-a="bh+">+</button></div></div><div class="mrbb-settings-row"><span>Max rows (0=∞)</span><input type="number" id="mrbb-mr" value="${S.maxRows}" min="0" max="20" style="width:48px;text-align:center;border:1px solid #dadce0;border-radius:3px;padding:2px 4px;font-size:12px"></div><div class="mrbb-settings-row"><span>Folder open</span><select id="mrbb-fo" style="border:1px solid #dadce0;border-radius:3px;padding:2px 4px;font-size:12px"><option value="hover"${S.folderOpenMode==="hover"?" selected":""}>Hover</option><option value="click"${S.folderOpenMode==="click"?" selected":""}>Click</option></select></div>`;
const rc=gear.getBoundingClientRect();p.style.cssText=`position:fixed;top:${rc.bottom+4}px;left:${rc.left}px;z-index:2147483647`;document.body.appendChild(p);
p.querySelector('[data-a="fs-"]')?.addEventListener("click",()=>{const v=Math.max(8,(S.fontSize||12)-1);S.fontSize=v;save();p.querySelector("#mrbb-fv").textContent=`${v}px`});
p.querySelector('[data-a="fs+"]')?.addEventListener("click",()=>{const v=Math.min(20,(S.fontSize||12)+1);S.fontSize=v;save();p.querySelector("#mrbb-fv").textContent=`${v}px`});
p.querySelector('[data-a="bh-"]')?.addEventListener("click",()=>{const v=Math.max(20,(S.barHeight||34)-2);S.barHeight=v;save();p.querySelector("#mrbb-bv").textContent=`${v}px`});
p.querySelector('[data-a="bh+"]')?.addEventListener("click",()=>{const v=Math.min(60,(S.barHeight||34)+2);S.barHeight=v;save();p.querySelector("#mrbb-bv").textContent=`${v}px`});
p.querySelector("#mrbb-mr")?.addEventListener("change",e=>{S.maxRows=parseInt(e.target.value,10)||0;save()});
p.querySelector("#mrbb-fo")?.addEventListener("change",e=>{S.folderOpenMode=e.target.value;save()});
const out=e=>{if(!p.contains(e.target)&&e.target!==gear&&!gear.contains(e.target)){p.remove();document.removeEventListener("mousedown",out,true)}};
setTimeout(()=>document.addEventListener("mousedown",out,true),0);p.addEventListener("contextmenu",e=>e.stopPropagation())}
function mkSearch(){const c=document.createElement("div");c.className="mrbb-search-container";
const btn=document.createElement("div");btn.className="mrbb-search-btn";btn.title="Search bookmarks";
btn.innerHTML=`<svg width="14" height="14" viewBox="0 0 20 20" fill="#5f6368"><path d="M8.5 3a5.5 5.5 0 0 1 4.38 8.82l4.15 4.15a.75.75 0 0 1-1.06 1.06l-4.15-4.15A5.5 5.5 0 1 1 8.5 3zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>`;
const inp=document.createElement("input");inp.type="text";inp.className="mrbb-search-input";inp.placeholder="Search...";
let st,resEl=null;const cR=()=>{if(resEl){resEl.remove();resEl=null}};const cS=()=>{inp.classList.remove("mrbb-search-open");inp.value="";cR()};
btn.addEventListener("click",e=>{e.stopPropagation();if(inp.classList.contains("mrbb-search-open"))cS();else{inp.classList.add("mrbb-search-open");inp.focus()}});
inp.addEventListener("input",()=>{clearTimeout(st);const q=inp.value.trim();if(q.length<2){cR();return}
st=setTimeout(()=>{chrome.runtime.sendMessage({type:"MRBB_SEARCH_BOOKMARKS",query:q},r=>{if(!chrome.runtime.lastError&&r)showR(r.results||[],inp)})},200)});
inp.addEventListener("keydown",e=>{if(e.key==="Escape")cS()});
const showR=(res,iel)=>{cR();resEl=document.createElement("div");resEl.className="mrbb-search-results";
if(!res.length){const em=document.createElement("div");em.className="mrbb-search-empty";em.textContent="No results found";resEl.appendChild(em)}
else for(const r of res){const row=document.createElement("a");row.className="mrbb-search-result-row";row.href=r.url;
const ic=document.createElement("img");ic.width=16;ic.height=16;ic.style.cssText="flex-shrink:0;border-radius:2px";ic.src=getFav(r.url);ic.onerror=()=>{ic.src=LINK};row.appendChild(ic);
const info=document.createElement("div");info.style.cssText="flex:1;overflow:hidden";
const t=document.createElement("div");t.className="mrbb-search-result-text";t.textContent=r.title||r.url;info.appendChild(t);
const u=document.createElement("div");u.className="mrbb-search-result-url";u.textContent=r.url;info.appendChild(u);row.appendChild(info);resEl.appendChild(row)}
const rc=iel.getBoundingClientRect();resEl.style.cssText=`position:fixed;top:${rc.bottom+4}px;left:${Math.max(4,rc.right-300)}px;z-index:2147483647`;document.body.appendChild(resEl)};
document.addEventListener("mousedown",e=>{if(!c.contains(e.target)&&resEl&&!resEl.contains(e.target))cS()},true);
c.appendChild(inp);c.appendChild(btn);return c}
function save(){chrome.storage.sync.set({[SK]:S})}
async function render(){if(!S.enabled){removeBar();return}
if(S.showCondition==="new_tab_only"){const h=location.href;if(!(h==="chrome://newtab/"||h.startsWith("chrome-search://")||h==="about:blank"||h==="chrome://new-tab-page/")){removeBar();return}}
const bms=await fetchBM();if(!bms.length){removeBar();return}
const layout=calcLayout(bms,window.innerWidth,S);if(!layout.length){removeBar();return}
const totalRows=Math.max(...layout.map(l=>l.row))+1;
rootEl=await ensureHost();rootEl.innerHTML="";cDD(true);
const bh=S.barHeight||34,ih=Math.max(bh-6,16);
hostEl.style.setProperty("--mrbb-font-size",`${S.fontSize||12}px`);hostEl.style.setProperty("--mrbb-bar-height",`${bh}px`);hostEl.style.setProperty("--mrbb-item-height",`${ih}px`);
for(let r=0;r<totalRows;r++){const row=document.createElement("div");row.className="mrbb-row";
if(r===0)row.appendChild(mkGear());
const items=layout.filter(l=>l.row===r);
for(const li of items){const el=mkItem(li.bookmark,S.displayMode);
if(li.bookmark.isFolder){if(S.folderOpenMode==="hover")el.addEventListener("mouseenter",()=>openF(li.bookmark,el,"hover"));
else el.addEventListener("click",e=>{e.preventDefault();openF(li.bookmark,el,"click")})}
row.appendChild(el)}
if(r===0)row.appendChild(mkSearch());rootEl.appendChild(row)}
const totalH=totalRows*bh;hostEl.style.height=`${totalH}px`;padV=`${totalH}px`;
document.body.style.setProperty("transform","translateY(0px)","important");document.body.style.setProperty("padding-top",padV,"important");
if(!bodyObs){bodyObs=new MutationObserver(()=>{if(!rootEl||!padV)return;if(document.body.style.getPropertyValue("padding-top")!==padV||document.body.style.getPropertyValue("transform")!=="translateY(0px)"){document.body.style.setProperty("transform","translateY(0px)","important");document.body.style.setProperty("padding-top",padV,"important")}});bodyObs.observe(document.body,{attributes:true,attributeFilter:["style"]})}}
function removeBar(){if(hostEl){hostEl.remove();hostEl=null;shadowRoot=null;rootEl=null;cssOK=false}if(bodyObs){bodyObs.disconnect();bodyObs=null}padV="";document.body.style.removeProperty("padding-top");document.body.style.removeProperty("transform")}
async function loadS(){try{const d=await chrome.storage.sync.get(SK);return{...DF,...(d[SK]??{})}}catch{return{...DF}}}
async function init(){S=await loadS();render();let rt;
window.addEventListener("resize",()=>{clearTimeout(rt);rt=setTimeout(render,150)});
chrome.runtime.onMessage.addListener(m=>{if(m.type==="MRBB_REFRESH")render()});
chrome.storage.onChanged.addListener((ch,area)=>{if(area==="sync"&&ch[SK]){S={...DF,...(ch[SK].newValue??{})};render()}});
window.addEventListener("keydown",e=>{if(e.ctrlKey&&e.shiftKey&&e.key==="B"){e.preventDefault();chrome.storage.sync.set({[SK]:{...S,enabled:!S.enabled}})}})}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init()})();
