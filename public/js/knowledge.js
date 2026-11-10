(() => {
  "use strict";
  const $ = (s, r=document) => r.querySelector(s);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const api = async (url, options={}) => {
    const res = await fetch(`/api${url}`, {
      method: options.method || "GET",
      headers: { "Accept":"application/json", ...(options.body ? {"Content-Type":"application/json"} : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
  };
  const state = { active:false, nodes:[], relations:[], focusId:null, zoom:1, editingId:null };
  const typeLabels = {workspace:"Workspace",project:"Project",area:"Area",topic:"Topic",system:"System"};
  const relationLabels = {related:"Related to",depends_on:"Depends on",contains:"Contains",references:"References"};

  function ensureStyles() {
    if ($("#knowledgeRuntimeStyles")) return;
    const style=document.createElement("style"); style.id="knowledgeRuntimeStyles";
    style.textContent=`
      .knowledge-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 20px}
      .knowledge-toolbar .scope-crumbs{display:flex;align-items:center;gap:7px;flex:1;min-width:180px;color:var(--muted);font-size:12px}
      .scope-crumbs button{border:0;background:none;color:var(--text-soft);cursor:pointer;padding:4px}
      .scope-zoom{display:flex;align-items:center;gap:4px;padding:3px;border:1px solid var(--line);border-radius:9px;background:var(--surface)}
      .scope-zoom button{width:30px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--text-soft);cursor:pointer}
      .scope-zoom button:hover{background:var(--surface-hover);color:var(--text)}
      .scope-canvas{position:relative;min-height:420px;overflow:auto;padding:20px;border:1px solid var(--line);border-radius:15px;background:radial-gradient(circle at 1px 1px,rgba(255,255,255,.075) 1px,transparent 0) 0 0/22px 22px,rgba(255,255,255,.012)}
      .scope-canvas-inner{transform:scale(var(--scope-zoom,1));transform-origin:top center;transition:transform .22s ease;min-width:0}
      .scope-root-label{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted-2);margin:0 0 14px}
      .scope-node-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;align-items:start}
      .scope-node{position:relative;text-align:left;border:1px solid var(--line);border-radius:13px;background:linear-gradient(145deg,rgba(255,255,255,.045),rgba(255,255,255,.018));padding:15px;cursor:pointer;min-height:132px;transition:border-color .2s,transform .2s,background .2s;overflow:hidden}
      .scope-node:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--node-color,#5793f7)}
      .scope-node:hover{transform:translateY(-2px);border-color:rgba(110,160,245,.48);background:rgba(87,147,247,.07)}
      .scope-node-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
      .scope-node-type{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.09em}
      .scope-node-icon{width:29px;height:29px;border-radius:8px;background:color-mix(in srgb,var(--node-color,#5793f7) 18%,transparent);display:grid;place-items:center;color:var(--node-color,#5793f7);font-size:14px}
      .scope-node strong{display:block;font-size:15px;font-weight:650;letter-spacing:-.2px}
      .scope-node p{font-size:11px;color:var(--muted);line-height:1.5;margin:6px 0 12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .scope-node-meta{display:flex;align-items:center;gap:10px;color:var(--muted-2);font-size:10px}
      .scope-node-meta span{display:inline-flex;align-items:center;gap:4px}
      .scope-node-arrow{margin-left:auto;color:var(--muted-2)}
      .scope-empty{min-height:340px;display:grid;place-items:center;text-align:center;padding:36px}
      .scope-empty-inner{max-width:360px}.scope-empty-icon{width:52px;height:52px;margin:0 auto 15px;border:1px solid var(--line);border-radius:16px;display:grid;place-items:center;font-size:22px;color:var(--blue);background:rgba(87,147,247,.08)}
      .scope-empty h3{font-size:18px;margin:0 0 8px}.scope-empty p{font-size:12px;color:var(--muted);line-height:1.6;margin:0 0 18px}
      .scope-detail{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:16px;margin-top:16px}
      .scope-detail-main,.scope-detail-side{border:1px solid var(--line);border-radius:13px;background:var(--surface);padding:16px;min-width:0}
      .scope-detail-title{display:flex;align-items:flex-start;gap:10px}.scope-detail-title h3{font-size:17px;margin:1px 0 4px}.scope-detail-title p{font-size:11px;color:var(--muted);margin:0;line-height:1.5}
      .scope-detail-actions{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap}
      .scope-section-title{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted-2);margin:18px 0 9px}
      .scope-related-row{display:flex;align-items:center;gap:8px;padding:9px 0;border-top:1px solid var(--line);font-size:12px}
      .scope-related-row small{color:var(--muted);margin-left:auto}
      .scope-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .scope-form-grid .wide{grid-column:1/-1}
      .scope-modal{width:min(520px,calc(100vw - 28px))}
      .scope-modal textarea{resize:vertical}
      .scope-color-row{display:flex;align-items:center;gap:10px}
      .scope-color-row input{width:42px;height:34px;border:0;background:transparent}
      .scope-status{font-size:11px;color:var(--muted);padding:8px 0}
      .walkthrough-layer{position:fixed;inset:0;z-index:1000}
      .walkthrough-spotlight{position:fixed;z-index:1001;pointer-events:none;border:2px solid rgba(110,165,255,.95);border-radius:12px;box-shadow:0 0 0 9999px rgba(5,7,11,.72),0 0 28px rgba(87,147,247,.2);transition:all .25s ease}
      .walkthrough-card{position:fixed;z-index:1002;left:50%;bottom:28px;transform:translateX(-50%);width:min(420px,calc(100vw - 28px));border:1px solid rgba(255,255,255,.13);border-radius:16px;background:#20242c;box-shadow:0 22px 70px rgba(0,0,0,.5);padding:18px 20px 16px}
      .walkthrough-progress{display:flex;align-items:center;gap:10px;color:#a9b4c5;font-size:10px;margin-bottom:17px}
      .walkthrough-progress>div{height:3px;background:rgba(255,255,255,.1);border-radius:9px;flex:1;overflow:hidden}.walkthrough-progress i{display:block;height:100%;background:#6da4ff;width:0;transition:width .2s}
      .walkthrough-progress button{border:0;background:none;color:#a9b4c5;font-size:11px;cursor:pointer}
      .walkthrough-kicker{font-size:9px;letter-spacing:.14em;color:#7eaaff}.walkthrough-card h2{font-size:19px;margin:6px 0}.walkthrough-card p{font-size:12px;line-height:1.65;color:#b3bac6;margin:0 0 18px}
      .walkthrough-actions{display:flex;align-items:center;gap:8px}.walkthrough-actions span{flex:1}
      .quick-capture-hint{font-size:11px;color:var(--muted);margin:10px 0 0}
      .task-description-tools{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 7px;color:var(--muted);font-size:10px}
      .task-code-tools{display:flex;align-items:center;gap:6px}.task-code-tools select{width:110px;padding:6px 8px;font-size:11px;min-height:30px}
      .task-code-tools button{min-height:30px;padding:5px 9px;font-size:11px}
      @media(max-width:760px){.scope-detail{grid-template-columns:1fr}.scope-canvas{padding:12px}.scope-node-grid{grid-template-columns:1fr}.walkthrough-card{bottom:12px}.walkthrough-spotlight{max-width:calc(100vw - 12px)}}
    `;
    document.head.appendChild(style);
  }

  function ensureDialogs() {
    if (!$("#knowledgeNodeDialog")) {
      const d=document.createElement("dialog"); d.className="modal scope-modal"; d.id="knowledgeNodeDialog";
      d.innerHTML=`<form class="modal-panel" id="knowledgeNodeForm" method="dialog">
        <div class="modal-header"><div><span class="modal-eyebrow">KNOWLEDGE SCOPE</span><h2 id="knowledgeNodeModalTitle">Create a scope</h2></div><button class="modal-close" type="button" data-scope-close>×</button></div>
        <input type="hidden" id="knowledgeNodeId">
        <div class="scope-form-grid">
          <div class="wide"><label class="form-label" for="knowledgeNodeTitle">Name</label><input class="form-input" id="knowledgeNodeTitle" maxlength="180" placeholder="e.g. SongShare" required></div>
          <div><label class="form-label" for="knowledgeNodeType">Type</label><select class="form-input" id="knowledgeNodeType"><option value="workspace">Workspace</option><option value="project">Project</option><option value="area" selected>Area</option><option value="topic">Topic</option><option value="system">System</option></select></div>
          <div><label class="form-label" for="knowledgeNodeParent">Parent scope</label><select class="form-input" id="knowledgeNodeParent"><option value="">No parent (root)</option></select></div>
          <div class="wide"><label class="form-label" for="knowledgeNodeBoard">Connect an existing board <span>Optional</span></label><select class="form-input" id="knowledgeNodeBoard"><option value="">No board attached</option></select></div>
          <div class="wide"><label class="form-label" for="knowledgeNodeDescription">Description</label><textarea class="form-input form-textarea" id="knowledgeNodeDescription" rows="3" placeholder="What belongs in this area?"></textarea></div>
          <div class="wide"><label class="form-label" for="knowledgeNodeColor">Accent colour</label><div class="scope-color-row"><input id="knowledgeNodeColor" type="color" value="#5793f7"><span class="form-hint">Used to identify this scope on the map</span></div></div>
        </div>
        <div class="modal-actions"><span class="modal-actions-spacer"></span><button class="button button-quiet" type="button" data-scope-close>Cancel</button><button class="button button-primary" type="submit">Save scope</button></div>
      </form>`;
      document.body.appendChild(d);
    }
  }

  async function load() {
    const data=await api("/knowledge");
    state.nodes=data.nodes||[]; state.relations=data.relations||[];
    if (state.focusId && !state.nodes.some(n=>n.id===state.focusId)) state.focusId=null;
    render();
  }
  const node=id=>state.nodes.find(n=>n.id===id);
  const children=id=>state.nodes.filter(n=>(n.parent_id||null)===(id||null));
  const parentChain=id=>{const arr=[];let cur=node(id);while(cur){arr.unshift(cur);cur=cur.parent_id?node(cur.parent_id):null;}return arr;};
  function setActive(active) {
    state.active=active;
    $("#knowledgeNav")?.classList.toggle("active",active);
    $("#columnsBoard").hidden=false;
    if (active) {
      $("#boardScrollArea").setAttribute("aria-label","Knowledge map");
      $("#pageEyebrow").textContent="CONNECTED WORKSPACE";
      $("#pageTitle").textContent="Knowledge map";
      $("#pageDescription").textContent="Projelerini, alt alanlarını ve aralarındaki bağlantıları keşfet.";
      $("#boardEditButton").hidden=true; $("#newColumnButton").hidden=true;
      $("#newTaskButton").hidden=true; $("#newBoardButton").hidden=true;
      $("#clipboardTaskButton").hidden=true; $("#boardReferenceLinks").hidden=true;
      $("#priorityFilter").closest(".filter-select-wrap").hidden=true;
      $("#boardCount").textContent=`${state.nodes.length} scopes · ${state.relations.length} connections`;
      $("#columnsBoard").innerHTML="";
    } else {
      $("#priorityFilter").closest(".filter-select-wrap").hidden=false;
      $("#boardScrollArea").setAttribute("aria-label","Kanban board");
      $("#newTaskButton").hidden=false; $("#newBoardButton").hidden=false; $("#clipboardTaskButton").hidden=false;
      $("#pageEyebrow").textContent="";
      $("#boardCount").textContent="";
    }
  }

  function nodeCard(n) {
    const count=Number(n.child_count||0), items=Number(n.item_count||0);
    return `<button class="scope-node" type="button" data-scope-open="${esc(n.id)}" style="--node-color:${esc(n.color||"#5793f7")}">
      <div class="scope-node-head"><span class="scope-node-type">${esc(typeLabels[n.node_type]||"Area")}</span><span class="scope-node-icon">⌘</span></div>
      <strong>${esc(n.title)}</strong><p>${esc(n.description||n.board_title||"Open this scope to explore its contents.")}</p>
      <div class="scope-node-meta"><span>▦ ${count} child${count===1?"":"ren"}</span><span>◇ ${items} items</span>${n.board_title?`<span>▤ ${esc(n.board_title)}</span>`:""}<span class="scope-node-arrow">↗</span></div>
    </button>`;
  }
  function render() {
    if (!state.active) return;
    const focus=node(state.focusId), chain=parentChain(state.focusId), kids=children(state.focusId);
    const crumb=chain.length?chain.map((n,i)=>`${i?'<span>›</span>':""}<button type="button" data-scope-crumb="${esc(n.id)}">${esc(n.title)}</button>`).join(""):'<strong>All scopes</strong>';
    const roots=state.nodes.filter(n=>!n.parent_id);
    $("#boardCount").textContent=`${state.nodes.length} scopes · ${state.relations.length} connections`;
    let content="";
    if (!state.nodes.length) {
      content=`<div class="scope-empty"><div class="scope-empty-inner"><div class="scope-empty-icon">⌘</div><h3>Build your project map</h3><p>Create a main scope such as MainRoadmap, then add SongShare, Games and other areas inside it. Connect related areas without forcing them into the same hierarchy.</p><button class="button button-primary" data-scope-create type="button">Create your first scope</button></div></div>`;
    } else if (kids.length) {
      content=`<div class="scope-node-grid">${kids.map(nodeCard).join("")}<button class="scope-node scope-add-card" data-scope-create type="button"><div class="scope-node-icon">＋</div><strong>Add a child scope</strong><p>Create a new area inside ${esc(focus?.title||"this scope")}.</p></button></div>`;
    } else if (!focus) {
      content=`<div class="scope-node-grid">${roots.map(nodeCard).join("")}<button class="scope-node scope-add-card" data-scope-create type="button"><div class="scope-node-icon">＋</div><strong>Create a root scope</strong><p>Start with a main project or workspace.</p></button></div>`;
    } else {
      content=`<div class="scope-node-grid"><div class="scope-empty" style="min-height:150px;grid-column:1/-1"><div class="scope-empty-inner"><h3>No child scopes yet</h3><p>Add the next level of your project.</p><button class="button button-outline" data-scope-create type="button">＋ Add child</button></div></div></div>`;
    }
    $("#columnsBoard").innerHTML=`
      <div class="knowledge-toolbar">
        <div class="scope-crumbs"><button type="button" data-scope-home>⌂ All scopes</button>${chain.length?`<span>›</span>${crumb}`:""}</div>
        <div class="scope-zoom"><button type="button" data-zoom="-1" aria-label="Zoom out">−</button><span style="font-size:10px;color:var(--muted);min-width:38px;text-align:center">${Math.round(state.zoom*100)}%</span><button type="button" data-zoom="1" aria-label="Zoom in">＋</button><button type="button" data-zoom="fit" title="Reset zoom">Fit</button></div>
        <button class="button button-outline" type="button" data-scope-create>＋ New scope</button>
      </div>
      <div class="scope-canvas" id="scopeCanvas"><div class="scope-canvas-inner" style="--scope-zoom:${state.zoom}">
        <div class="scope-root-label">${focus?`INSIDE ${esc(focus.title)}`:"YOUR KNOWLEDGE SPACE"}</div>
        ${content}
      </div></div>
      ${focus?renderDetail(focus):""}`;
    $("#scopeCanvas").style.setProperty("--scope-zoom",state.zoom);
  }
  function renderDetail(n) {
    const related=state.relations.filter(r=>r.source_node_id===n.id||r.target_node_id===n.id);
    const linked=related.map(r=>{const other=r.source_node_id===n.id?node(r.target_node_id):node(r.source_node_id);return other?`<div class="scope-related-row"><span style="color:${esc(other.color||"#5793f7")}">●</span><strong>${esc(other.title)}</strong><small>${esc(relationLabels[r.relation_type]||"Related")}</small><button class="tiny-icon-btn" data-relation-remove="${esc(n.id)}:${esc(r.id)}" title="Remove connection">×</button></div>`:"";}).join("");
    return `<div class="scope-detail">
      <section class="scope-detail-main"><div class="scope-detail-title"><span class="scope-node-icon" style="--node-color:${esc(n.color)}">⌘</span><div><h3>${esc(n.title)}</h3><p>${esc(n.description||"No description yet.")}</p></div>
      <div class="scope-detail-actions"><button class="button button-quiet" data-scope-edit="${esc(n.id)}">Edit</button><button class="button button-outline" data-scope-child="${esc(n.id)}">＋ Child</button></div></div>
      <div class="scope-section-title">Connections</div>${linked||`<div class="scope-status">No connections yet. Link this scope to another area to show how the projects relate.</div>`}
      <div class="inline-add-row"><select class="form-input" id="scopeConnectTarget"><option value="">Connect to another scope…</option>${state.nodes.filter(x=>x.id!==n.id).map(x=>`<option value="${esc(x.id)}">${esc(x.title)}</option>`).join("")}</select><select class="form-input" id="scopeConnectType" style="max-width:130px"><option value="related">Related</option><option value="depends_on">Depends on</option><option value="references">References</option></select><button class="button button-outline" data-scope-connect="${esc(n.id)}">Connect</button></div>
      </section>
      <aside class="scope-detail-side"><div class="scope-section-title" style="margin-top:0">Scope details</div><div class="scope-status">Type · ${esc(typeLabels[n.node_type]||n.node_type)}</div><div class="scope-status">Children · ${Number(n.child_count||0)}</div><div class="scope-status">Linked board · ${esc(n.board_title||"None")}</div><div class="scope-section-title">Hierarchy</div><div class="scope-status">${parentChain(n.id).map(x=>esc(x.title)).join(" → ")}</div><button class="button button-danger-quiet" style="margin-top:12px" data-scope-delete="${esc(n.id)}">Delete scope</button></aside>
    </div>`;
  }

  function openNodeDialog(n=null,parentId=null) {
    const dialog=$("#knowledgeNodeDialog"), form=$("#knowledgeNodeForm");
    form.reset(); state.editingId=n?.id||null;
    $("#knowledgeNodeId").value=n?.id||"";
    $("#knowledgeNodeTitle").value=n?.title||"";
    $("#knowledgeNodeType").value=n?.node_type||"area";
    $("#knowledgeNodeDescription").value=n?.description||"";
    $("#knowledgeNodeColor").value=n?.color||"#5793f7";
    $("#knowledgeNodeModalTitle").textContent=n?"Edit scope":"Create a scope";
    $("#knowledgeNodeParent").innerHTML=`<option value="">No parent (root)</option>${state.nodes.filter(x=>x.id!==n?.id).map(x=>`<option value="${esc(x.id)}">${esc(parentChain(x.id).map(p=>p.title).join(" / "))}</option>`).join("")}`;
    $("#knowledgeNodeParent").value=n?.parent_id||parentId||"";
    $("#knowledgeNodeBoard").innerHTML=`<option value="">No board attached</option>${(window.workboardBoards||[]).map(b=>`<option value="${esc(b.id)}">${esc(b.title)}</option>`).join("")}`;
    $("#knowledgeNodeBoard").value=n?.board_id||"";
    dialog.showModal(); setTimeout(()=>$("#knowledgeNodeTitle").focus(),60);
  }

  function toast(message,error=false) {
    const region=$("#toastRegion"); if(!region) return;
    const el=document.createElement("div"); el.className=`toast ${error?"toast-error":""}`; el.textContent=message; region.appendChild(el);
    setTimeout(()=>el.remove(),3200);
  }
  async function saveNode(e) {
    e.preventDefault();
    const id=$("#knowledgeNodeId").value;
    const body={title:$("#knowledgeNodeTitle").value.trim(),node_type:$("#knowledgeNodeType").value,
      parent_id:$("#knowledgeNodeParent").value||null,board_id:$("#knowledgeNodeBoard").value||null,
      description:$("#knowledgeNodeDescription").value.trim()||null,color:$("#knowledgeNodeColor").value};
    try {
      await api(id?`/knowledge/${id}`:"/knowledge",{method:id?"PATCH":"POST",body});
      $("#knowledgeNodeDialog").close(); await load(); toast(id?"Scope updated":"Scope created");
    } catch(e){toast(e.message,true);}
  }
  async function handleMapClick(e) {
    const target=e.target.closest("button"); if(!target)return;
    try {
      if(target.hasAttribute("data-scope-home")){state.focusId=null;render();return;}
      if(target.dataset.scopeCrumb){state.focusId=target.dataset.scopeCrumb;render();return;}
      if(target.dataset.scopeOpen){state.focusId=target.dataset.scopeOpen;render();return;}
      if(target.hasAttribute("data-scope-create")){openNodeDialog(null,state.focusId);return;}
      if(target.dataset.scopeEdit){openNodeDialog(node(target.dataset.scopeEdit));return;}
      if(target.dataset.scopeChild){openNodeDialog(null,target.dataset.scopeChild);return;}
      if(target.dataset.zoom){if(target.dataset.zoom==="fit")state.zoom=1;else state.zoom=Math.min(1.35,Math.max(.65,state.zoom+Number(target.dataset.zoom)*.1));render();return;}
      if(target.dataset.scopeConnect){
        const targetId=$("#scopeConnectTarget").value, relation_type=$("#scopeConnectType").value;
        if(!targetId){toast("Choose a scope first",true);return;}
        await api(`/knowledge/${target.dataset.scopeConnect}/relations`,{method:"POST",body:{target_node_id:targetId,relation_type}});
        await load();toast("Connection created");return;
      }
      if(target.dataset.relationRemove){
        const [nodeId,relationId]=target.dataset.relationRemove.split(":");
        await api(`/knowledge/${nodeId}/relations/${relationId}`,{method:"DELETE"});await load();toast("Connection removed");return;
      }
      if(target.dataset.scopeDelete){
        const n=node(target.dataset.scopeDelete);
        if(!confirm(`Delete "${n?.title}"? Its child scopes will become root scopes. Tasks and boards will not be deleted.`))return;
        await api(`/knowledge/${target.dataset.scopeDelete}`,{method:"DELETE"});state.focusId=n?.parent_id||null;await load();toast("Scope deleted");
      }
    } catch(err){toast(err.message,true);}
  }

  const tourSteps=[
    {target:"#knowledgeNav",title:"Knowledge map",text:"Bu alan, board'larından daha geniş bir proje haritası. MainRoadmap gibi bir ana kapsam oluşturup projelerini bunun altında düzenleyebilirsin.",action:()=>{setActive(true);load().catch(()=>{});}},
    {target:"[data-scope-create]",title:"Create a scope",text:"Bir workspace, project, area veya topic oluştur. Örneğin MainRoadmap bir root scope olabilir; SongShare onun altında bir project olur.",action:()=>{state.focusId=null;render();}},
    {target:".scope-node",title:"Zoom into a project",text:"Bir karta tıklayarak içine gir. SongShare içindeki Lyrics, Feed, Spotify ve Games gibi alanları ayrı seviyelerde tutabilirsin.",action:()=>{if(!state.nodes.length){$("#walkthroughText").textContent += " Önce bir scope oluşturduğunda bu kartlar burada görünecek.";}}},
    {target:".scope-detail",title:"Hierarchy and details",text:"Bir scope'a girdiğinde alt alanlarını, açıklamasını ve bağlı board'unu görürsün. Child butonuyla bir alt seviye oluşturabilirsin.",action:()=>{if(state.nodes.length){state.focusId=state.nodes[0].id;render();}}},
    {target:"#scopeConnectTarget",title:"Knowledge connections",text:"Hiyerarşi tek başına yeterli değil: farklı dallardaki iki alanı Related, Depends on veya References ilişkisiyle bağlayabilirsin.",action:()=>{if(state.nodes.length){state.focusId=state.nodes[0].id;render();}}},
    {target:".scope-zoom",title:"Zoom scope",text:"Haritayı yakınlaştırıp uzaklaştır. Breadcrumb ile üst seviyeye dönebilir, Fit ile görünümü sıfırlayabilirsin."}
  ];
  let tourIndex=0;
  function tourShow() {
    const layer=$("#walkthroughLayer"), step=tourSteps[tourIndex];
    if(!step)return tourClose();
    layer.hidden=false;
    $("#walkthroughKicker").textContent=`FEATURE ${String(tourIndex+1).padStart(2,"0")}`;
    $("#walkthroughTitle").textContent=step.title;
    $("#walkthroughText").textContent=(!state.nodes.length && tourIndex>=2 && tourIndex<=4)
      ? `${step.text} Henüz scope oluşturmadığın için bu alanı ilk scope'u ekledikten sonra kullanabileceksin.`
      : step.text;
    $("#walkthroughStepLabel").textContent=`${String(tourIndex+1).padStart(2,"0")} / ${tourSteps.length}`;
    $("#walkthroughProgress").style.width=`${(tourIndex+1)/tourSteps.length*100}%`;
    $("#walkthroughBack").disabled=tourIndex===0;
    $("#walkthroughNext").textContent=tourIndex===tourSteps.length-1?"Finish":"Next";
    requestAnimationFrame(()=>{
      let el=$(step.target);
      if(!el && tourIndex===3) el=$("#scopeCanvas");
      if(!el && tourIndex===4) el=$("#scopeCanvas");
      const spot=$("#walkthroughSpotlight");
      if(el && el.getBoundingClientRect().width){
        const r=el.getBoundingClientRect(), pad=7;
        spot.hidden=false; spot.style.left=`${r.left-pad}px`;spot.style.top=`${r.top-pad}px`;
        spot.style.width=`${r.width+pad*2}px`;spot.style.height=`${r.height+pad*2}px`;
      } else {spot.hidden=true;}
    });
  }
  function tourNext(){if(tourIndex>=tourSteps.length-1){tourClose();return;}tourIndex++;tourSteps[tourIndex].action?.();tourShow();}
  function tourClose(){$("#walkthroughLayer").hidden=true;$("#walkthroughSpotlight").hidden=true;}
  function startTour(){tourIndex=0;tourSteps[0].action?.();tourShow();}

  function bindCodeBlock() {
    const btn=$("#insertCodeBlock"), textarea=$("#taskDescription"), lang=$("#taskCodeLanguage");
    if(!btn||btn.dataset.bound)return;btn.dataset.bound="1";
    btn.addEventListener("click",()=>{
      const code=`\n\n\`\`\`${lang.value}\n\n\`\`\`\n`;
      const start=textarea.selectionStart,end=textarea.selectionEnd;
      const value=textarea.value;textarea.value=value.slice(0,start)+code+value.slice(end);
      const cursor=start+code.indexOf("\n")+1;textarea.focus();textarea.setSelectionRange(cursor,cursor);
    });
  }
  function bindQuickCapture() {
    const dialog=$("#quickCaptureDialog"), form=$("#quickCaptureForm");
    const open=()=>{dialog.showModal();setTimeout(()=>$("#quickCaptureText").focus(),50);};
    $("#quickCaptureLaunch")?.addEventListener("click",open);
    document.addEventListener("keydown",e=>{
      if((e.ctrlKey||e.metaKey)&&e.code==="Space"&&!dialog.open){
        e.preventDefault();open();
      }
    });
    form?.addEventListener("submit",async e=>{
      e.preventDefault();const title=$("#quickCaptureText").value.trim();if(!title)return;
      try{
        try {
          await api("/items",{method:"POST",body:{title,description:null,inbox:true,item_type:"idea"}});
          toast("Captured to Inbox");
        } catch (inboxError) {
          if (!/inbox column is missing/i.test(inboxError.message)) throw inboxError;
          let cols=await api("/columns");
          if (!Array.isArray(cols)||!cols.length) {
            const created=await api("/columns",{method:"POST",body:{title:"Inbox",board_id:null}});
            cols=[created];
          }
          await api("/items",{method:"POST",body:{title,description:null,column_id:cols[0].id,inbox:false,item_type:"idea"}});
          toast("Inbox is not configured; saved to your first list instead");
        }
        $("#quickCaptureText").value="";dialog.close();
      }catch(err){toast(err.message,true);}
    });
  }

  function bind() {
    ensureStyles();ensureDialogs();
    $("#knowledgeNav")?.addEventListener("click",async()=>{setActive(true);try{await load();}catch(e){toast(e.message,true);}});
    $("#walkthroughLaunch")?.addEventListener("click",startTour);
    $("#knowledgeNodeForm")?.addEventListener("submit",saveNode);
    $("#knowledgeNodeDialog")?.addEventListener("click",e=>{if(e.target===e.currentTarget||e.target.closest("[data-scope-close]"))e.currentTarget.close();});
    $("#columnsBoard")?.addEventListener("click",handleMapClick);
    $("#walkthroughNext")?.addEventListener("click",tourNext);
    $("#walkthroughBack")?.addEventListener("click",()=>{tourIndex=Math.max(0,tourIndex-1);tourShow();});
    $("#walkthroughSkip")?.addEventListener("click",tourClose);
    bindCodeBlock();bindQuickCapture();
    // expose the existing board cache without coupling the two front-end modules.
    window.workboardBoards=window.workboardBoards||[];
    document.addEventListener("click",e=>{
      if(e.target.closest("#independentNav,[data-view],[data-board-id]") && state.active){
        state.active=false;
        $("#knowledgeNav")?.classList.remove("active");
      }
    },true);
    // Load boards for the node editor from the same API.
    api("/boards").then(rows=>{window.workboardBoards=Array.isArray(rows)?rows:[];}).catch(()=>{});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind,{once:true});else bind();
})();