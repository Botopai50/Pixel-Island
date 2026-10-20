import * as THREE from 'three';
import type {PieceSpec} from '../types';
import {extrudePolygon} from './common';
import {buildAncientPiece} from './ancientRuins';

export function buildGatePiece(p:PieceSpec){
 if(p.role==='gate-ivy')return buildAncientPiece({...p,role:'ancient-ivy'});
 if(p.role==='gate-arch-stone')return buildAncientPiece({...p,role:'ancient-arch-wedge'});
 if(p.role==='gate-door-ring'){
  const g=new THREE.TorusGeometry(p.size[0]/2,.027*p.size[0]/.27,4,10);g.scale(1,p.size[1]/p.size[0],1);g.translate(...p.position);return g;
 }
 if(p.role==='gate-arched-wall'){
  const spring=p.end![0],r=p.end![1],points:[number,number][]=[[-r,p.size[1]],[r,p.size[1]],[r,spring]];
  for(let i=1;i<=24;i++)points.push([r*Math.cos(i*Math.PI/24),spring+r*Math.sin(i*Math.PI/24)]);
  const g=extrudePolygon(points,p.size[2]);g.translate(...p.position);return g;
 }
 if(p.role==='gate-door-plank'){
  const left=p.position[0]-p.size[0]/2,right=p.position[0]+p.size[0]/2,r=p.end![0],spring=p.end![1];
  const points:[number,number][]=[[left,.025],[right,.025]];
  for(let i=0;i<=4;i++){const x=right-(right-left)*i/4;points.push([x,spring+Math.sqrt(Math.max(0,r*r-x*x))-.025]);}
  const g=extrudePolygon(points,p.size[2]);g.translate(0,0,p.position[2]);return g;
 }
 if(p.role.startsWith('gate-')&&p.material==='stone'&&p.kind==='box')return buildAncientPiece({...p,role:'ancient-masonry'});
}
