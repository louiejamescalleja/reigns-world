(function (root) {
  'use strict';

  const directory = id => `assets/pets/flat-v4/${id}/`;
  const mask = id => directory(id) + 'standing-mask.png';
  const standing = id => directory(id) + 'standing.png';
  const definitions = new Map();
  const canvas = (width, height) => Object.assign(document.createElement('canvas'), {width, height});
  const image = src => new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = reject;
    element.src = src;
  });

  function load(id) {
    if (!definitions.has(id)) {
      const base = directory(id);
      const loading = fetch(base + 'rig.json').then(response => {
        if (!response.ok) throw new Error('Could not load pet joints');
        return response.json();
      }).then(async config => {
        const parts = Object.entries(config.parts).sort((a,b) => a[1].z-b[1].z);
        await Promise.all(parts.map(async ([, part]) => {
          [part.art, part.mask] = await Promise.all([image(base+part.texture), image(base+part.paintMask)]);
        }));
        return {config, parts};
      }).catch(error => {
        definitions.delete(id);
        throw error;
      });
      definitions.set(id, loading);
    }
    return definitions.get(id);
  }

  async function prepare(id, state) {
    const [{config, parts}, strokes] = await Promise.all([
      load(id), state.paint ? paintImage(id,state) : null
    ]);
    return {config, parts: parts.map(([name, part]) => {
      const [x,y,w,h] = part.rect;
      if (!state.coat && !strokes) return [name, part];
      const paint = canvas(w,h), brush = paint.getContext('2d');
      if (state.coat) {
        brush.globalAlpha = .78;
        brush.fillStyle = state.coat;
        brush.fillRect(0,0,w,h);
        brush.globalAlpha = 1;
      }
      if (strokes) brush.drawImage(strokes,-x,-y,340,340);
      brush.globalCompositeOperation = 'destination-in';
      brush.drawImage(part.mask,0,0);
      const art = canvas(w,h), surface = art.getContext('2d');
      surface.drawImage(part.art,0,0);
      // Change RGB without compositing another antialiased edge onto the joint.
      // Matching mask/texture alpha gives full color coverage right to the seam.
      const pixels=surface.getImageData(0,0,w,h),ink=brush.getImageData(0,0,w,h).data;
      for(let i=0;i<ink.length;i+=4){
        const a=pixels.data[i+3]?Math.min(1,ink[i+3]/pixels.data[i+3]):0;
        for(let c=0;c<3;c++)pixels.data[i+c]=Math.round(pixels.data[i+c]*(1-a)+ink[i+c]*a);
      }
      surface.putImageData(pixels,0,0);
      return [name, {...part, art}];
    })};
  }

  async function paintImage(id,state) {
    const ink = await image(state.paint);
    if(state.paintSpace === 'hybrid-v2') return ink;
    const {parts} = await load(id);
    const out = canvas(340,340), c=out.getContext('2d');
    for(const [,part] of parts){
      const src=part.legacyRect || part.rect;
      const [x,y,w,h]=part.rect;
      const tile=canvas(w,h), t=tile.getContext('2d');
      t.drawImage(ink,...src,0,0,w,h);
      t.globalCompositeOperation='destination-in';t.drawImage(part.mask,0,0);
      c.drawImage(tile,x,y);
    }
    return out;
  }

  const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
  const mix=(a,b,t)=>a+(b-a)*t;
  function pickupAmount(actor,now,reduced){
    if(actor.mode==='carry')return reduced?1:smooth((now-(actor.carryStartedAt??now-200))/200);
    return reduced?0:(actor.releaseCarryAmount||0)*(1-smooth((now-(actor.releasedCarryAt??-10000))/280));
  }
  function pose(rig,actor,now,reduced){
    const carry=pickupAmount(actor,now,reduced), moving=actor.mode==='walk'&&!reduced;
    const cycle=((actor.travel||0)/58)%1, gait=cycle*Math.PI*2, bunny=actor.id==='bunny';
    const elapsed=now-(actor.landedAt??-10000);
    const settle=!reduced&&elapsed>=0&&elapsed<440?Math.sin(elapsed/440*Math.PI):0;
    const flight=moving&&bunny&&cycle>.18&&cycle<.78?Math.sin((cycle-.18)/.6*Math.PI):0;
    const crouch=moving&&bunny?(cycle<.18?Math.sin(cycle/.18*Math.PI):cycle>.78?Math.sin((cycle-.78)/.22*Math.PI):0):0;
    const bob=moving&&!bunny?Math.cos(gait*2)*1.8:0;
    const squash=1-(.055*crouch+.06*settle)*(1-carry);
    const bodyAngle=-Math.PI/2*carry;
    const carryOffsets={head:[65,-2],frontNear:[30,52],frontFar:[30,-50],rearNear:[-55,45],rearFar:[-55,-43],tail:[-45,-25]};
    const transforms={};
    for(const [name,part] of rig.parts){
      let x=part.bindOffset[0],y=part.bindOffset[1],angle=0;
      const rear=name.startsWith('rear'),leg=/^(front|rear)/.test(name);
      if(name==='body'){x=mix(x,170,carry);y=mix(y-flight*30+bob,216,carry);angle=bodyAngle;}
      else {
        if(carryOffsets[name]){x=mix(x,carryOffsets[name][0],carry);y=mix(y,carryOffsets[name][1],carry);}
        let rest=0,carried=0;
        if(name==='head'){rest=moving?-.018*Math.cos(gait*2):0;carried=Math.PI/2;if(now<(actor.eatingUntil||0)){const age=now-actor.eatingStartedAt,amount=Math.min(1,age/350,(actor.eatingUntil-now)/350);rest=amount*(.48+(reduced?0:.06*Math.sin(age/110)));y+=amount*18;}}
        if(name==='tail'){rest=reduced?0:.10*Math.sin(now/420);carried=-.58+(reduced?0:.08*Math.sin(now/430));}
        if(leg){
          if(bunny)rest=(rear?-.30:.20)*flight+(rear?.12:-.08)*crouch;
          else if(moving)rest=.16*Math.cos(gait+((rear===name.endsWith('Near'))?Math.PI:0));
          const phase=(rear?1.8:0)+(name.endsWith('Far')?1.3:0);
          const age=Math.max(0,now-(actor.carryStartedAt??now));
          const kick=reduced?0:.22*Math.exp(-age/700)*Math.sin(age/120+phase);
          const velocity=reduced?0:(actor.dragSwing||0)*Math.exp(-Math.max(0,now-(actor.dragMovedAt||0))/300);
          carried=Math.PI/2+(name.endsWith('Far')?.22:-.22)+kick+(reduced?0:.065*Math.sin(now/310+phase))+velocity;
        }
        angle=mix(rest,carried,carry);
      }
      transforms[name]={x,y,angle};
    }
    return {carry,squash,flight,transforms};
  }
  function draw(surface,rig,actor,now,reduced){
    const {carry,squash,flight,transforms}=pose(rig,actor,now,reduced);
    // Merge the opaque pieces first. Only the final silhouette receives an outline.
    if(!actor.rigLayer)actor.rigLayer=canvas(340,340);
    if(!actor.rigOutline)actor.rigOutline=canvas(340,340);
    const layer=actor.rigLayer,ctx=layer.getContext('2d');ctx.clearRect(0,0,340,340);
    ctx.save();ctx.translate(170,rig.config.groundY);ctx.scale(actor.facing||1,1);ctx.scale(1+(1-squash)*.4,squash);ctx.translate(-170,-rig.config.groundY);
    const joints=Object.fromEntries(rig.parts);
    function position(name){const part=joints[name];if(part.parent)position(part.parent);const t=transforms[name];ctx.translate(t.x,t.y);ctx.rotate(t.angle);}
    // Near limbs are in front during pickup; upper caps overlap the solid torso.
    const order=carry>.01?['tail','rearFar','frontFar','body','rearNear','frontNear','head']:rig.parts.map(([n])=>n);
    for(const name of order){const part=joints[name];ctx.save();position(name);ctx.drawImage(part.art,-part.pivot[0],-part.pivot[1]);ctx.restore();}
    ctx.restore();
    const outline=actor.rigOutline,oc=outline.getContext('2d');oc.clearRect(0,0,340,340);oc.drawImage(layer,0,0);oc.globalCompositeOperation='source-in';oc.fillStyle='#92755c';oc.fillRect(0,0,340,340);oc.globalCompositeOperation='source-over';
    const out=surface.getContext('2d');out.clearRect(0,0,340,340);
    if(carry<.99){out.fillStyle=`rgba(42,55,33,${(.14-flight*.08)*(1-carry)})`;out.beginPath();out.ellipse(168,rig.config.groundY,72-flight*20,7,0,0,Math.PI*2);out.fill();}
    for(const [x,y] of [[-1,0],[1,0],[0,-1],[0,1],[-.7,-.7],[.7,-.7],[-.7,.7],[.7,.7]])out.drawImage(outline,x,y);
    out.drawImage(layer,0,0);
  }
  root.GardenPetRig={prepare,draw,standing,mask,paintImage,pose,pickupAmount};
})(window);
