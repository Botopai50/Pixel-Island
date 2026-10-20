import type {JointSpec,StructurePlan} from '../types';
/** End planes belong to a single joint; adjacent members terminate at its contact plane. */
export function resolveJoint(joint:JointSpec,plan:StructurePlan){return {point:joint.point,members:joint.members.map(id=>plan.pieces.find(p=>p.id===id)!).filter(Boolean)};}
