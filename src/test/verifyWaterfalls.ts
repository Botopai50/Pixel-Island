const assert=Object.assign((condition:unknown,message='Assertion failed')=>{if(!condition)throw Error(message);},{equal:(a:unknown,b:unknown)=>{if(a!==b)throw Error(`${a} !== ${b}`);},deepEqual:(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Non-deterministic waterfalls');}});
import { TerrainGenerator } from '../generation/terrain/terrainGenerator.ts';
import { waterfallWorld,waterfallCenter,waterfallWidth } from '../generation/hydrology/waterfallFeatures.ts';
import { createWaterfallGeometry } from '../generation/hydrology/waterfallGeometry.ts';
import { PRNG } from '../generation/math/prng.ts';
import { buildChunkGeometry } from '../generation/terrain/chunkGeometry.ts';
let total=0,minClearance=Infinity;
function renderedHeight(terrain:TerrainGenerator,x:number,z:number){
 const step=2,x0=Math.floor(x/step)*step,z0=Math.floor(z/step)*step,tx=(x-x0)/step,tz=(z-z0)/step;
 const a=terrain.getHeight(x0,z0),b=terrain.getHeight(x0+step,z0),c=terrain.getHeight(x0,z0+step),d=terrain.getHeight(x0+step,z0+step);
 return tx+tz<=1?a+(b-a)*tx+(c-a)*tz:d+(c-d)*(1-tx)+(b-d)*(1-tz);
}
for(const seed of [PRNG.hashString('Avalon'),12345,42]){
 const terrain=new TerrainGenerator(seed),other=new TerrainGenerator(seed);
 const h=terrain.getHydrology(),features=h.getWaterfalls();
 if(seed===PRNG.hashString('Avalon')&&features.length){
  const f=features[0],geo=buildChunkGeometry(terrain,Math.round(f.x/64)*64,Math.round(f.z/64)*64,64,32,false);
  assert.equal(geo.segments,64);
  assert.equal(geo.normals.length,geo.positions.length);
  for(const index of geo.index)assert(index<geo.positions.length/3);
  const chunks=new Map<string,ReturnType<typeof buildChunkGeometry>>();
  function actualHeight(x:number,z:number):number{
   for(const dx of [0,-64,64])for(const dz of [0,-64,64]){
   const cx=Math.round(x/64)*64+dx,cz=Math.round(z/64)*64+dz,key=`${cx},${cz}`;
   let mesh=chunks.get(key);if(!mesh){mesh=buildChunkGeometry(terrain,cx,cz,64,32,false);chunks.set(key,mesh);}
   const p=mesh.positions;
   for(let i=0;i<mesh.segments*mesh.segments*6;i+=3){
    const a=mesh.index[i]*3,b=mesh.index[i+1]*3,c=mesh.index[i+2]*3;
    const ax=p[a]+cx,az=p[a+2]+cz,bx=p[b]+cx,bz=p[b+2]+cz,cxw=p[c]+cx,czw=p[c+2]+cz;
    const det=(bz-czw)*(ax-cxw)+(cxw-bx)*(az-czw);if(Math.abs(det)<1e-8)continue;
    const u=((bz-czw)*(x-cxw)+(cxw-bx)*(z-czw))/det,v=((czw-az)*(x-cxw)+(ax-cxw)*(z-czw))/det;
    if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001)return u*p[a+1]+v*p[b+1]+(1-u-v)*p[c+1];
   }
   }
   throw Error('No terrain triangle at contact');
  }
  for(const side of [-1,1]){
   const contacts=[];
   for(const y of [.3,f.upper*.5,f.upper-1.]){
    let lo=f.width*.5-2,hi=f.width*.5+2;
    for(let i=0;i<16;i++){
     const mid=(lo+hi)*.5,p=waterfallWorld(f,side*mid,f.radius+.12,y);
     if(actualHeight(p.x,p.z)>y)hi=mid;else lo=mid;
    }
    contacts.push((lo+hi)*.5);
   }
   const taper=Math.max(...contacts)-Math.min(...contacts);
   assert(taper<.3,`Curtain still forms a funnel: ${taper} m lateral taper`);
   console.log(JSON.stringify({side,lateralTaper:taper}));
  }
 }
 assert.deepEqual(features,other.getHydrology().getWaterfalls());
 const installed=new TerrainGenerator(seed);installed.getHydrology().setDeferMissing(true);
 for(const packet of h.exportIslands(new Set()))installed.getHydrology().installIsland(packet.key,structuredClone(packet.data));
 assert.deepEqual(features,installed.getHydrology().getWaterfalls());
 console.log(JSON.stringify({seed,features:features.map(f=>({id:f.id,x:f.x,z:f.z,height:f.upper,width:f.width}))}));
 for(const f of features){
  total++;const {geometry,sharedRow,arcOffset,columns}=createWaterfallGeometry(f),index=geometry.index!;
  assert.equal(sharedRow.length,25);
  const weights=geometry.getAttribute('waveWeight'),ribbonUv=geometry.getAttribute('uv');
  let movingCenter=false;
  for(let vertex=0;vertex<weights.count;vertex++){
   const u=ribbonUv.getX(vertex),weight=weights.getX(vertex);
   assert(weight>=0&&weight<=1,'bounded curtain displacement');
   if(u<=.14||u>=.86)assert.equal(weight,0);
   if(vertex<=sharedRow[columns]||vertex>=weights.count-columns-1)assert.equal(weight,0);
   if(u>.4&&u<.6&&weight>.9)movingCenter=true;
  }
  assert(movingCenter,'middle of the curtain can undulate while contacts stay fixed');
  const surface=geometry.getAttribute('position'),flow=geometry.getAttribute('flowPosition');
  assert.equal(flow.count,surface.count);
  for(const vertex of sharedRow){
   assert(Math.abs(flow.getX(vertex)-surface.getX(vertex))<.001,'native texture phase at lip');
   assert(Math.abs(flow.getY(vertex)-surface.getZ(vertex))<.001,'native texture phase at lip');
  }
  const centerVertex=sharedRow[Math.floor(columns/2)];
  let traveled=0;
  for(let vertex=centerVertex+columns+1;vertex<surface.count;vertex+=columns+1){
   const prev=vertex-columns-1;
   traveled+=Math.hypot(surface.getX(vertex)-surface.getX(prev),surface.getY(vertex)-surface.getY(prev),surface.getZ(vertex)-surface.getZ(prev));
   const textureDistance=Math.hypot(flow.getX(vertex)-flow.getX(centerVertex),flow.getY(vertex)-flow.getY(centerVertex));
   assert(Math.abs(textureDistance-traveled)<.001,'native texel scale around bend and down curtain');
  }
  for(let j=0;j<columns;j++){assert.equal(index.getX(arcOffset+j*6),sharedRow[j]);assert.equal(index.getX(arcOffset+j*6+2),sharedRow[j+1]);}
  for(let z=-f.length+12;z<=0;z+=1.5){
   for(const side of [-.55,0,.55]){
    const p=waterfallWorld(f,waterfallCenter(f,z)+side*waterfallWidth(f,z)*.5,z,f.upper),bed=renderedHeight(terrain,p.x,p.z);
    const clearance=f.upper-bed;minClearance=Math.min(minClearance,clearance);assert(clearance>.08,`river terrain intersects ${f.id} at ${z}: ${clearance}`);
    assert.equal(terrain.getHeight(p.x,p.z),installed.getHeight(p.x,p.z));
    const point=terrain.getPointFast(p.x,p.z);assert(point.isWater);assert.equal(point.waterSurfaceY,f.upper);
    assert.equal(terrain.getWaterSurfaceY(p.x,p.z),f.upper);
   }
  }
  for(let i=0;i<=32;i++){
   const a=i/32*Math.PI*.5,z=f.radius*Math.sin(a),y=f.upper-f.radius*(1-Math.cos(a)),p=waterfallWorld(f,0,z,y);
   assert(y-renderedHeight(terrain,p.x,p.z)>.08,'arc clearance on rendered chunk triangles');
  }
  for(let y=.2;y<f.upper-f.radius;y+=.5){
   const t=(f.upper-f.radius-y)/(f.upper-f.radius+.35),z=f.radius+.18*t*t;
   for(const side of [-.65,0,.65]){const p=waterfallWorld(f,side*f.width*.5,z,y);assert(y-renderedHeight(terrain,p.x,p.z)>.08,'curtain core clearance');}
   for(const side of [-1,1]){const p=waterfallWorld(f,side*f.width*.5*1.14*(1+.03*t),z,y);assert(terrain.getHeight(p.x,p.z)>y+.05,`lateral curtain overlap ${f.id} at ${y}`);}
  }
  const p=waterfallWorld(f,0,f.radius+1,0);assert(renderedHeight(terrain,p.x,p.z)<-.1,'receiving pool has a submerged bed');
  for(const n of geometry.attributes.position.array)assert(Number.isFinite(n));geometry.dispose();
 }
}
assert(total>0,'procedural waterfalls generated');console.log(JSON.stringify({valid:true,waterfalls:total,minClearance}));
