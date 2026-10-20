import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

/** A stone gateway with two open battlement terraces and a continuous arched passage. */
export function gate(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.025),h=a.value(p.height,.025),u=h/6;
 const span=Math.min(w*.36,h*.70),tw=(w-span)/2,depth=Math.min(tw*1.10,Math.max(tw*.85,p.depth*.65));
 const front=-depth/2,spring=h*.33,r=span/2,walkY=Math.max(h*.75,spring+r+.38*u),wallDepth=Math.min(depth,1.5*u);
 const stone=(at:V3,size:V3,role:string,support='ground')=>a.piece('box',at,size,'stone',role,support);
 const crown=(x:number,z:number,width:number,d:number,y:number,host:string)=>{
  const floor=stone([x,y-.10*u,z],[width,.20*u,d],'gate-crown',host);
  const nx=Math.max(2,Math.ceil(width/(.8*u))),nz=Math.max(2,Math.ceil(d/(.8*u)));
  for(let i=0;i<nx;i++)for(let j=0;j<nz;j++)stone([x-width/2+(i+.5)*width/nx,y+.04*u,z-d/2+(j+.5)*d/nz],[width/nx-.012*u,.08*u,d/nz-.012*u],'gate-paver',floor);
  const line=(length:number,fixed:number,alongX:boolean)=>{
   const count=Math.max(2,Math.round(length/(1.25*u))),step=length/count,bw=Math.min(.70*u,step*.60);
   for(let i=0;i<count;i++){
    const offset=-length/2+(i+.5)*step,xx=alongX?x+offset:fixed,zz=alongX?fixed:z+offset;
    const sill=stone([xx,y+.13*u,zz],alongX?[bw+.08*u,.18*u,.50*u]:[.50*u,.18*u,bw+.08*u],'gate-merlon-sill',floor);
    for(let tier=0;tier<2;tier++)stone([xx,y+.22*u+(tier+.5)*.30*u,zz],alongX?[bw,.30*u-.01*u,.44*u]:[.44*u,.30*u-.01*u,bw],'gate-merlon',sill);
   }
  };
  for(const side of [-1,1])line(width, z+side*(d/2-.22*u),true);
  for(const side of [-1,1])line(d-.85*u,x+side*(width/2-.22*u),false);
 };
 for(const side of [-1,1]){
  const x=side*(span/2+tw/2),v=a.building(x,0,tw,depth,h-.18*u,1,{base:.18*u,material:'stone',roof:'flat',door:false,role:'gatehouse'});
  // Narrow shuttered windows on the outer walls, rather than across the gate.
  a.plan.openings=a.plan.openings.filter(o=>!o.wall.startsWith(v.id+'_'));
  for(const level of [.25,.62])a.plan.openings.push({id:v.id+'_window_'+level,wall:v.id+'_wall_'+(side>0?1:3),kind:'window',offset:0,width:Math.min(.70*u,depth*.22),bottom:h*level,height:1.0*u,shutterAngles:[0,0]});
  const roof=a.plan.roofs.find(r=>r.volume===v.id)!;roof.material='stone';roof.eaves=0;roof.plainEdge=true;roof.flatThickness=.12*u;
  const foundation=a.plan.pieces.find(piece=>piece.role==='foundation'&&Math.abs(piece.position[0]-x)<.001)!.id;
  for(const piece of a.plan.pieces)if(piece.support===foundation&&['corner-post','wall-frame','floor'].includes(piece.role))piece.removed=true;
  // A projecting cornice remains attached to the wall below the terrace.
  stone([x,h-.19*u,0],[tw+.40*u,.38*u,depth+.40*u],'gate-cornice',foundation);
  crown(x,0,tw+.40*u,depth+.40*u,h+.12*u,roof.id);
  for(const dx of [-1,1])for(const dz of [-1,1]){
   const xx=x+dx*(tw/2-.13*u),zz=dz*(depth/2+.035*u);
   let host=stone([xx,.24*u,zz],[.78*u,.48*u,.66*u],'gate-buttress-foot',foundation);
   const count=Math.max(3,Math.ceil((h-.68*u)/(.60*u))),ch=(h-.68*u)/count;
   for(let i=0;i<count;i++)host=stone([xx,.48*u+(i+.5)*ch,zz],[.51*u,ch-.01*u,.45*u],'gate-buttress',host);
   if(p.vegetation>.02&&a.rnd()<.78)a.piece('cloth',[xx+(a.rnd()-.5)*.17*u,h-.27*u,zz+dz*.245*u],[.32*u,h*(.25+a.rnd()*.37)*p.vegetation,.20*u],'cloth','gate-ivy',host,[0,dz<0?Math.PI:0,0]);
  }
 }
 const wall=stone([0,0,front+wallDepth/2],[span,walkY,wallDepth],'gate-arched-wall');
 a.plan.pieces.find(p=>p.id===wall)!.end=[spring,r,0];
 crown(0,front+wallDepth/2,span,wallDepth,walkY,wall);
 // Individual arch stones share the same centre and radius as the opening.
 for(const z of [front-.10*u,front+wallDepth+.10*u]){
  for(let i=0;i<13;i++)a.piece('arch',[0,spring,z],[r+.20*u,.40*u,.27*u],'stone','gate-arch-stone',wall,[0,0,(i+.5)*Math.PI/13]);
  for(const side of [-1,1]){
   const count=Math.max(3,Math.ceil(spring/(.55*u))),ch=spring/count;
   for(let i=0;i<count;i++)stone([side*(r+.20*u),(i+.5)*ch,z],[.40*u,ch-.012*u,.27*u],'gate-jamb',wall);
  }
 }
 const doorZ=front+.24*u,doorRadius=r-.045*u,planks=Math.max(10,Math.ceil(span/(.26*u))),pw=2*doorRadius/planks;
 for(let i=0;i<planks;i++){
  const left=-doorRadius+i*pw+.006*u,right=left+pw-.012*u;
  const id=a.piece('box',[(left+right)/2,0,doorZ],[right-left,spring,.16*u],'wood','gate-door-plank',wall);
  a.plan.pieces.find(p=>p.id===id)!.end=[doorRadius,spring,0];
 }
 for(const side of [-1,1]){
  for(const yy of [spring*.22,spring*.86]){
   const strap=a.piece('box',[side*r*.49,yy,doorZ-.12*u],[r*.86,.13*u,.07*u],'metal','gate-door-strap',wall);
   for(const fraction of [-.34,0,.34])a.piece('box',[side*r*.49+fraction*r,yy,doorZ-.167*u],[.055*u,.055*u,.025*u],'metal','gate-rivet',strap);
  }
  a.piece('wheel',[side*.24*u,spring*.56,doorZ-.16*u],[.27*u,.32*u,.045*u],'metal','gate-door-ring',wall);
 }
 for(const side of [-1,1])a.plan.propZones.push({id:'gate-garden-'+side,x:side*(span/2+tw/2),z:front-.55*u,width:tw,depth:1.0*u,y:0,kind:'garden'});
 return a.finish();
}
