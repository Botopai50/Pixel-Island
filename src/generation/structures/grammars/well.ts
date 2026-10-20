import {Architect} from '../blueprint';import type {GrammarContext,V3,SurfaceMaterial} from '../types';

export function stoneWell(c:GrammarContext){
 const a=new Architect(c),p=c.config,h=p.height,u=h/2.3,r=Math.min(p.width,p.depth)*.44,inner=r*.68,wallH=h*.37;
 const box=(at:V3,size:V3,mat:SurfaceMaterial,role:string,support='ground',rotation?:V3)=>a.piece('box',at,size,mat,role,support,rotation);
 const core=a.piece('column',[0,wallH/2,0],[(r-.018*u)*2,wallH,(inner+.016*u)*2],'stone','well-core');
 for(let row=0;row<3;row++)for(let i=0;i<12;i++)a.piece('column',[0,(row+.5)*wallH/3,0],[r*2,wallH/3-.01*u,inner*2],'stone','well-stone-block',core,[0,(i+(row%2)*.5)*Math.PI/6,0]);
 for(let i=0;i<12;i++)a.piece('column',[0,wallH+.05*u,0],[(r+.04*u)*2,.10*u,inner*2],'stone','well-stone-block',core,[0,i*Math.PI/6,0]);
 a.piece('column',[0,.025*u,0],[inner*1.97,.02*u,inner*1.97],'dark','scenery-basin-water',core);
 const roofW=r*2+.76*u,roofD=r*2+.42*u,rise=h*.25,eave=h-rise,angle=Math.atan2(rise,roofW/2),postX=r*.80;
 const postTop=h+.12*u,postBottom=wallH-.14*u,slopeLength=Math.hypot(roofW/2,rise);
 const posts:string[]=[];
 for(const side of [-1,1]){
  const post=box([side*postX,(postBottom+postTop)/2,0],[.24*u,postTop-postBottom,.26*u],'wood','well-post',core);posts.push(post);
  box([side*postX,postTop+.025*u,0],[.29*u,.07*u,.31*u],'wood','well-post-cap',post);
  for(const yy of [wallH+.10*u,wallH+.29*u]){
   box([side*postX,yy,0],[.262*u,.095*u,.282*u],'metal','well-post-band',post);
   for(const face of [-1,1])box([side*postX,yy,face*.159*u],[.045*u,.045*u,.035*u],'metal','well-post-bolt',post);
  }
  box([side*postX,eave+.12*u,0],[.14*u,.14*u,roofW*.72],'wood','well-header',post);
  for(const end of [-1,1])a.beam([side*postX,eave-.15*u,0],[side*postX,eave+.12*u,end*roofW*.24],.13*u,'wood','well-header-brace',post,{start:[0,0,1],end:[0,1,0]});
 }
 for(const side of [-1,1]){
  box([0,eave+rise/2-.045*u,side*roofW/4],[roofD,.06*u,slopeLength],'wood','well-roof-underlay',posts[0],[side*angle,0,0]);
  const across=Math.max(3,Math.ceil(roofD/(.60*u))),rows=4;
  for(let row=0;row<rows;row++)for(let i=0;i<across;i++){
   const t=(row+.5)/rows;
   box([-roofD/2+(i+.5)*roofD/across,eave+rise*(1-t),side*roofW/2*t],[roofD/across,.07*u,slopeLength/rows],'wood','well-roof-board',posts[0],[side*angle,0,0]);
  }
  for(const end of [-1,1]){
   a.beam([end*roofD/2,eave,side*roofW/2],[end*roofD/2,h,0],.13*u,'wood','well-roof-frame',posts[end===-1?0:1]);
   for(const t of [.12,.88]){
    const clip=box([end*roofD/2,eave+rise*(1-t)+.085*u,side*roofW/2*t],[.18*u,.035*u,.20*u],'metal','well-roof-clip',posts[0],[side*angle,0,0]);
    box([end*roofD/2,eave+rise*(1-t)+.105*u,side*roofW/2*t],[.04*u,.025*u,.04*u],'metal','well-roof-rivet',clip);
   }
  }
 }
 box([0,h+.025*u,0],[roofD+.13*u,.16*u,.16*u],'wood','well-ridge',posts[0]);
 const spindleY=wallH+.42*u;
 const spindle=a.piece('column',[0,spindleY,0],[.20*u,postX*2+.40*u,.20*u],'wood','well-spindle',posts[0]);
 a.piece('column',[0,spindleY,0],[.40*u,.245*u,.026*u],'cloth','well-rope-coil',spindle);
 for(const side of [-1,1])box([side*(postX+.13*u),spindleY,0],[.04*u,.23*u,.19*u],'metal','well-bearing',posts[side===-1?0:1]);
 const crankX=postX+.19*u;
 box([crankX,spindleY-.10*u,0],[.055*u,.25*u,.07*u],'metal','well-crank',spindle);
 a.piece('column',[crankX+.065*u,spindleY-.21*u,0],[.07*u,.16*u,.07*u],'wood','well-crank-grip',spindle);
 const bucketY=wallH*.71,bucketH=.29*u;
 const bucket=a.piece('column',[0,bucketY,0],[.34*u,bucketH,.34*u],'wood','well-bucket',core);
 for(const side of [-1,1])a.piece('column',[0,bucketY+side*bucketH*.30,0],[.34*u*(side===-1?.80:.96),.023*u,.34*u],'metal','well-bucket-hoop',bucket);
 const ropeBottom=bucketY+bucketH/2,ropeTop=spindleY-.122*u;
 a.piece('column',[0,(ropeBottom+ropeTop)/2,0],[.021*u,ropeTop-ropeBottom,.021*u],'cloth','well-rope',spindle);
 return a.finish();
}
