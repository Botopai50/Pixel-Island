export const PROVISION_PROFILE=[
 [0,.78],[.035,.93],[.10,1.02],[.22,1.04],[.34,.97],
 [.46,.78],[.56,.59],[.65,.43],[.715,.31],
 [.755,.27],[.79,.25],
] as const;
export const PROVISION_SEAMS=[1.93,3.17,5.55] as const;
export function provisionRadiusAt(t:number){
 for(let i=1;i<PROVISION_PROFILE.length;i++){const [y,r]=PROVISION_PROFILE[i],[py,pr]=PROVISION_PROFILE[i-1];if(t<=y)return pr+(r-pr)*(t-py)/(y-py);}
 return .25;
}
export function provisionFoldAt(t:number,angle:number){
 const turn=Math.PI*2,a=((angle%turn)+turn)%turn;
 let start:number=PROVISION_SEAMS.at(-1)!-turn,end:number=PROVISION_SEAMS[0];
 for(let i=0;i<PROVISION_SEAMS.length;i++){
  const left=PROVISION_SEAMS[i],right=PROVISION_SEAMS[(i+1)%PROVISION_SEAMS.length]+(i===PROVISION_SEAMS.length-1?turn:0);
  if(a>=left&&a<=right){start=left;end=right;break;}
 }
 const along=(a-start)/(end-start),panel=Math.pow(Math.max(0,Math.sin(along*Math.PI)),.85);
 const height=Math.max(0,Math.min(1,t/.79));
 const weight=.30*Math.sin(Math.pow(height,.65)*Math.PI);
 // Sewn boundaries stay at the tension profile; only the cloth between them expands.
 return 1+weight*panel;
}
