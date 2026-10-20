import {extrudePolygon} from './common';
export function buildFloor(contour:[number,number][],elevation:number,thickness:number){const g=extrudePolygon(contour,thickness);g.rotateX(-Math.PI/2);g.translate(0,elevation,0);return g;}
