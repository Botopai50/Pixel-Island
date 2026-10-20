import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

/**
 * A square masonry tower for the corners and gates of a curtain wall: a tall
 * body laid in courses, quoins of alternating long and short stones at the
 * corners, a stepped plinth, a corbelled gallery carrying a chunky crenellated
 * parapet around a plank deck, and shuttered windows in stone frames.
 * Every stone piece uses a non-plain role, so the ancient masonry generator
 * cuts each course into blocks.
 */
export function stoneTower(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.025),d=a.value(p.depth,.025),h=a.value(p.height,.025),u=Math.max(.85,Math.min(1.5,h/9));
 const stone=(at:V3,size:V3,role:string,support='ground',rot?:V3)=>a.piece('box',at,size,'stone',role,support,rot);

 // ---- plinth: two stepped courses ---------------------------------------------
 const foot=stone([0,.25*u,0],[w+.72*u,.5*u,d+.72*u],'wall-buttress-foot');
 const step=stone([0,.5*u+.2*u,0],[w+.36*u,.4*u,d+.36*u],'wall-buttress-foot',foot);

 // ---- body, course by course -----------------------------------------------------
 const base=.9*u,bodyH=h-base-.95*u,count=Math.max(6,Math.round(bodyH/(.62*u))),course=bodyH/count;
 let below=step;
 for(let j=0;j<count;j++)below=stone([0,base+(j+.5)*course,0],[w,course-.01*u,d],'wall-buttress-block',below);
 const bodyTop=base+bodyH;

 // ---- quoins: long and short stones alternating up each corner ------------------------
 for(const sx of [-1,1])for(const sz of [-1,1]){
  let support=step;
  for(let j=0;j<count;j++){
   const longX=j%2===0,qx=longX?1.18*u:.66*u,qz=longX?.66*u:1.18*u,out=.13*u;
   support=stone([sx*(w/2-qx/2+out),base+(j+.5)*course,sz*(d/2-qz/2+out)],[qx,course-.012*u,qz],'wall-buttress-block',support);
  }
 }

 // ---- corbelled gallery ---------------------------------------------------------------------
 const band=stone([0,bodyTop+.22*u,0],[w+.7*u,.44*u,d+.7*u],'wall-cornice',below);
 const corbelH=.62*u;
 const along=(length:number,spacing:number)=>{const n=Math.max(2,Math.round(length/spacing));return Array.from({length:n},(_,i)=>-length/2+(i+.5)*length/n);};
 for(const x of along(w-1.6*u,1.35*u))for(const side of [-1,1])stone([x,bodyTop-corbelH/2+.05*u,side*(d/2+.2*u)],[.5*u,corbelH,.5*u],'wall-buttress-block',below);
 for(const z of along(d-1.6*u,1.35*u))for(const side of [-1,1])stone([side*(w/2+.2*u),bodyTop-corbelH/2+.05*u,z],[.5*u,corbelH,.5*u],'wall-buttress-block',below);

 // ---- platform: stone rim, plank deck, chunky parapet ------------------------------------------
 const rimW=w+.7*u,rimD=d+.7*u,rimY=bodyTop+.44*u;
 const rim=stone([0,rimY+.12*u,0],[rimW,.24*u,rimD],'walkway',band);
 // the plank deck sits on the rim, its top clear of it, so the two surfaces never share a plane
 const topY=rimY+.24*u;
 a.piece('box',[0,topY+.06*u,0],[w-.45*u,.12*u,d-.45*u],'wood','observation',rim);
 const parapetX=rimW/2-.28*u,parapetZ=rimD/2-.28*u;
 // low connecting wall between the merlons
 stone([0,topY+.17*u,-parapetZ],[rimW-.1*u,.34*u,.5*u],'wall-cornice',rim);
 stone([0,topY+.17*u,parapetZ],[rimW-.1*u,.34*u,.5*u],'wall-cornice',rim);
 stone([-parapetX,topY+.17*u,0],[.5*u,.34*u,rimD-.1*u],'wall-cornice',rim);
 stone([parapetX,topY+.17*u,0],[.5*u,.34*u,rimD-.1*u],'wall-cornice',rim);
 const merlon=(x:number,z:number,wx:number,wz:number)=>{
  const sill=stone([x,topY+.36*u,z],[wx+.08*u,.12*u,wz+.08*u],'wall-merlon-sill',rim);
  for(let k=0;k<2;k++)stone([x,topY+.42*u+(k+.5)*.44*u,z],[wx,.44*u-.012*u,wz],'battlement',sill);
 };
 for(const x of along(rimW-1.2*u,1.55*u))for(const side of [-1,1])merlon(x,side*parapetZ,.95*u,.7*u);
 for(const z of along(rimD-1.2*u,1.55*u))for(const side of [-1,1])merlon(side*parapetX,z,.7*u,.95*u);
 for(const sx of [-1,1])for(const sz of [-1,1])merlon(sx*parapetX,sz*parapetZ,.95*u,.95*u);

 // ---- shuttered windows in stone frames, two storeys on every face -------------------------------------
 const ww=.62*u,wh=1.2*u;
 const faces:[number,number][]=[[0,-1],[0,1],[-1,0],[1,0]];
 for(const [nx,nz] of faces){
  const zFace=nx===0,half=zFace?d/2:w/2,tx=-nz,tz=nx; // along-face axis
  const at=(s:number,y:number,o:number):V3=>[nx*(half+o)+tx*s,y,nz*(half+o)+tz*s];
  const box=(s:number,y:number,o:number,sa:number,sy:number,so:number,role:string,mat:'stone'|'wood'|'dark',support:string,rot?:V3)=>{
   const size:V3=zFace?[sa,sy,so]:[so,sy,sa];
   return a.piece('box',at(s,y,o),size,mat,role,support,rot);
  };
  for(const level of [.34,.62]){
   const y=base+bodyH*level;
   box(0,y,.012*u,ww,wh,.06*u,'tower-window-recess','dark',below);
   for(const sgn of [-1,1])box(sgn*(ww/2+.1*u),y,.07*u,.2*u,wh+.36*u,.2*u,'wall-buttress-block','stone',below);
   box(0,y+wh/2+.12*u,.07*u,ww+.62*u,.2*u,.22*u,'wall-buttress-block','stone',below);
   box(0,y-wh/2-.08*u,.1*u,ww+.62*u,.16*u,.3*u,'wall-buttress-block','stone',below);
   // shutters, hinged at the jambs and swung open
   const theta=.95,len=wh,halfLen=ww*.27;
   for(const sgn of [-1,1]){
    const hinge=sgn*(ww/2+.1*u),dirS=sgn*Math.cos(theta),dirO=Math.sin(theta);
    const cs=hinge+dirS*halfLen,co=.1*u+dirO*halfLen;
    const dx=tx*dirS+nx*dirO,dz=tz*dirS+nz*dirO;
    const phi=zFace?Math.atan2(-dz,dx):Math.atan2(dx,dz);
    box(cs,y,co,ww*.54,len,.05*u,'tower-shutter','wood',below,[0,phi,0]);
   }
  }
 }

 // ---- ivy creeping up from the ground ------------------------------------------------------------------
 if(p.vegetation>.02){
  for(let k=0;k<7;k++){
   const rnd=c.streams.streamFor('vegetation','tower-ivy-'+k);
   const [nx,nz]=faces[Math.floor(rnd()*4)],zFace=nx===0,half=zFace?d/2:w/2,span=(zFace?w:d)*.36,s=(rnd()-.5)*2*span;
   const length=h*(.25+rnd()*.5)*(.65+p.vegetation),start=Math.min(h-.3*u,length+.5*u);
   a.piece('cloth',[nx*(half+.34*u)+(-nz)*s,start,nz*(half+.34*u)+nx*s],[(.24+rnd()*.22)*u,Math.min(length,start-.2*u),.3*u],'cloth','wall-ivy',below,[0,zFace?(nz<0?Math.PI:0):(nx<0?-Math.PI/2:Math.PI/2),0]);
  }
 }
 return a.finish();
}
