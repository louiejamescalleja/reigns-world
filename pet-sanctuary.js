/* Reign's Garden — Pet Sanctuary (phase 1).
 * Six neutral-white pets; name, color and gentle roaming only. No adoption, care, spending or flower system.
 * Saves to the original Garden state through GardenStorage via app.js.
 */
(function (root) {
  'use strict';

  const PETS = Object.freeze({
    puppy:    {title:'Puppy',defaultName:'Biscuit',row:'front',speed:58,home:[825,510]},
    kitten:   {title:'Kitten',defaultName:'Snowy',row:'back',speed:49,home:[1130,404]},
    bunny:    {title:'Bunny',defaultName:'Hopsy',row:'back',speed:55,home:[1385,490]},
    corgi:    {title:'Corgi dog',defaultName:'Pip',row:'front',speed:58,home:[1030,610]},
    spaniel:  {title:'Spaniel dog',defaultName:'Mochi',row:'front',speed:48,home:[1295,610]},
    longhair: {title:'Fluffy longhair cat',defaultName:'Luna',row:'back',speed:47,home:[690,407]}
  });
  const usesRig=()=>true;
  const ids=Object.keys(PETS);
  const standingSprites={'corgi': 'joyful_fluffy_corgi_puppy_sprite', 'spaniel': 'joyful_fluffy_puppy_mascot', 'longhair': 'joyful_white_longhair_kitten_sprite'};
  const base=id=>standingSprites[id]?`assets/pets/${standingSprites[id]}.png`:`assets/pets/${id}_blank.webp`;
  const original=id=>`assets/pets/${id}_original.webp`;
  const walkImage=id=>`assets/pets/${id}_walk.webp`;
  const carryImage=id=>`assets/pets/${id}_carry.webp`;
  const paintMask=id=>`assets/pets/${id}_paint_mask.png`;
  const coatMask=id=>`assets/pets/${id}_coat_mask.png`;
  const imageCache = new Map();
  const paintedWalkCache = new Map();
  const validHex = value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
  const isPaint = value=>typeof value==='string'&&value.length<950000&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);
  const esc=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const nameSafe=value=>String(value??'').trim().replace(/[\x00-\x1f\x7f]/g,'').slice(0,24);
  const SWATCHES=['#ed799e','#d2a06b','#a5caee','#b39de4','#8dc88c','#f9c96b','#555b66','#ffffff'];
  let editor=null;
  // Coordinates are fractions of the complete background, independent of viewport size.
  // Legacy saved positions remain readable in the original 1648×928 coordinate space.
  const LAWN=[[.18,.58],[.145,.54],[.17,.48],[.20,.44],[.235,.40],[.285,.37],[.33,.34],[.42,.31],[.50,.31],[.55,.37],[.67,.40],[.74,.40],[.77,.47],[.855,.52],[.85,.59],[.93,.69],[.90,.76],[.81,.83],[.75,.92],[.62,.95],[.59,.89],[.60,.81],[.56,.73],[.51,.66],[.46,.62],[.40,.59],[.36,.59],[.33,.63],[.28,.64],[.25,.62],[.215,.61]];
  const OBSTACLES=[[[.205,.46],[.247,.405],[.305,.405],[.34,.46],[.36,.52],[.32,.58],[.27,.59],[.215,.55]]];
  const WALK_PREFS={puppy:800,kitten:800,bunny:640,corgi:850,spaniel:850,longhair:850};
  let world=null,drag=null,lastTick=0,frame=0,ignoreClickUntil=0;
  const reduceMotion=()=>typeof root.matchMedia==='function'&&root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  const random=(a,b)=>a+Math.random()*(b-a);
  const homeFor=id=>[PETS[id].home[0]/1648,PETS[id].home[1]/928];
  const distance=(a,b)=>Math.hypot((a[0]-b[0])*1648,(a[1]-b[1])*928);
  const savedPosition=pet=>Array.isArray(pet.positionUV)&&pet.positionUV.length===2&&pet.positionUV.every(Number.isFinite)?pet.positionUV:Array.isArray(pet.position)&&pet.position.length===2&&pet.position.every(Number.isFinite)?[pet.position[0]/1648,pet.position[1]/928]:null;
  function inside(x,y,polygon){
    let result=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
      const a=polygon[i],b=polygon[j];
      if(((a[1]>y)!==(b[1]>y))&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])result=!result;
    }
    return result;
  }
  function withinLawn(x,y){return inside(x,y,LAWN)&&!OBSTACLES.some(p=>inside(x,y,p));}
  function geometry(){
    if(!world)return null;
    const el=world.stage,w=el.clientWidth,h=el.clientHeight;
    if(!w||!h)return null;
    const scale=Math.max(w/1672,h/940),bw=1672*scale,bh=940*scale;
    return {w,h,bw,bh,scale:bw/1648,xoff:(w-bw)*.5,yoff:(h-bh)*.54};
  }
  const toScreen=(x,y,g)=>[x*g.bw+g.xoff,y*g.bh+g.yoff];
  const toWorld=(x,y,g)=>[(x-g.xoff)/g.bw,(y-g.yoff)/g.bh];
  function sizeFor(pet,g){
    const depth=clamp(.84+(pet.y*928-360)/800,.83,1.22);
    return .85*clamp(g.scale*(pet.id==='bunny'?170:pet.id==='longhair'?182:190)*depth,78,176);
  }
  function visible(x,y,g,pet={id:'puppy'}){
    const [sx,sy]=toScreen(x,y,g),size=sizeFor({...pet,y},g);
    return sx>size*.5+5&&sx<g.w-size*.5-5&&sy>size*.88+8&&sy<g.h-size*.13-32;
  }
  function allowed(x,y,pet,g){
    // Footprint clearance protects ground contact; transparent canvas margins may overlap scenery.
    return withinLawn(x,y)&&withinLawn(x-.012,y)&&withinLawn(x+.012,y)&&withinLawn(x,y+.006)&&(!g||visible(x,y,g,pet));
  }
  function groundSamples(pet,g){
    const key=pet.id+':'+g.w+':'+g.h;
    world.groundCache??=new Map();
    if(!world.groundCache.has(key)){
      const points=[];
      for(let y=.30;y<.97;y+=.0125)for(let x=.14;x<.95;x+=.0125)if(allowed(x,y,pet,g))points.push([x,y]);
      world.groundCache.set(key,points);
    }
    return world.groundCache.get(key);
  }
  function clampToLawn(x,y,pet={id:'puppy'},g=geometry()){
    if(allowed(x,y,pet,g))return [x,y];
    const samples=g?groundSamples(pet,g):[[.60,.52]];
    let best=samples[0]||[.60,.52],dist=Infinity;
    for(const point of samples){const d=distance(point,[x,y]);if(d<dist){dist=d;best=point;}}
    // Approach the nearest boundary from a known-valid point, never through scenery.
    let low=0,high=1;
    for(let i=0;i<14;i++){const t=(low+high)/2;if(allowed(best[0]+(x-best[0])*t,best[1]+(y-best[1])*t,pet,g))low=t;else high=t;}
    return [best[0]+(x-best[0])*low,best[1]+(y-best[1])*low];
  }
  function clearPath(a,b,pet,g){
    const steps=Math.max(1,Math.ceil(distance(a,b)/12));
    for(let i=1;i<=steps;i++){const t=i/steps;if(!allowed(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,pet,g))return false;}
    return true;
  }
  function nextTarget(pet){
    if(!world)return homeFor(pet.id);
    const g=geometry();if(!g)return [pet.x,pet.y];
    const samples=groundSamples(pet,g),origin=[pet.x,pet.y];
    for(let i=0;i<140;i++){
      const point=samples[Math.floor(Math.random()*samples.length)];if(!point)break;
      if(distance(origin,point)<65||!clearPath(origin,point,pet,g))continue;
      if(Object.values(world.pets).some(other=>other!==pet&&distance([other.x,other.y],point)<95))continue;
      return point.slice();
    }
    return origin;
  }
  function setImage(pet){
    if(!world)return;
    const img=pet.node.querySelector('img');
    if(pet.rig){
      root.GardenPetRig.draw(pet.rigCanvas,pet.rig,pet,performance.now(),reduceMotion());
      return;
    }
    const custom=!!world.state.petSanctuary[pet.id]?.coat||!!world.state.petSanctuary[pet.id]?.paint;
    const src=pet.mode==='carry'?(custom?pet.carryCustom||pet.idleImage:carryImage(pet.id)):
              pet.mode==='walk'&&!standingSprites[pet.id]&&!reduceMotion()?(custom?(pet.walkFrames?pet.walkFrames[Math.floor((performance.now()+pet.phase)/125)%pet.walkFrames.length]:pet.idleImage):walkImage(pet.id)):pet.idleImage;
    if(src&&img.getAttribute('src')!==src)img.src=src;
  }
  function paintWorld(){
    if(!world)return;
    const g=geometry();if(!g)return;
    for(const pet of Object.values(world.pets)){
      if(!allowed(pet.x,pet.y,pet,g)){[pet.x,pet.y]=clampToLawn(pet.x,pet.y,pet,g);pet.target=[pet.x,pet.y];}
      const [sx,sy]=toScreen(pet.x,pet.y,g),size=sizeFor(pet,g);
      const el=pet.node;
      el.classList.toggle('has-pet-rig',!!pet.rig);
      el.style.left=`${sx}px`;el.style.width=`${size}px`;
      // Anchor the rig's existing groundY, not the bottom of its name label.
      const belowGround=el.offsetHeight-size*296/340;
      el.style.bottom=`${g.h-sy-belowGround}px`;
      el.style.zIndex=pet.mode==='carry'?'9999':String(clamp(Math.round(sy),1,900));
      el.classList.toggle('is-moving',pet.mode==='walk');
      el.classList.toggle('is-hopping',pet.mode==='walk'&&pet.id==='bunny');
      el.classList.toggle('is-carried',pet.mode==='carry');
      el.style.setProperty('--pet-facing',String(pet.facing));
      el.style.setProperty('--pet-walk-duration',`${WALK_PREFS[pet.id]}ms`);
      if(pet.ball){const age=performance.now()-pet.playStartedAt;if(age>=3000){pet.ball.remove();pet.ball=null;}else{pet.ball.style.left=(sx+pet.facing*size*.43-20)+'px';pet.ball.style.top=(sy-40)+'px';pet.ball.style.transform='rotate('+(pet.facing*age*.5)+'deg)';}}
      setImage(pet);
    }
  }
  function stop(){
    root.PondFish?.stop();
    if(frame){root.cancelAnimationFrame(frame);frame=0;}
    if(world){
      for(const pet of Object.values(world.pets)){
        pet.ball?.remove();pet.ball=null;pet.rigCanvas?.remove();
        pet.node.classList.remove('has-pet-rig');
        pet.mode='rest';pet.node.classList.remove('is-moving','is-hopping','is-carried');
        if(pet.idleImage)pet.node.querySelector('img').src=pet.idleImage;
      }
      if(world.stage){world.stage.removeEventListener('pointerdown',onDragStart);world.stage.removeEventListener('pointermove',onDragMove);world.stage.removeEventListener('pointerup',onDragEnd);world.stage.removeEventListener('pointercancel',onDragCancel);world.stage.removeEventListener('lostpointercapture',onLostCapture);}
    }
    drag=null;world=null;lastTick=0;
  }
  function startRoaming(host){
    stop();
    const stage=host.matches?.('.sanctuary-stage')?host:host.querySelector('.sanctuary-stage');if(!stage)return;
    const state=host.__sanctuaryState,save=host.__sanctuarySave,toast=host.__sanctuaryToast;
    if(!state)return;
    world={stage,host,state,save,toast,pets:{}};
    const now=performance.now();
    for(const id of ids){
      const node=stage.querySelector(`[data-sanctuary-pet="${id}"]`);if(!node)continue;
      const saved=savedPosition(state.petSanctuary[id]);
      const [x,y]=clampToLawn(...(saved||homeFor(id)),{id},geometry());
      world.pets[id]={id,node,x,y,target:[x,y],facing:1,mode:'rest',restUntil:now+random(600,2400),idleImage:node.querySelector('img').getAttribute('src'),carryCustom:null,walkFrames:null,phase:random(0,900)};
    }
    stage.addEventListener('pointerdown',onDragStart);
    stage.addEventListener('pointermove',onDragMove);
    stage.addEventListener('pointerup',onDragEnd);
    stage.addEventListener('pointercancel',onDragCancel);
    stage.addEventListener('lostpointercapture',onLostCapture);
    paintWorld();
    frame=root.requestAnimationFrame(tick);
  }
  function tick(time){
    if(!world)return;
    const dt=lastTick?Math.min(.05,(time-lastTick)/1000):0;lastTick=time;
    if(!document.hidden&&!reduceMotion()&&dt){
      for(const pet of Object.values(world.pets)){
        if(drag?.id===pet.id)continue;
        if(time<(pet.eatingUntil||0)){pet.mode='rest';continue;}
        if(time<(pet.playingUntil||0))pet.restUntil=0;
        if(time<pet.restUntil){pet.mode='rest';continue;}
        let dx=pet.target[0]-pet.x,dy=pet.target[1]-pet.y,distance=Math.hypot(dx*1648,dy*928);
        if(distance<4){
          pet.mode='rest';pet.restUntil=time<(pet.playingUntil||0)?0:time+random(950,3200);pet.target=nextTarget(pet);continue;
        }
        const motion=pet.id==='bunny'?(Math.sin(time/640*Math.PI*2)>.65?.45:1):1;
        const distanceStep=Math.min(distance,PETS[pet.id].speed*dt*motion);
        pet.travel=(pet.travel||0)+distanceStep;
        pet.x+=distanceStep*dx/distance;pet.y+=distanceStep*dy/distance;
        pet.facing=dx<0?-1:1;pet.mode='walk';
      }
    }
    paintWorld();frame=root.requestAnimationFrame(tick);
  }
  function onDragStart(event){
    if(!world||drag||event.button!==0||event.isPrimary===false||editor)return;
    const node=event.target.closest('[data-sanctuary-pet]');
    if(!node||!world.stage.contains(node))return;
    const pet=world.pets[node.dataset.sanctuaryPet];if(!pet)return;
    const g=geometry();if(!g)return;
    const rect=world.stage.getBoundingClientRect(),[sx,sy]=toScreen(pet.x,pet.y,g);
    drag={offset:[sx-event.clientX+rect.left,sy-event.clientY+rect.top],id:pet.id,pointerId:event.pointerId,node,origin:[pet.x,pet.y],x:event.clientX,y:event.clientY,moved:false};
    pet.mode='rest';pet.restUntil=performance.now()+1200;
    try{node.setPointerCapture(event.pointerId);}catch{}
    event.preventDefault();
  }
  function onDragMove(event){
    if(!world||!drag||drag.pointerId!==event.pointerId)return;
    const movement=Math.hypot(event.clientX-drag.x,event.clientY-drag.y);
    if(!drag.moved&&movement<9)return;
    const pet=world.pets[drag.id],g=geometry();if(!pet||!g)return;
    const now=performance.now();
    if(!drag.moved){pet.carryStartedAt=now;pet.releasedCarryAt=undefined;}
    const lastX=drag.lastX??drag.x,lastTime=drag.lastTime??now-16;
    pet.dragSwing=clamp((event.clientX-lastX)/Math.max(16,now-lastTime)*.14,-.24,.24);
    pet.dragMovedAt=now;drag.lastX=event.clientX;drag.lastTime=now;
    drag.moved=true;
    const rect=world.stage.getBoundingClientRect();
    const px=event.clientX-rect.left+drag.offset[0],py=event.clientY-rect.top+drag.offset[1];
    let [wx,wy]=clampToLawn(...toWorld(px,py,g),pet,g);
    pet.x=wx;pet.y=wy;pet.facing=event.clientX<drag.x?-1:1;pet.mode='carry';pet.target=[wx,wy];
    paintWorld();event.preventDefault();
  }
  function finishDrag(event,cancelled){
    if(!world||!drag||drag.pointerId!==event.pointerId)return;
    const d=drag,pet=world.pets[d.id];drag=null;
    if(!pet)return;
    if(cancelled){[pet.x,pet.y]=d.origin;}
    else if(d.moved){
      const pos=clampToLawn(pet.x,pet.y,pet,geometry());[pet.x,pet.y]=pos;
      world.state.petSanctuary[pet.id].positionUV=pos.map(x=>Math.round(x*1e6)/1e6);
      world.state.petSanctuary[pet.id].position=[Math.round(pos[0]*16480)/10,Math.round(pos[1]*9280)/10];
      world.save?.();world.toast?.(`${world.state.petSanctuary[pet.id].name} has a new spot to explore!`);
    }
    const released=performance.now();
    pet.releaseCarryAmount=root.GardenPetRig.pickupAmount(pet,released,reduceMotion());
    pet.releasedCarryAt=released;
    pet.mode='rest';pet.restUntil=released+random(900,1600);pet.target=nextTarget(pet);
    if(d.moved&&!cancelled)pet.landedAt=performance.now();
    if(d.moved)ignoreClickUntil=performance.now()+650;
    paintWorld();
    try{if(d.node.hasPointerCapture(event.pointerId))d.node.releasePointerCapture(event.pointerId);}catch{}
    event.preventDefault();
  }
  function onDragEnd(event){finishDrag(event,false);}
  function onDragCancel(event){finishDrag(event,true);}
  function onLostCapture(event){if(drag?.pointerId===event.pointerId)finishDrag(event,true);}

  function migrate(state){
    if(!state.petSanctuary||typeof state.petSanctuary!=='object'||Array.isArray(state.petSanctuary))state.petSanctuary={};
    const pets=state.petSanctuary;
    for(const id of ids){
      const existing=pets[id];
      if(!existing||typeof existing!=='object'||Array.isArray(existing))pets[id]={};
      const pet=pets[id];
      if(typeof pet.name!=='string'||!nameSafe(pet.name))pet.name=PETS[id].defaultName;
      else pet.name=nameSafe(pet.name);
      if(pet.coat!==null&&!validHex(pet.coat))pet.coat=null;
      if(pet.paint!==null&&pet.paint!==''&&!isPaint(pet.paint))pet.paint='';
      if(typeof pet.paint!=='string')pet.paint='';
      if(pet.position!==undefined&&(!Array.isArray(pet.position)||pet.position.length!==2||!pet.position.every(Number.isFinite)))delete pet.position;
    }
    return state;
  }
  function valid(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    return ids.every(id=>{
      const pet=value[id];
      return pet&&typeof pet==='object'&&!Array.isArray(pet)&&typeof pet.name==='string'&&nameSafe(pet.name)===pet.name&&pet.name.length<=24&&(pet.coat===null||validHex(pet.coat))&&(pet.paint===''||isPaint(pet.paint))&&(pet.position===undefined||(Array.isArray(pet.position)&&pet.position.length===2&&pet.position.every(Number.isFinite)));
    });
  }
  function loadImage(src){
    if(!imageCache.has(src)){
      if(src.startsWith('data:'))return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Could not open saved coloring'));img.src=src;});
      imageCache.set(src,new Promise((resolve,reject)=>{
        const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Missing pet image: '+src));img.src=src;
      }));
    }
    return imageCache.get(src);
  }
  function canvas340(){const canvas=document.createElement('canvas');canvas.width=340;canvas.height=340;return canvas;}
  function makeMaskedOverlay(source, mask){
    const layer=canvas340(),ctx=layer.getContext('2d');
    if(typeof source==='string'){ctx.fillStyle=source;ctx.fillRect(0,0,340,340);}else ctx.drawImage(source,0,0,340,340);
    ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0,340,340);
    return layer;
  }
  async function composite(id,state){
    const pet=state.petSanctuary[id];
    const custom=!!pet.coat||!!pet.paint;
    if(!custom)return base(id);
    const [blank,coatMaskImg,paintMaskImg]=await Promise.all([loadImage(base(id)),loadImage(coatMask(id)),loadImage(paintMask(id))]);
    const result=canvas340(),ctx=result.getContext('2d');ctx.drawImage(blank,0,0);
    if(pet.coat){
      ctx.globalAlpha=.78;
      ctx.drawImage(makeMaskedOverlay(pet.coat,coatMaskImg),0,0);
      ctx.globalAlpha=1;
    }
    if(pet.paint){
      const strokes=await loadImage(pet.paint);
      ctx.drawImage(makeMaskedOverlay(strokes,paintMaskImg),0,0);
    }
    return result.toDataURL('image/png');
  }
  // Paint is applied to the actual sprite and transformed as one texture. This
  // produces foot-stepping cycles even for personalized coats, avoiding the
  // old problem where saved coloring made pets return to a single still frame.
  async function paintedWalkFrames(id,src,key){
    const cached=paintedWalkCache.get(id);
    if(cached?.key===key)return cached.frames;
    const image=await loadImage(src),frames=[];
    const TWO_PI=2*Math.PI;
    for(let n=0;n<6;n++){
      const phase=TWO_PI*n/6,step=Math.sin(phase),liftA=Math.max(0,step),liftB=Math.max(0,-step);
      const layer=canvas340(),ctx=layer.getContext('2d');ctx.imageSmoothingEnabled=true;
      for(let y=0;y<340;y+=5){
        for(let x=0;x<340;x+=12){
          const ax=x+6,ay=y+2.5;
          const a=Math.exp(-(((ax-235)/47)**2+((ay-275)/39)**2)/2);
          const b=Math.exp(-(((ax-115)/49)**2+((ay-280)/39)**2)/2);
          const dx=4.4*step*(a-b),dy=1.5*(Math.cos(phase)**2)-4.8*(liftA*a+liftB*b);
          ctx.drawImage(image,x,y,Math.min(12,340-x),Math.min(5,340-y),x+dx,y+dy,Math.min(12.3,340-x),Math.min(5.3,340-y));
        }
      }
      frames.push(layer.toDataURL('image/webp',.89));
    }
    paintedWalkCache.set(id,{key,frames});
    return frames;
  }
  async function carryFromColor(src){
    const image=await loadImage(src),result=canvas340(),ctx=result.getContext('2d');
    // Same progressive lower-body taper used in supplied carry sprites.
    for(let y=0;y<340;y++){
      const f=clamp((y-110)/210,0,1),scale=1-.10*f;
      ctx.drawImage(image,0,clamp(y-8*f,0,339),340,1,170-170*scale,y,340*scale,1.2);
    }
    return result.toDataURL('image/png');
  }
  function updatePortraits(state){
    for(const id of ids){
      const img=document.querySelector(`[data-sanctuary-portrait="${id}"]`);
      if(!img)continue;
      const key=JSON.stringify(state.petSanctuary[id]);
      img.dataset.renderKey=key;
      const actor=world?.pets[id];
      if(actor&&usesRig(state.petSanctuary[id])){
        root.GardenPetRig.prepare(id,state.petSanctuary[id]).then(rig=>{
          if(world?.pets[id]!==actor||img.dataset.renderKey!==key)return;
          actor.rig=rig;
          if(!actor.rigCanvas){
            actor.rigCanvas=canvas340();
            actor.rigCanvas.className='sanctuary-rig-canvas';
            actor.rigCanvas.setAttribute('aria-hidden','true');
            img.after(actor.rigCanvas);
          }
          paintWorld();
        }).catch(error=>console.warn('Could not load pet rig',id,error));
        continue;
      }
      composite(id,state).then(async src=>{
        if(!img.isConnected||img.dataset.renderKey!==key)return;
        if(world?.pets[id]){
          const actor=world.pets[id];actor.idleImage=src;actor.carryCustom=null;
          if(!!state.petSanctuary[id].paint||!!state.petSanctuary[id].coat){
            actor.carryCustom=await carryFromColor(src);
            if(world?.pets[id]===actor){
              actor.walkFrames=await paintedWalkFrames(id,src,key);
            }
          }
          if(world?.pets[id]===actor)paintWorld();
        } else img.src=src;
      }).catch(()=>{if(img.isConnected)img.src=original(id);});
    }
  }
  const petButtons=state=>ids.filter(id=>PetShop.owns(state,id)).map(id=>`<button type="button" class="sanctuary-pet sanctuary-${id}" data-row="${PETS[id].row}" data-sanctuary-pet="${id}" style="left:50%;bottom:20%" aria-label="Customize or move ${esc(state.petSanctuary[id].name)}, the ${PETS[id].title.toLowerCase()}"><span class="sanctuary-art"><img data-sanctuary-portrait="${id}" src="${base(id)}" alt="" draggable="false"></span><span class="sanctuary-grip" aria-hidden="true"><svg viewBox="0 0 68 74" width="68" height="74"><path d="M25 8q-6-2-8 5l-5 21q-2 7 6 10l7 2 6 13q4 9 13 3l9-14q5-8 0-14l-12-10q-3-3-8-2L35 9q-5-7-10-1Z" fill="#ffd8af" stroke="#a56a41" stroke-width="3" stroke-linejoin="round"/><path d="M17 34l13 9m1-25 10 16m-11 9 6 12" fill="none" stroke="#bc8965" stroke-width="3" stroke-linecap="round"/></svg></span><span class="sanctuary-pet-name">${esc(state.petSanctuary[id].name)}</span></button>`).join('');
  function render({host,state,save,toast}){
    stop();migrate(state);editor=null;
    host.__sanctuaryState=state;host.__sanctuarySave=save;host.__sanctuaryToast=toast;
    host.innerHTML=`<section class="sanctuary" aria-label="Pet Sanctuary">

      <div class="sanctuary-stage" aria-label="Pet garden">

        ${petButtons(state)}
      </div>
      <section class="sanctuary-editor" id="sanctuary-editor" hidden aria-label="Name and color a pet"></section>
    </section>`;
    host.querySelectorAll('[data-sanctuary-pet]').forEach(button=>button.addEventListener('click',()=>{
      if(performance.now()<ignoreClickUntil||drag?.moved)return;
      openEditor({host,state,save,toast},button.dataset.sanctuaryPet);
    }));
    startRoaming(host);
    updatePortraits(state);
    PetShop.feeding(host,state);root.PondFish?.mount(host,state,save,toast);
  }
  function openEditor(ctx,id){
    if(!PETS[id]||!PetShop.owns(ctx.state,id))return;
    if(editor?.id===id){closeEditor(true);return;}
    closeEditor(false);
    const {host,state,save,toast}=ctx,pet=state.petSanctuary[id],panel=host.querySelector('#sanctuary-editor');
    host.querySelectorAll('[data-sanctuary-pet]').forEach(el=>el.classList.toggle('is-selected',el.dataset.sanctuaryPet===id));
    const rigEditor=usesRig(pet);
    const editorBase=rigEditor?root.GardenPetRig.standing(id):base(id);
    const editorPaintMask=rigEditor?root.GardenPetRig.mask(id):paintMask(id);
    const editorCoatMask=rigEditor?editorPaintMask:coatMask(id);
    panel.hidden=false;
    panel.innerHTML=`<div class="sanctuary-editor-head"><div class="sanctuary-name-display"><h2>${esc(pet.name)}</h2><button type="button" class="sanctuary-edit-name sanctuary-icon-button" aria-label="Rename pet" title="Rename pet"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></button></div><form class="sanctuary-name-form" hidden><input type="text" id="sanctuary-name" maxlength="24" value="${esc(pet.name)}" autocomplete="off" spellcheck="false" aria-label="Pet name"><button type="submit" class="sanctuary-confirm-name sanctuary-icon-button" aria-label="Confirm name" title="Confirm name">✓</button><button type="button" class="sanctuary-cancel-name sanctuary-icon-button" aria-label="Cancel name edit" title="Cancel name edit">↶</button></form><button type="button" class="sanctuary-close" aria-label="Close pet editor">×</button></div>
      <div class="sanctuary-painter"><img src="${editorBase}" alt="" draggable="false"><canvas class="sanctuary-coat-preview" width="340" height="340" aria-hidden="true"></canvas><canvas class="sanctuary-paint-canvas" width="340" height="340" aria-label="Paint the pet by dragging with a mouse, finger, or stylus" style="--paint-mask:url('${editorPaintMask}')"></canvas></div>
      <div class="sanctuary-swatches" aria-label="Paint colors">${SWATCHES.map(color=>`<button class="sanctuary-swatch" type="button" data-sanctuary-color="${color}" style="--swatch:${color}" aria-label="Select color ${color}"></button>`).join('')}</div>
      <div class="sanctuary-tools"><label>Paint color <input type="color" id="sanctuary-brush-color" value="#ed799e"></label><label>Brush size <input type="range" id="sanctuary-brush-size" min="4" max="38" value="14"></label><button class="sanctuary-eraser" type="button" aria-pressed="false">Eraser</button></div>
      <div class="sanctuary-tools sanctuary-coat-row"><label>Base coat <input type="color" id="sanctuary-coat-color" value="${pet.coat||'#ffffff'}"></label><button class="sanctuary-clear-coat" type="button">White coat</button><button class="sanctuary-undo" type="button">Undo</button><button class="sanctuary-clear" type="button">Clear paint</button></div>
      <button class="sanctuary-save-paint" type="button">Save coloring</button>
      <p class="sanctuary-editor-note">Color the white fur. Eyes, nose, mouth, inner ears and dark fur lines are protected.</p>`;
    panel.classList.add('care-mode');PetShop.feeding(panel,state,id);
    const canvas=panel.querySelector('.sanctuary-paint-canvas'),context=canvas.getContext('2d');
    editor={id,canvas,context,panel,ctx,color:'#ed799e',size:14,eraser:false,drawing:false,history:[],paint:pet.paint||'',coat:pet.coat};
    function displayCoat(){
      const coatCanvas=panel.querySelector('.sanctuary-coat-preview'),cc=coatCanvas.getContext('2d');cc.clearRect(0,0,340,340);
      if(!editor?.coat)return;
      loadImage(editorCoatMask).then(mask=>{
        if(editor?.id!==id||!editor.coat)return;
        cc.globalAlpha=.78;cc.drawImage(makeMaskedOverlay(editor.coat,mask),0,0);cc.globalAlpha=1;
      }).catch(()=>{});
    }
    if(pet.paint)root.GardenPetRig.paintImage(id,pet).then(img=>{if(editor?.id===id)context.drawImage(img,0,0,340,340);}).catch(()=>{});
    displayCoat();
    const nameDisplay=panel.querySelector('.sanctuary-name-display'),nameForm=panel.querySelector('.sanctuary-name-form'),nameInput=panel.querySelector('#sanctuary-name');
    const finishNameEdit=()=>{nameInput.value=pet.name;nameForm.hidden=true;nameDisplay.hidden=false;panel.querySelector('.sanctuary-edit-name').focus();};
    const saveName=()=>{
      const name=nameSafe(nameInput.value);
      if(!name){toast('Please give your pet a name.');nameInput.focus();return;}
      pet.name=name;panel.querySelector('h2').textContent=name;
      const button=host.querySelector(`[data-sanctuary-pet="${id}"]`);
      if(button){button.querySelector('.sanctuary-pet-name').textContent=name;button.setAttribute('aria-label',`Customize or move ${name}, the ${PETS[id].title.toLowerCase()}`);}
      save();finishNameEdit();toast(`${name}'s name is saved!`);
    };
    panel.querySelector('.sanctuary-close').addEventListener('click',()=>closeEditor(true));
    panel.querySelector('.sanctuary-edit-name').setAttribute('aria-label','Edit pet name and coloring');
    panel.querySelector('.sanctuary-edit-name').addEventListener('click',()=>{panel.classList.remove('care-mode');nameInput.value=pet.name;nameDisplay.hidden=true;nameForm.hidden=false;nameInput.focus();nameInput.select();});
    panel.querySelector('.sanctuary-cancel-name').addEventListener('click',finishNameEdit);
    nameForm.addEventListener('submit',event=>{event.preventDefault();saveName();});
    nameInput.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();finishNameEdit();}});
    const snapshot=()=>{editor.history.push(context.getImageData(0,0,340,340));if(editor.history.length>12)editor.history.shift();};
    const point=event=>{const rect=canvas.getBoundingClientRect();return [(event.clientX-rect.left)*340/rect.width,(event.clientY-rect.top)*340/rect.height];};
    const paintTo=([x,y])=>{const ed=editor;if(!ed||ed.id!==id)return;const c=ed.context;c.globalCompositeOperation=ed.eraser?'destination-out':'source-over';c.strokeStyle=ed.color;c.fillStyle=ed.color;c.lineWidth=ed.size;c.lineCap=c.lineJoin='round';c.lineTo(x,y);c.stroke();c.beginPath();c.arc(x,y,ed.size/2,0,Math.PI*2);c.fill();c.beginPath();c.moveTo(x,y);c.globalCompositeOperation='source-over';};
    canvas.addEventListener('pointerdown',event=>{if(!editor||editor.id!==id)return;event.preventDefault();snapshot();editor.drawing=true;canvas.setPointerCapture(event.pointerId);const [x,y]=point(event);context.beginPath();context.moveTo(x,y);paintTo([x,y]);});
    canvas.addEventListener('pointermove',event=>{if(editor?.id!==id||!editor.drawing)return;event.preventDefault();paintTo(point(event));});
    const endStroke=()=>{if(editor?.id!==id||!editor.drawing)return;editor.drawing=false;editor.context.beginPath();};
    canvas.addEventListener('pointerup',endStroke);canvas.addEventListener('pointercancel',endStroke);canvas.addEventListener('lostpointercapture',endStroke);
    panel.querySelectorAll('[data-sanctuary-color]').forEach(button=>button.addEventListener('click',()=>{
      editor.color=button.dataset.sanctuaryColor;editor.eraser=false;panel.querySelector('.sanctuary-eraser').setAttribute('aria-pressed','false');panel.querySelector('#sanctuary-brush-color').value=editor.color;
    }));
    panel.querySelector('#sanctuary-brush-color').addEventListener('input',event=>{editor.color=event.target.value;editor.eraser=false;panel.querySelector('.sanctuary-eraser').setAttribute('aria-pressed','false');});
    panel.querySelector('#sanctuary-brush-size').addEventListener('input',event=>{editor.size=Number(event.target.value);});
    panel.querySelector('.sanctuary-eraser').addEventListener('click',event=>{editor.eraser=!editor.eraser;event.currentTarget.setAttribute('aria-pressed',String(editor.eraser));});
    panel.querySelector('#sanctuary-coat-color').addEventListener('input',event=>{editor.coat=event.target.value;displayCoat();});
    panel.querySelector('.sanctuary-clear-coat').addEventListener('click',()=>{editor.coat=null;displayCoat();});
    panel.querySelector('.sanctuary-undo').addEventListener('click',()=>{if(!editor.history.length){toast('Nothing to undo yet.');return;}context.putImageData(editor.history.pop(),0,0);});
    panel.querySelector('.sanctuary-clear').addEventListener('click',()=>{snapshot();context.clearRect(0,0,340,340);});
    panel.querySelector('.sanctuary-save-paint').addEventListener('click',()=>{
      const image=canvas340(),ic=image.getContext('2d');ic.drawImage(canvas,0,0);
      // Clip strokes to the exact V6 paint-safe mask before writing them to storage.
      loadImage(editorPaintMask).then(mask=>{
        if(editor?.id!==id)return;
        ic.globalCompositeOperation='destination-in';ic.drawImage(mask,0,0,340,340);
        const pixels=ic.getImageData(0,0,340,340).data;
        let hasInk=false;for(let a=3;a<pixels.length;a+=4)if(pixels[a]){hasInk=true;break;}
        const painting=hasInk?image.toDataURL('image/png'):'';
        if(painting.length>=950000){toast('This coloring is too large to save.');return;}
        if(pet.paint && pet.paintSpace!=='hybrid-v2' && !pet.legacyPaint)pet.legacyPaint=pet.paint;
        pet.paint=painting;pet.coat=editor.coat;
        if(rigEditor)pet.paintSpace='hybrid-v2';
        save();updatePortraits(state);toast(`Coloring saved for ${pet.name}!`);
      }).catch(()=>toast('Could not load the painting mask. Nothing was saved.'));
    });
  }
  function closeEditor(resumeRoam=false){
    if(editor?.panel){editor.panel.hidden=true;editor.panel.replaceChildren();editor.ctx.host.querySelectorAll('[data-sanctuary-pet]').forEach(el=>el.classList.remove('is-selected'));}
    const host=editor?.ctx?.host;
    editor=null;
    if(resumeRoam&&host){if(!world)startRoaming(host);updatePortraits(host.__sanctuaryState||{});}
  }
  document.addEventListener('pointerdown',event=>{if(editor?.panel&&!editor.panel.contains(event.target))closeEditor(true);},true);
  function feed(id,food){
    if(id==='fish'){root.PondFish?.feed(food);return;}
    if(food==='fishfood')return;
    if(!world||!PetShop.owns(world.state,id)||!world.state.shop.unlockedFoods.includes(food))return;
    closeEditor(true);const pet=world?.pets[id];if(!pet||performance.now()<(pet.eatingUntil||0))return;
    const now=performance.now();pet.eatingStartedAt=now;pet.eatingUntil=now+3000;pet.restUntil=now+3400;pet.mode='rest';pet.target=[pet.x,pet.y];
    const stage=world.stage,rect=pet.node.getBoundingClientRect(),bounds=stage.getBoundingClientRect(),image=document.createElement('img');image.className='sanctuary-meal';image.src='assets/shop/'+food+'.webp';image.alt=food+' for '+world.state.petSanctuary[id].name;image.style.left=Math.max(5,Math.min(bounds.width-66,rect.left-bounds.left+rect.width/2+pet.facing*rect.width*.55-30))+'px';image.style.top=(rect.top-bounds.top+rect.width*296/340-52)+'px';stage.appendChild(image);image.animate([{opacity:0,transform:'translateY(-22px)'},{opacity:1,transform:'translateY(0)'}],{duration:250,fill:'forwards'});setTimeout(()=>{if(image.isConnected)image.animate([{opacity:1},{opacity:0}],{duration:450,fill:'forwards'}).finished.then(()=>image.remove()).catch(()=>image.remove());},3000);
  }
  function playBall(id){
    if(!world||!PetShop.owns(world.state,id)||!world.state.shop.unlockedToys?.includes('ball'))return;
    closeEditor(true);const pet=world?.pets[id];if(!pet||drag)return;pet.ball?.remove();const now=performance.now();pet.eatingUntil=0;pet.playStartedAt=now;pet.playingUntil=now+3000;pet.restUntil=0;pet.target=nextTarget(pet);pet.mode='walk';const image=document.createElement('img');image.className='sanctuary-ball';image.src='assets/shop/ball.svg';image.alt='Rolling ball';world.stage.appendChild(image);pet.ball=image;
  }
  root.PetSanctuary={PETS,migrate,valid,render,stop,feed,playBall};
})(window);
