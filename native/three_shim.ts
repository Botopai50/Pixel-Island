export class Vector3 {
  x:number; y:number; z:number;
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x:number,y:number,z:number){this.x=x;this.y=y;this.z=z;return this;}
  copy(v:Vector3){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z);}
  normalize(){const l=this.length()||1;this.x/=l;this.y/=l;this.z/=l;return this;}
}

export class Color {
  r=1;g=1;b=1;
  constructor(v:number|string=0xffffff){this.set(v);}
  set(v:number|string){
    let n:number;
    if(typeof v==='string') n=parseInt(v.replace('#',''),16);
    else n=v;
    this.r=((n>>16)&255)/255;this.g=((n>>8)&255)/255;this.b=(n&255)/255;
    return this;
  }
  multiplyScalar(s:number){this.r*=s;this.g*=s;this.b*=s;return this;}
  clone(){const c=new Color();c.r=this.r;c.g=this.g;c.b=this.b;return c;}
}

export class Quaternion {
  x=0;y=0;z=0;w=1;
  set(x:number,y:number,z:number,w:number){this.x=x;this.y=y;this.z=z;this.w=w;return this;}
  copy(q:Quaternion){this.x=q.x;this.y=q.y;this.z=q.z;this.w=q.w;return this;}
  clone(){return new Quaternion().copy(this);}
  setFromAxisAngle(axis:Vector3,angle:number){
    const h=angle/2,s=Math.sin(h);this.x=axis.x*s;this.y=axis.y*s;this.z=axis.z*s;this.w=Math.cos(h);return this;
  }
  setFromEuler(x:number,y:number,z:number){
    const c1=Math.cos(x/2),c2=Math.cos(y/2),c3=Math.cos(z/2);
    const s1=Math.sin(x/2),s2=Math.sin(y/2),s3=Math.sin(z/2);
    // THREE Euler default order XYZ
    this.x=s1*c2*c3+c1*s2*s3;
    this.y=c1*s2*c3-s1*c2*s3;
    this.z=c1*c2*s3+s1*s2*c3;
    this.w=c1*c2*c3-s1*s2*s3;
    return this;
  }
  multiply(q:Quaternion){
    const qax=this.x,qay=this.y,qaz=this.z,qaw=this.w;
    const qbx=q.x,qby=q.y,qbz=q.z,qbw=q.w;
    this.x=qax*qbw+qaw*qbx+qay*qbz-qaz*qby;
    this.y=qay*qbw+qaw*qby+qaz*qbx-qax*qbz;
    this.z=qaz*qbw+qaw*qbz+qax*qby-qay*qbx;
    this.w=qaw*qbw-qax*qbx-qay*qby-qaz*qbz;
    return this;
  }
  setFromUnitVectors(vFrom:Vector3,vTo:Vector3){
    let r=vFrom.x*vTo.x+vFrom.y*vTo.y+vFrom.z*vTo.z+1;
    if(r<Number.EPSILON){
      r=0;
      if(Math.abs(vFrom.x)>Math.abs(vFrom.z)){this.set(-vFrom.y,vFrom.x,0,r);}
      else this.set(0,-vFrom.z,vFrom.y,r);
    }else{
      this.set(
        vFrom.y*vTo.z-vFrom.z*vTo.y,
        vFrom.z*vTo.x-vFrom.x*vTo.z,
        vFrom.x*vTo.y-vFrom.y*vTo.x,
        r
      );
    }
    const l=Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)||1;
    this.x/=l;this.y/=l;this.z/=l;this.w/=l;return this;
  }
}

export class Matrix4 {
  elements:number[]=new Array(16).fill(0);
  constructor(){this.identity();}
  identity(){const e=this.elements;e.fill(0);e[0]=e[5]=e[10]=e[15]=1;return this;}
  clone(){const m=new Matrix4();m.elements=this.elements.slice();return m;}
  compose(p:Vector3,q:Quaternion,s:Vector3){
    const e=this.elements;
    const x=q.x,y=q.y,z=q.z,w=q.w;
    const x2=x+x,y2=y+y,z2=z+z;
    const xx=x*x2,xy=x*y2,xz=x*z2;
    const yy=y*y2,yz=y*z2,zz=z*z2;
    const wx=w*x2,wy=w*y2,wz=w*z2;
    const sx=s.x,sy=s.y,sz=s.z;
    e[0]=(1-(yy+zz))*sx;e[1]=(xy+wz)*sx;e[2]=(xz-wy)*sx;e[3]=0;
    e[4]=(xy-wz)*sy;e[5]=(1-(xx+zz))*sy;e[6]=(yz+wx)*sy;e[7]=0;
    e[8]=(xz+wy)*sz;e[9]=(yz-wx)*sz;e[10]=(1-(xx+yy))*sz;e[11]=0;
    e[12]=p.x;e[13]=p.y;e[14]=p.z;e[15]=1;
    return this;
  }
}

class Euler {
  x=0;y=0;z=0;
  constructor(private owner:Object3D){}
  set(x:number,y:number,z:number){this.x=x;this.y=y;this.z=z;this.owner.quaternion.setFromEuler(x,y,z);return this;}
}

export class Object3D {
  position=new Vector3();
  scale=new Vector3(1,1,1);
  quaternion=new Quaternion();
  rotation:Euler;
  matrix=new Matrix4();
  constructor(){this.rotation=new Euler(this);}
  updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);}
}
