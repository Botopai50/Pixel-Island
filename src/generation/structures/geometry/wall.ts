import type {PieceSpec} from '../types';
import {buildAncientPiece} from './ancientRuins';
import * as THREE from 'three';

export function buildCurtainWallPiece(p:PieceSpec){
 if(p.role==='wall-stair-block'){
  const [run,height,width]=p.size,unit=height/5.12,steps=Math.max(7,Math.ceil(height/(.28*unit))),rise=height/steps,tread=run/steps,shape=new THREE.Shape();
  shape.moveTo(0,0);shape.lineTo(run,0);shape.lineTo(run,rise);
  for(let i=0;i<steps;i++){const x=run-(i+1)*tread;shape.lineTo(x,(i+1)*rise);if(i<steps-1)shape.lineTo(x,(i+2)*rise);}
  shape.lineTo(0,0);shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:width,bevelEnabled:false,steps:1});
  g.translate(p.position[0]-run/2,p.position[1]-height/2,p.position[2]-width/2);return g;
 }
 if(p.role==='wall-ivy')return buildAncientPiece({...p,role:'ancient-ivy'});
 if(p.material==='stone'&&p.role!=='muralha'&&p.kind==='box')return buildAncientPiece({...p,role:'ancient-masonry'});
}
