/** Full belly with distinctly narrower ends, matching a coopered barrel. */
export const BARREL_PROFILE=[
 [0,.80],[.12,.92],[.28,1.04],[.50,1.10],
 [.72,1.04],[.88,.97],[1,.90],
] as const;

export function barrelRadiusAt(t:number){
 t=Math.max(0,Math.min(1,t));
 for(let i=1;i<BARREL_PROFILE.length;i++){
  const [y,r]=BARREL_PROFILE[i], [previousY,previousR]=BARREL_PROFILE[i-1];
  if(t<=y)return previousR+(r-previousR)*(t-previousY)/(y-previousY);
 }
 return BARREL_PROFILE.at(-1)![1];
}
