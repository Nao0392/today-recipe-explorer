/* Discovery Atlas — real recipes, real RecipeVectorCore similarities.
 * Requires data-adapter.js and vector-core.js from this repository.
 * No mock recipes, no random similarity scores, no third-party dependencies.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const FAVORITES_KEY = 'world-recipe-explorer-favorites';
  const COLORS = { '主食':'#edbf32', '主菜':'#ff8b68', '副菜':'#74c398', '汁物':'#7cb9d7', 'デザート':'#aa91e9' };
  const state = {
    recipes:[], recipeMap:new Map(), index:null, seed:null, candidate:null,
    count:8, weights:{}, ranked:[], selectedResult:null, nodes:[], edges:[], nodeMap:new Map(),
    dragging:null,
    favoriteIds:new Set(), tab:'basic', explanationTab:'features', loaded:false
  };
  const clamp=(value,lo,hi)=>Math.min(hi,Math.max(lo,value));
  const scoreText=v=>v==null?'比較不可':`${(100*v).toFixed(1)}%`;
  const numeric=v=>typeof v==='number'&&Number.isFinite(v);
  const yen=v=>numeric(v)?`約${Math.round(v).toLocaleString('ja-JP')}円`:'価格不明';
  const mins=v=>numeric(v)?`${Math.round(v)}分`:'時間不明';
  const safeName=v=>String(v||'料理');
  const getRecipe=id=>state.recipeMap.get(String(id));
  const colorFor=r=>COLORS[r?.category]||'#bfa6ca';
  const CX=510,CY=352,W=1020,H=760;
  const normLabel=r=>String(r?.name||'').normalize('NFKC').replace(/[\s・･【】「」（）()！!\-ー]/g,'').toLowerCase();
  const ingredientSet=r=>new Set((r?.ingredients||[]).map(x=>String(typeof x==='string'?x:x?.name||'').normalize('NFKC')).filter(Boolean));
  function overlap(a,b){if(!a.size||!b.size)return 0;let k=0;for(const v of a)if(b.has(v))k++;return k/(a.size+b.size-k);}
  // Keep relevance as the primary factor, but avoid a map filled with near-duplicate titles.
  function diversify(results, count=8){
    const pool=results.slice(0,Math.max(65,count*7));
    if(!pool.length)return [];
    const chosen=[pool[0]];const used=new Set([pool[0].id]);
    while(chosen.length<Math.min(count,pool.length)){
      let win=null,utility=-Infinity;
      for(const c of pool){if(used.has(c.id))continue;
        const n=normLabel(getRecipe(c.id)),ing=ingredientSet(getRecipe(c.id));
        let duplicate=0;
        for(const s of chosen){
          const sn=normLabel(getRecipe(s.id));
          const prefix=(n.length>=5&&sn.length>=5&&n.slice(0,5)===sn.slice(0,5))?1:0;
          duplicate=Math.max(duplicate,Math.max(prefix,overlap(ing,ingredientSet(getRecipe(s.id)))*.75));
        }
        const candidateUtility=c.score-.20*duplicate;
        if(candidateUtility>utility){utility=candidateUtility;win=c;}
      }
      if(!win)break;chosen.push(win);used.add(win.id);
    }
    // Diversity affects which recipes are selected, not the similarity order shown to users.
    return chosen.sort((a,b)=>b.score-a.score||b.coverage-a.coverage||a.name.localeCompare(b.name,'ja')||a.id.localeCompare(b.id));
  }
  const elem=(tag,attrs={})=>{
    const e=document.createElementNS(NS,tag);
    for(const [key,value] of Object.entries(attrs)){
      if(value!==null&&value!==undefined)e.setAttribute(key,String(value));
    }
    return e;
  };
  const simple=(tag,cls='',t='')=>{
    const e=document.createElement(tag);if(cls)e.className=cls;e.textContent=t;return e;
  };
  const pathFor=recipe=>typeof recipe?.image==='string'&&recipe.image.trim()?recipe.image:null;
  function imageInto(container,recipe){
    container.replaceChildren();
    const photo=pathFor(recipe);
    if(photo){
      const img=simple('img');img.src=photo;img.alt='';img.loading='lazy';
      img.onerror=()=>{container.replaceChildren(simple('span','',recipe?.emoji||'🍽️'));};
      container.append(img);
    } else container.append(simple('span','',recipe?.emoji||'🍽️'));
  }
  function rememberFavorites(){try{
    const ids=JSON.parse(localStorage.getItem(FAVORITES_KEY)||'[]');
    state.favoriteIds=new Set(Array.isArray(ids)?ids.map(String):[]);
  }catch{state.favoriteIds=new Set();}}
  function toggleFavorite(){
    if(!state.seed)return;
    if(state.favoriteIds.has(state.seed))state.favoriteIds.delete(state.seed);
    else state.favoriteIds.add(state.seed);
    try{localStorage.setItem(FAVORITES_KEY,JSON.stringify([...state.favoriteIds]));}catch(e){console.warn('お気に入りを保存できません',e);}
    refreshFavorite();
  }
  function refreshFavorite(){
    const on=state.favoriteIds.has(state.seed);
    const btn=$('favoriteToggle');btn.textContent=on?'♥':'♡';
    btn.setAttribute('aria-pressed',String(on));
    btn.setAttribute('aria-label',on?'お気に入りを解除':'お気に入りに追加');
  }
  function baseDetails(){
    const r=getRecipe(state.seed);if(!r)return;
    imageInto($('baseMedia'),r);
    $('recipePaneTitle').textContent=r.name;
    $('basePrice').textContent='◉ '+yen(r.price);
    $('baseTime').textContent='◷ '+mins(r.time_min);
    $('baseCategory').textContent=[r.category,r.style].filter(Boolean).join(' · ')||'料理';
    const desc=r.description||r.catchcopy||`${r.name}の食材、調理時間、栄養を比較できます。`;
    $('baseDescription').textContent=desc;
    fillChips('ingredientChips',(r.ingredients||[]).map(x=>typeof x==='string'?x:x.name).filter(Boolean).slice(0,14));
    const nu=r.nutrition||{};
    const vals=[['🔥 カロリー',nu.kcal,'kcal'],['💪 たんぱく質',nu.protein,'g'],['◉ 脂質',nu.fat,'g'],['🌿 炭水化物',nu.carb,'g']];
    const box=$('nutritionRows');box.replaceChildren();
    for(const [label,value,unit] of vals){
      const row=simple('div','nutrition-row');row.append(simple('span','',label),simple('strong','',numeric(value)?`${Math.round(value*10)/10} ${unit}`:'情報なし'));box.append(row);
    }
    const source=typeof r.source==='object'?r.source?.url:r.source_url;
    const detail=$('baseRecipeSource');
    if(typeof source==='string'&&/^https?:\/\//i.test(source)){detail.href=source;detail.target='_blank';detail.rel='noopener noreferrer';detail.textContent='元のレシピを確認 ↗';}
    else{detail.href=`search.html?open=${encodeURIComponent(state.seed)}`;detail.removeAttribute('target');detail.textContent='検索ページで詳細を見る ↗';}
    $('backToSearch').href=`search.html?open=${encodeURIComponent(state.seed)}`;
    refreshFavorite();
  }
  function fillChips(id,items,diff=false){
    const root=$(id);root.replaceChildren();
    if(!items.length){root.append(simple('span','ingredient-chip empty','表示できる食材がありません'));return;}
    for(const s of items){root.append(simple('span','ingredient-chip'+(diff?' diff':''),String(s)));}
  }
  function setLeftTab(tab){
    state.tab=tab;
    for(const [key,id,view] of [['basic','tabBasic','basicView'],['similar','tabSimilar','similarView']]){
      const active=tab===key;$(id).classList.toggle('active',active);$(id).setAttribute('aria-selected',String(active));$(view).hidden=!active;
    }
  }
  function setRightTab(tab){
    state.explanationTab=tab;
    for(const [key,id,view] of [['process','tabProcess','processView'],['features','tabFeatures','featuresView']]){
      const active=tab===key;$(id).classList.toggle('active',active);$(id).setAttribute('aria-selected',String(active));$(view).hidden=!active;
    }
  }
  function candidateDetails(){
    const other=getRecipe(state.candidate),me=getRecipe(state.seed);
    const result=other&&me?state.index.compareIds(state.seed,state.candidate,state.weights):null;
    if(!result||result.score==null){
      // No comparable candidate (including zero total weight): clear the previous recipe's details.
      state.selectedResult=null;
      imageInto($('candidateMedia'),null);
      $('candidateName').textContent='比較対象がありません';
      $('candidateMeta').textContent='';
      $('candidateScore').textContent='—';
      $('comparisonReason').textContent='比較できる料理がありません。特徴量の重みを調整してください。';
      $('commonChips').replaceChildren();
      $('differentChips').replaceChildren();
      $('featuresScore').textContent='—';
      $('featureBars').replaceChildren();
      $('featureExplain').textContent='比較対象がありません。重みを調整すると再計算できます。';
      $('changeSeed').disabled=true;
      for(const node of state.nodes){node.g?.classList.remove('selected');}
      return;
    }
    state.selectedResult=result;
    $('changeSeed').disabled=false;
    imageInto($('candidateMedia'),other);
    $('candidateName').textContent=other.name;
    $('candidateMeta').textContent=[yen(other.price),mins(other.time_min)].join(' · ');
    $('candidateScore').textContent=scoreText(result?.score);
    fillChips('commonChips',result?.commonIngredients||[]);
    fillChips('differentChips',(result?.onlyCandidate||[]).slice(0,12),true);
    const strong=(result?.dimensions||[]).filter(x=>x.similarity!=null&&x.weight>0).sort((a,b)=>b.contribution-a.contribution);
    const weak=(result?.dimensions||[]).filter(x=>x.similarity!=null&&x.weight>0).sort((a,b)=>a.similarity-b.similarity);
    $('comparisonReason').textContent=strong.length?
      `「${strong[0].label}」が似ている点に寄与しています。${weak.length?`「${weak[0].label}」は比較的異なります。`:''}`:'比較可能な情報が不足しています。';
    $('featuresScore').textContent=scoreText(result?.score);
    const bars=$('featureBars');bars.replaceChildren();
    for(const field of result?.dimensions||[]){
      const row=simple('div','feature-row');row.append(simple('span','',field.label));
      const bg=simple('div','feature-track'),fill=simple('div','feature-fill');
      fill.style.width=field.similarity==null?'0%':`${(field.similarity*100).toFixed(1)}%`;
      fill.style.backgroundColor=field.color;bg.append(fill);
      row.append(bg,simple('b','',field.similarity==null?'—':Math.round(field.similarity*100)+'%'));
      row.title=`重み: ${field.weight} / 寄与: ${(field.contribution*100).toFixed(1)}pt`;
      bars.append(row);
    }
    $('featureExplain').textContent=`${me.name}と${other.name}の特徴量類似度は${scoreText(result?.score)}。${$('comparisonReason').textContent}（情報カバー率 ${(100*(result?.coverage||0)).toFixed(0)}%）`;
    for(const node of state.nodes){node.g?.classList.toggle('selected',node.id===state.candidate);}
  }
  function setCandidate(id,openTab=true){
    if(!getRecipe(id)||String(id)===state.seed)return;
    state.candidate=String(id);candidateDetails();
    if(openTab)setLeftTab('similar');
    for(const b of $('rankStrip').children){b.classList.toggle('active',b.querySelector('strong')?.textContent===getRecipe(id)?.name);}
    paintNetwork();updateQueryUrl();
  }
  function updateQueryUrl(){
    // In a normal Live Server session the URL records the selected recipe.
    // Embedded/about:blank previews cannot modify browser history.
    if(location.protocol!=='http:'&&location.protocol!=='https:')return;
    try {
      const url=new URL(window.location.href);
      url.searchParams.set('seed',state.seed);
      if(state.candidate)url.searchParams.set('candidate',state.candidate);
      else url.searchParams.delete('candidate');
      history.replaceState(null,'',url.pathname+url.search+url.hash);
    } catch(error){console.warn('URL state could not be updated',error);}
  }
  function getRanked(seed,n){
    const max=Math.max(8,Math.round(n));
    if(max<=50)return state.index.search(seed,state.weights,max);
    // search() intentionally limits results to 50. Use the same compareIds() & tie-break to extend the visual range.
    return state.index.items.filter(item=>item.id!==seed)
      .map(item=>state.index.compareIds(seed,item.id,state.weights))
      .filter(x=>x&&x.score!=null)
      .sort((a,b)=>b.score-a.score||b.coverage-a.coverage||a.name.localeCompare(b.name,'ja')||a.id.localeCompare(b.id))
      .slice(0,max);
  }
  function setSeed(id,candidate=null){
    if(!getRecipe(id))return;
    const newId=String(id);
    state.seed=newId;
    state.ranked=getRanked(newId,Math.max(70,state.count*4));
    const nextCandidate=candidate&&getRecipe(candidate)&&String(candidate)!==newId?String(candidate):state.ranked[0]?.id;
    state.candidate=nextCandidate||null;
    $('recipeQuery').value='';
    baseDetails();candidateDetails();
    setLeftTab('basic');
    drawNetwork();
    updateQueryUrl();
  }
  function setCount(n){
    state.count=clamp(Math.round(n/4)*4,8,32);
    $('displayCount').value=String(state.count);$('displayCountValue').textContent=String(state.count);
    if(state.seed){state.ranked=getRanked(state.seed,Math.max(70,state.count*4));drawNetwork();}
  }
  function makeNodeImage(g,r,idx,radius){
    const photo=pathFor(r),fallback=elem('text',{'text-anchor':'middle',x:0,y:9,'font-size':radius>55?41:Math.round(radius*.72)});
    fallback.textContent=r?.emoji||'🍽️';
    if(!photo){g.append(fallback);return;}
    const svg=$('recipeNetwork'),defs=svg.querySelector('defs');
    const clipId=`recipeClip_${idx}`;
    const clip=elem('clipPath',{id:clipId});clip.append(elem('circle',{cx:0,cy:0,r:Math.max(3,radius-5)}));defs.append(clip);
    const image=elem('image',{href:photo,x:-radius+5,y:-radius+5,width:(radius-5)*2,height:(radius-5)*2,
      'preserveAspectRatio':'xMidYMid slice','clip-path':`url(#${clipId})`});
    // SVG image load failures fall back to an emoji.
    fallback.setAttribute('visibility','hidden');
    image.addEventListener('error',()=>{image.remove();fallback.setAttribute('visibility','visible');});
    g.append(image,fallback);
  }
  function showTooltip(node,event){
    if(node.center)return;
    const root=$('nodeTooltip');
    root.replaceChildren(simple('strong','',node.r.name),simple('div','',`基準料理との類似度：${scoreText(node.score)}`));
    root.hidden=false;
    const container=$('recipeNetwork').closest('.graph-pane');const rect=container.getBoundingClientRect();
    root.style.left=clamp(event.clientX-rect.left+9,4,rect.width-255)+'px';
    root.style.top=clamp(event.clientY-rect.top-65,9,rect.height-75)+'px';
  }
  function hideTooltip(){$('nodeTooltip').hidden=true;}
  function svgCoords(event){
    const svg=$('recipeNetwork');const pt=svg.createSVGPoint();pt.x=event.clientX;pt.y=event.clientY;
    const ctm=svg.getScreenCTM();return ctm?pt.matrixTransform(ctm.inverse()):{x:480,y:340};
  }
  function addEvents(node){
    const g=node.g;g.setAttribute('tabindex','0');g.setAttribute('role','button');
    g.setAttribute('aria-label',`${node.r.name}：${node.center?'基準の料理':'類似度 '+scoreText(node.score)}`);
    g.addEventListener('mouseenter',ev=>showTooltip(node,ev));
    g.addEventListener('mouseleave',hideTooltip);
    g.addEventListener('pointerdown',ev=>{
      if(ev.button!==0)return;
      const pt=svgCoords(ev);
      state.dragging={node,offsetX:node.x-pt.x,offsetY:node.y-pt.y,startX:ev.clientX,startY:ev.clientY,moved:false};
      g.setPointerCapture(ev.pointerId);
    });
    g.addEventListener('pointermove',ev=>{
      if(state.dragging?.node!==node)return;
      const d=state.dragging;
      if(Math.hypot(ev.clientX-d.startX,ev.clientY-d.startY)>4)d.moved=true;
      if(d.moved){const p=svgCoords(ev);node.pinned=true;node.x=clamp(p.x+d.offsetX,58,W-58);node.y=clamp(p.y+d.offsetY,66,H-110);$('layoutReset').hidden=false;paintNetwork();showTooltip(node,ev);}
    });
    g.addEventListener('pointerup',ev=>{
      const d=state.dragging;if(d?.node!==node)return;
      const moved=d.moved;state.dragging=null;
      try{g.releasePointerCapture(ev.pointerId);}catch{}
      if(!moved){if(node.center){setLeftTab('basic');}else setCandidate(node.id);}
    });
    g.addEventListener('pointercancel',()=>{state.dragging=null;});
    g.addEventListener('dblclick',ev=>{ev.preventDefault();if(!node.center)setSeed(node.id);});
    g.addEventListener('keydown',ev=>{
      if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();if(node.center)setLeftTab('basic');else setCandidate(node.id);}
      if(ev.key==='s'&&!node.center){ev.preventDefault();setSeed(node.id);}
    });
  }
  function addNamePlate(g,r,radius,center,score,above=false){
    const max=18,n=String(r?.name||'料理');
    const chunks=n.length>max?[n.slice(0,9),n.slice(9,17)+'…']:n.length>10?[n.slice(0,9),n.slice(9)]:[n];
    const w=center?190:176;
    const h=chunks.length===1?55:72;
    // Place labels outward on the upper and side branches to avoid adjacent nodes.
    const y=above?-radius-15-h:radius+15;
    g.append(elem('rect',{x:-w/2,y,width:w,height:h,rx:14,fill:'#fff',stroke:'#e0e9de','stroke-width':1,class:'name-plate'}));
    for(let i=0;i<chunks.length;i++){
      const t=elem('text',{class:center?'node-label center-label':'node-label',y:y+23+i*17,'text-anchor':'middle'});t.textContent=chunks[i];g.append(t);
    }
    if(!center){
      const scoreBg=elem('rect',{x:-48,y:y+h-23,width:96,height:18,rx:9,fill:'#e4f5e8'});g.append(scoreBg);
      const sc=elem('text',{class:'node-score','text-anchor':'middle',y:y+h-10});sc.textContent='類似度 '+scoreText(score);g.append(sc);
    }else{
      const tag=elem('text',{class:'center-subtitle','text-anchor':'middle',y:y+h-9});tag.textContent='選択中の料理';g.append(tag);
    }
  }
  function createNode({id,r,center=false,score=1,index=-1,rank=0,anchorX,anchorY,parent=null,scaleMin=0,scaleMax=1}){
    const isBig=center||rank<8;
    const relative=clamp(((score??0)-scaleMin)/Math.max(.10,scaleMax-scaleMin),0,1);
    const radius=center?87:isBig?45+28*relative:12+9*relative;
    const color=colorFor(r);
    const g=elem('g',{class:`node ${center?'node-center':isBig?'node-featured':'node-satellite'}`,opacity:'1'});
    if(isBig){
      g.append(elem('circle',{r:radius+16,fill:center?'#ffdf6b':'#e6f4e6','fill-opacity':center?.58:.52}));
      g.append(elem('circle',{r:radius+7,fill:'#fff',stroke:center?'#ffcd35':color,'stroke-width':center?7:4.5,class:'node-ring'}));
      g.append(elem('circle',{r:radius+2,fill:'#fff'}));
      makeNodeImage(g,r,index+1,radius);
      if(!pathFor(r))g.insertBefore(elem('circle',{r:radius-5,fill:color,'fill-opacity':.15}),g.querySelector('text'));
      if(!center){
        const bubble=elem('circle',{cx:-radius+5,cy:-radius+5,r:17,fill:'#fff',stroke:'#dcebdc','stroke-width':2});
        const tx=elem('text',{x:-radius+5,y:-radius+1,'text-anchor':'middle',class:'rank-index'});tx.textContent=String(rank+1);
        g.append(bubble,tx);
      }
      addNamePlate(g,r,radius,center,score,!center&&[1,2,6,7].includes(rank));
    }else{
      g.append(elem('circle',{r:radius+3,fill:'#fff',stroke:color,'stroke-width':2}));
      g.append(elem('circle',{r:radius,fill:color,'fill-opacity':.85}));
      const rankText=elem('text',{class:'satellite-rank','text-anchor':'middle',y:4});rankText.textContent='+';g.append(rankText);
    }
    $('nodeLayer').append(g);
    const node={id,r,center,score,rank,anchorX,anchorY,origX:anchorX,origY:anchorY,radius,
      x:anchorX,y:anchorY,parent,pinned:false,g};
    if(center){node.x=CX;node.y=CY;}
    addEvents(node);state.nodes.push(node);state.nodeMap.set(id,node);return node;
  }
  function drawNetwork(){
    if(!state.seed)return;
    hideTooltip();
    $('layoutReset').hidden=true;
    state.nodes=[];state.edges=[];state.nodeMap.clear();
    $('nodeLayer').replaceChildren();$('edgeLayer').replaceChildren();
    const defs=$('recipeNetwork').querySelector('defs');defs.querySelectorAll('clipPath').forEach(x=>x.remove());
    const base=getRecipe(state.seed);
    const primary=diversify(state.ranked,8);
    const used=new Set(primary.map(x=>x.id));
    const other=state.ranked.filter(r=>!used.has(r.id)).slice(0,Math.max(0,state.count-8));
    const high=primary[0]?.score??1, low=primary.at(-1)?.score??0;
    const main=createNode({id:state.seed,r:base,center:true,index:-1,anchorX:CX,anchorY:CY});
    // Leave room for name plates, the numbered badges and the center recipe.
    const anchors=[
      [510,96],[755,174],[842,420],[758,596],
      [510,596],[265,596],[176,420],[265,174]
    ];
    const features=[];
    primary.forEach((result,i)=>{
      const r=getRecipe(result.id);if(!r)return;
      const [ax,ay]=anchors[i];
      const node=createNode({id:result.id,r,score:result.score,index:i,rank:i,anchorX:ax,anchorY:ay,parent:main,scaleMin:low,scaleMax:high});
      addEdge(main,node,result.score,true);features.push(node);
    });
    // Secondary recipes are optional. Keep them out of the hero nodes' photo/label areas.
    other.forEach((result,i)=>{
      const r=getRecipe(result.id);if(!r||!features.length)return;
      let parent=features[0],best=-1;
      for(const f of features){const comp=state.index.compareIds(f.id,result.id,state.weights)?.score;
        if(comp!=null&&comp>best){best=comp;parent=f;}}
      const slot=features.indexOf(parent);
      const n=other.slice(0,i).filter(x=>{
        let p=features[0],v=-1;for(const f of features){const s=state.index.compareIds(f.id,x.id,state.weights)?.score;
          if(s!=null&&s>v){v=s;p=f;}}return p===parent;}).length;
      const angle=(-90+45*slot)*Math.PI/180 + ((n%4)-1.5)*.28;
      const ax=clamp(parent.anchorX+Math.cos(angle)*(95+Math.floor(n/4)*27),25,W-25);
      const ay=clamp(parent.anchorY+Math.sin(angle)*(90+Math.floor(n/4)*25),32,H-32);
      const node=createNode({id:result.id,r,score:result.score,index:i+8,rank:i+8,anchorX:ax,anchorY:ay,parent,scaleMin:low,scaleMax:high});
      addEdge(parent,node,best>=0?best:result.score,false);
    });
    state.nodes.forEach(n=>n.g.classList.toggle('selected',n.id===state.candidate));
    renderRankStrip(primary);
    if(window.innerWidth<730){
      requestAnimationFrame(()=>{const sc=$('graphScroll');sc.scrollLeft=Math.max(0,(sc.scrollWidth-sc.clientWidth)/2);});
    }
    paintNetwork();
  }
  function renderRankStrip(results){
    const root=$('rankStrip');root.replaceChildren();
    for(let i=0;i<results.length;i++){
      const result=results[i],r=getRecipe(result.id);if(!r)continue;
      const b=simple('button','rank-card'+(result.id===state.candidate?' active':''));b.type='button';b.setAttribute('role','listitem');
      const thumb=simple('span','rank-thumb');imageInto(thumb,r);
      const texts=simple('span','rank-copy'),name=simple('strong','',r.name),score=simple('small','',scoreText(result.score));
      texts.append(name,score);b.append(thumb,texts);b.addEventListener('click',()=>setCandidate(result.id));root.append(b);
    }
  }
  function addEdge(source,target,score,strong){
    const line=elem('path',{stroke:strong?'#80b69a':'#b6d3bf',
      'stroke-opacity':strong?.38:.24,'stroke-width':strong?3+Math.max(0,score)*7:.9,
      fill:'none','stroke-linecap':'round',class:strong?'hero-edge':'detail-edge'});
    $('edgeLayer').append(line);state.edges.push({source,target,line});
  }
  function paintNetwork(){
    for(const e of state.edges){
      const s=e.source,t=e.target;
      const dx=t.x-s.x,dy=t.y-s.y;
      const bend=Math.min(18,Math.hypot(dx,dy)*.043);
      e.line.setAttribute('d',`M ${s.x.toFixed(1)} ${s.y.toFixed(1)} Q ${((s.x+t.x)/2-dy/Math.max(1,Math.hypot(dx,dy))*bend).toFixed(1)} ${((s.y+t.y)/2+dx/Math.max(1,Math.hypot(dx,dy))*bend).toFixed(1)} ${t.x.toFixed(1)} ${t.y.toFixed(1)}`);
      e.line.classList.toggle('active',t.id===state.candidate);
    }
    for(const n of state.nodes){n.g.setAttribute('transform',`translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);}
  }
  function searchByName(value){
    const query=value.normalize('NFKC').toLowerCase().trim();if(!query)return;
    const exact=state.recipes.find(r=>r.name.normalize('NFKC').toLowerCase()===query);
    const partial=state.recipes.find(r=>r.name.normalize('NFKC').toLowerCase().includes(query));
    if(exact||partial){setSeed(String((exact||partial).id));$('recipeQuery').value='';}
    else{$('recipeQuery').setCustomValidity('料理が見つかりません');$('recipeQuery').reportValidity();}
  }
  function buildWeightControls(){
    const controls=$('weightControls');controls.replaceChildren();
    for(const field of state.index.fields){
      const row=simple('label','weight-edit'),input=simple('input'),output=simple('output','',String(state.weights[field.key]));
      input.type='range';input.min='0';input.max='100';input.step='1';input.value=String(state.weights[field.key]);
      row.append(simple('span','',field.label),input,output);
      input.addEventListener('input',()=>{state.weights[field.key]=Number(input.value);output.textContent=input.value;});
      input.addEventListener('change',()=>{state.ranked=getRanked(state.seed,Math.max(70,state.count*4));drawNetwork();candidateDetails();});
      controls.append(row);
    }
  }
  function loadDataList(){const list=$('recipeNames');list.replaceChildren();const frag=document.createDocumentFragment();
    for(const recipe of state.recipes){const opt=document.createElement('option');opt.value=recipe.name;frag.append(opt);}
    list.append(frag);
  }
  async function initialize(){
    if(typeof RecipeData==='undefined'||typeof RecipeVectorCore==='undefined')throw Error('data-adapter.js と vector-core.js が必要です。');
    const data=await RecipeData.load();
    const seen=new Set();state.recipes=(data.recipes||[]).filter(r=>{
      const id=String(r?.id??'');if(!id||!r.name||seen.has(id))return false;seen.add(id);return true;
    });
    if(state.recipes.length<2)throw Error('比較できるレシピが2件以上必要です。');
    state.recipeMap=new Map(state.recipes.map(r=>[String(r.id),r]));
    state.index=RecipeVectorCore.createIndex(state.recipes);
    state.weights=Object.fromEntries(state.index.fields.map(f=>[f.key,f.weight]));
    buildWeightControls();
    rememberFavorites();loadDataList();
    state.loaded=true;
    $('dataCount').textContent=`${state.recipes.length.toLocaleString('ja-JP')}品のレシピを探索できます`;
    $('dataSource').textContent='出典：'+(RecipeData.getSource?.()||'data/delish_teiban_photo.json');
    $('errorBox').hidden=true;$('recovery').hidden=true;
    const params=new URLSearchParams(location.search);
    const requested=params.get('seed')||params.get('recipe')||params.get('open');
    const defaultRecipe=state.recipes.find(r=>r.name==='カルボナーラ')||state.recipes.find(r=>r.name==='親子丼')||state.recipes[0];
    const seed=requested&&getRecipe(requested)?String(requested):String(defaultRecipe.id);
    const candidate=params.get('candidate');
    setSeed(seed,candidate);
  }
  function fail(error){console.error(error);$('errorBox').textContent=`レシピデータを読み込めませんでした：${error.message}　／　Go Live を使い、data/delish_teiban_photo.json の配置を確認してください。`;
    $('errorBox').hidden=false;$('recovery').hidden=false;$('dataCount').textContent='データ読み込み失敗';}
  function installEvents(){
    $('tabBasic').addEventListener('click',()=>setLeftTab('basic'));
    $('tabSimilar').addEventListener('click',()=>setLeftTab('similar'));
    $('tabProcess').addEventListener('click',()=>setRightTab('process'));
    $('tabFeatures').addEventListener('click',()=>setRightTab('features'));
    $('favoriteToggle').addEventListener('click',toggleFavorite);
    $('changeSeed').addEventListener('click',()=>{if(state.candidate)setSeed(state.candidate);});
    $('focusToggle').addEventListener('click',()=>{const panel=document.querySelector('.graph-pane');const isOpen=panel.classList.toggle('is-expanded');$('focusToggle').textContent=isOpen?'✕ 拡大を閉じる':'⤢ 拡大表示';$('focusToggle').setAttribute('aria-pressed',String(isOpen));});
    $('layoutReset').addEventListener('click',()=>{
      for(const n of state.nodes){n.pinned=false;n.x=n.anchorX;n.y=n.anchorY;}
      paintNetwork();$('layoutReset').hidden=true;
    });
    $('resetWeights').addEventListener('click',()=>{
      state.weights=Object.fromEntries(state.index.fields.map(f=>[f.key,f.weight]));
      buildWeightControls();state.ranked=getRanked(state.seed,Math.max(70,state.count*4));drawNetwork();candidateDetails();
    });
    $('displayCount').addEventListener('input',e=>{$('displayCountValue').textContent=e.target.value;});
    $('displayCount').addEventListener('change',e=>setCount(Number(e.target.value)));
    $('recipeQuery').addEventListener('input',e=>e.target.setCustomValidity(''));
    $('recipeQuery').addEventListener('change',e=>searchByName(e.target.value));
    $('recipeQuery').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchByName(e.target.value);}});
    $('localJson').addEventListener('change',async e=>{
      const file=e.target.files?.[0];if(!file)return;
      try{RecipeData.setData(JSON.parse(await file.text()),file.name);await initialize();}
      catch(error){fail(error);}
    });
    window.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.graph-pane').classList.contains('is-expanded'))$('focusToggle').click();});
  }
  document.addEventListener('DOMContentLoaded',()=>{installEvents();initialize().catch(fail);});
})();
