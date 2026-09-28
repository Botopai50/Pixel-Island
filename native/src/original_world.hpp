#pragma once
#include <array>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

namespace original {

constexpr double PI = 3.1415926535897932384626433832795;
constexpr double SEA_LEVEL = 0.0;
constexpr double BEACH_HEIGHT = 3.8;
constexpr double MAX_HEIGHT = 160.0;
constexpr double OCEAN_FLOOR = -40.0;
constexpr double ISLAND_GRID_SIZE = 3200.0;
constexpr double ISLAND_BASE_RADIUS = 1400.0;

inline double clamp(double x,double mn,double mx){return x<mn?mn:(x>mx?mx:x);}
inline double lerp(double a,double b,double t){return a+(b-a)*t;}
inline double smoothstep(double mn,double mx,double x){
    const double t=clamp((x-mn)/(mx-mn),0.0,1.0);
    return t*t*(3.0-2.0*t);
}
inline uint32_t imul(uint32_t a,uint32_t b){return static_cast<uint32_t>(static_cast<uint64_t>(a)*static_cast<uint64_t>(b));}

class PRNG {
public:
    explicit PRNG(uint32_t seed=1337u):state_(seed?seed:1u){}
    explicit PRNG(double seed):PRNG(static_cast<uint32_t>(seed)){}
    static uint32_t hashString(const std::string& str){
        uint32_t hash=2166136261u;
        for(unsigned char ch: str){hash^=ch;hash=imul(hash,16777619u);}
        return hash;
    }
    static double hash2D(int32_t x,int32_t y,uint32_t seed=0u){
        uint32_t h=seed + imul(static_cast<uint32_t>(x),374761393u)+imul(static_cast<uint32_t>(y),668265263u);
        h=imul(h^(h>>13),1274126177u);
        return static_cast<double>((h^(h>>16))) / 4294967296.0;
    }
    double next(){
        uint32_t t=(state_ += 0x6d2b79f5u);
        t=imul(t^(t>>15),t|1u);
        t ^= t + imul(t^(t>>7),t|61u);
        return static_cast<double>(t^(t>>14))/4294967296.0;
    }
    double range(double mn,double mx){return mn+next()*(mx-mn);}
private: uint32_t state_;
};

class SimplexNoise {
public:
    explicit SimplexNoise(uint32_t seed=0u){reseed(seed);}
    void reseed(uint32_t seed){
        PRNG prng(seed); std::array<uint8_t,256> p{};
        for(int i=0;i<256;i++)p[i]=static_cast<uint8_t>(i);
        for(int i=255;i>0;i--){int j=static_cast<int>(std::floor(prng.next()*(i+1)));std::swap(p[i],p[j]);}
        for(int i=0;i<512;i++){perm_[i]=p[i&255];mod12_[i]=static_cast<uint8_t>(perm_[i]%12);}
    }
    double noise2D(double xin,double yin) const {
        static constexpr int G[12][3]={
            {1,1,0},{-1,1,0},{1,-1,0},{-1,-1,0},{1,0,1},{-1,0,1},
            {1,0,-1},{-1,0,-1},{0,1,1},{0,-1,1},{0,1,-1},{0,-1,-1}};
        static const double F2=0.5*(std::sqrt(3.0)-1.0);
        static const double G2=(3.0-std::sqrt(3.0))/6.0;
        double n0=0,n1=0,n2=0;
        const double s=(xin+yin)*F2;
        const int i=static_cast<int>(std::floor(xin+s)),j=static_cast<int>(std::floor(yin+s));
        const double t=(i+j)*G2,X0=i-t,Y0=j-t,x0=xin-X0,y0=yin-Y0;
        const int i1=x0>y0?1:0,j1=x0>y0?0:1;
        const double x1=x0-i1+G2,y1=y0-j1+G2,x2=x0-1.0+2.0*G2,y2=y0-1.0+2.0*G2;
        const int ii=i&255,jj=j&255;
        const int gi0=mod12_[ii+perm_[jj]],gi1=mod12_[ii+i1+perm_[jj+j1]],gi2=mod12_[ii+1+perm_[jj+1]];
        double q=0.5-x0*x0-y0*y0;if(q>0){q*=q;n0=q*q*(G[gi0][0]*x0+G[gi0][1]*y0);}
        q=0.5-x1*x1-y1*y1;if(q>0){q*=q;n1=q*q*(G[gi1][0]*x1+G[gi1][1]*y1);}
        q=0.5-x2*x2-y2*y2;if(q>0){q*=q;n2=q*q*(G[gi2][0]*x2+G[gi2][1]*y2);}
        return 70.0*(n0+n1+n2);
    }
    double fbm2D(double x,double y,int oct=6,double persistence=0.5,double lac=2.0) const {
        double total=0,f=1,a=1,maxv=0;
        for(int i=0;i<oct;i++){total+=noise2D(x*f,y*f)*a;maxv+=a;a*=persistence;f*=lac;}
        return total/maxv;
    }
    double ridgedFBM(double x,double y,int oct=5,double lac=2.0,double gain=0.5) const {
        double total=0,f=1,a=1,weight=1;
        for(int i=0;i<oct;i++){
            double n=noise2D(x*f,y*f);
            double signal=1.0-std::sqrt(n*n+0.035);
            signal=std::max(0.0,signal); signal*=signal; signal*=weight;
            weight=clamp(signal*2.0,0.0,1.0);
            total+=signal*a; f*=lac; a*=gain;
        }
        return total;
    }
private:
    std::array<uint8_t,512> perm_{},mod12_{};
};

struct IslandCenter{double x,z,radius,elongation,rotation;};

class MacroGeography {
public:
    explicit MacroGeography(uint32_t seed):noise_(seed),seed_(seed){}
    IslandCenter getIslandForCell(int cellX,int cellZ) const {
        double cellHash=PRNG::hash2D(cellX,cellZ,seed_^0x9e3779b9u);
        PRNG prng(cellHash*100000.0);
        double baseSpacing=ISLAND_GRID_SIZE*1.5;
        double jitterX=prng.range(-baseSpacing*0.22,baseSpacing*0.22);
        double jitterZ=prng.range(-baseSpacing*0.22,baseSpacing*0.22);
        double centerX=cellX*baseSpacing+jitterX,centerZ=cellZ*baseSpacing+jitterZ;
        double radius=prng.range(ISLAND_BASE_RADIUS*1.8,ISLAND_BASE_RADIUS*2.8);
        return {centerX,centerZ,radius,prng.range(1.2,1.9),prng.range(0,PI*2)};
    }
    struct Mask{double landFactor,coastDist,spineFactor;IslandCenter nearestIsland;};
    Mask getLandmassMask(double x,double z) const {
        const double f1=0.00015,f2=0.00042;
        const double wx=noise_.noise2D(x*f1,z*f1)*750.0+noise_.noise2D(x*f2+31,z*f2+67)*260.0;
        const double wz=noise_.noise2D(x*f1+59,z*f1+83)*750.0+noise_.noise2D(x*f2+71,z*f2+97)*260.0;
        const double qx=x+wx,qz=z+wz;
        const double continent=noise_.fbm2D(qx*0.00014,qz*0.00014,4,0.52,2.05);
        const double straitNoise=std::abs(noise_.noise2D(qx*0.00035+110,qz*0.00035+230));
        const double straitCut=smoothstep(0.03,0.22,straitNoise);
        const double raw=(continent*1.35+0.18)*lerp(0.60,1.0,straitCut);
        const double coastDetail=noise_.fbm2D(qx*0.00095,qz*0.00095,3,0.45,2.1)*0.10;
        const double envelope=smoothstep(0.18,0.01,std::abs(raw));
        const double continentalness=raw+coastDetail*envelope;
        const double b1=noise_.ridgedFBM(qx*0.00042+44,qz*0.00042+88,4,2.05,0.55);
        const double b2=noise_.ridgedFBM(qx*0.00026-62,qz*0.00026-120,3,2.1,0.50);
        const double spine=std::max(b1*0.92,b2*0.78);
        const double inland=smoothstep(0.04,0.28,continentalness);
        const double spineFactor=clamp(spine*inland*1.45,0.0,1.0);
        const double coastDist=continentalness*420.0;
        const double landFactor=smoothstep(-0.06,0.22,continentalness);
        const int cx=static_cast<int>(std::round(x/ISLAND_GRID_SIZE)),cz=static_cast<int>(std::round(z/ISLAND_GRID_SIZE));
        return {landFactor,coastDist,spineFactor,getIslandForCell(cx,cz)};
    }
    double getMacroRelief(double x,double z,double spineFactor,double landFactor) const {
        if(landFactor<=0.001)return 0;
        const double ridge=noise_.ridgedFBM(x*0.0014,z*0.0014,3,2.0,0.46);
        const double mountain=(spineFactor*96.0)*(0.38+0.62*ridge);
        const double valley=noise_.fbm2D(x*0.0012+44,z*0.0012+92,3);
        const double cut=smoothstep(-0.30,0.35,valley);
        const double plateau=noise_.fbm2D(x*0.00065+71,z*0.00065+13,3);
        const double hills=noise_.fbm2D(x*0.0035,z*0.0035,4,0.48,2.0);
        return (mountain*cut+smoothstep(0.08,0.55,plateau)*24.0+hills*12.0)*landFactor;
    }
private: SimplexNoise noise_; uint32_t seed_;
};

struct VolcanoCenter{double x,z,baseRadius,peakHeight,calderaRadius,calderaDepth,lavaLevel;};
struct VolcanoResult{double heightOffset,influence;bool isCaldera,isLava;double lavaLevel,ashFactor;};

class VolcanoGenerator {
public:
    VolcanoGenerator(uint32_t seed,const MacroGeography& macro):noise_(seed^0x5a1b3c7du),seed_(seed),macro_(macro){init();}
    const std::vector<VolcanoCenter>& getVolcanoes()const{return volcanoes_;}
    VolcanoResult query(double x,double z) const {
        double maxInfluence=0,best=0,lavaLevel=0,ash=0;bool caldera=false,lava=false;
        for(const auto& v:volcanoes_){
            double dx=x-v.x,dz=z-v.z,d=std::sqrt(dx*dx+dz*dz);
            if(d<v.baseRadius){
                double norm=d/v.baseRadius,infl=std::pow(1.0-norm,1.2);
                if(infl>maxInfluence){
                    maxInfluence=infl;lavaLevel=v.lavaLevel;
                    double cone=0;caldera=false;lava=false;
                    if(d>=v.calderaRadius){
                        double u=(v.baseRadius-d)/(v.baseRadius-v.calderaRadius);
                        double factor=(std::exp(u*1.8)-1.0)/(std::exp(1.8)-1.0);
                        double ridge=std::pow(std::abs(noise_.noise2D(dx*0.035,dz*0.035)),1.3)*16.0*u;
                        cone=v.peakHeight*factor+ridge;
                    }else{
                        caldera=true;double inner=d/v.calderaRadius;
                        if(inner>0.82){
                            double wt=(inner-0.82)/0.18;
                            cone=(v.lavaLevel-2)+(v.peakHeight-(v.lavaLevel-2))*std::pow(wt,1.8);
                        }else cone=(v.lavaLevel-5)+std::pow(inner/0.82,2.0)*3.0;
                        if(cone<=v.lavaLevel)lava=true;
                    }
                    best=cone;ash=clamp(std::pow(1.0-norm,1.1)*1.8,0.0,1.0);
                }
            }
        }
        return {best,maxInfluence,caldera,lava,lavaLevel,ash};
    }
private:
    void init(){
        PRNG p(seed_^0x5a1b3c7du);volcanoes_.clear();
        double vx=-380,vz=420,best=-9999;
        for(int attempt=0;attempt<48;attempt++){
            double angle=p.range(0,PI*2),dist=p.range(280,620);
            double x=std::cos(angle)*dist,z=std::sin(angle)*dist;
            auto mask=macro_.getLandmassMask(x,z);
            if(mask.coastDist>140){vx=x;vz=z;best=mask.coastDist;break;}
            if(mask.coastDist>best){best=mask.coastDist;vx=x;vz=z;}
        }
        double br=p.range(160,192),ph=p.range(138,156),cr=p.range(34,42),cd=p.range(50,62);
        double ll=std::round(ph-cd*p.range(0.48,0.54));
        volcanoes_.push_back({vx,vz,br,ph,cr,cd,ll});
    }
    SimplexNoise noise_;uint32_t seed_;const MacroGeography& macro_;std::vector<VolcanoCenter> volcanoes_;
};

struct GeoResult{double heightOffset,influence;bool isThermalPool;double ringFactor;};
struct Spring{double x,z,radius,poolDepth,waterLevel;bool geyser;};

class GeothermalGenerator {
public:
    GeothermalGenerator(uint32_t seed,const MacroGeography& m,const VolcanoGenerator& v):seed_(seed),macro_(m),volcano_(v){init();}
    GeoResult query(double x,double z,double current)const{
        const Spring* closest=nullptr;double mn=999999;
        for(const auto& s:springs_){double dx=x-s.x,dz=z-s.z,n=std::sqrt(dx*dx+dz*dz)/s.radius;if(n<1.45&&n<mn){mn=n;closest=&s;}}
        if(closest){
            if(mn<1.0){double bed=(closest->waterLevel+1.2-closest->poolDepth)+closest->poolDepth*0.4*std::pow(mn,2);return{bed-current,1,true,mn};}
            double prog=(mn-1.0)/0.45,rim=(closest->waterLevel+1.2)+1.3*std::sin(prog*PI);
            return{rim-current,1-prog*0.5,false,1};
        }
        double dx=x-vx_,dz=z-vz_,d=std::sqrt(dx*dx+dz*dz);
        if(d<vr_){double f=smoothstep(vr_,vr_*0.4,d);return{(ve_-current)*f*0.85,f*0.6,false,0};}
        return{0,0,false,0};
    }
private:
    void init(){
        PRNG p(seed_^0x48f2d91bu);double x=-240,z=-190;bool found=false;
        for(int a=0;a<48;a++){
            double angle=p.range(0,PI*2),dist=p.range(200,520);
            double cx=std::cos(angle)*dist,cz=std::sin(angle)*dist;
            auto mask=macro_.getLandmassMask(cx,cz);if(mask.coastDist<=90)continue;
            bool close=false;for(const auto& v:volcano_.getVolcanoes()){double dx=cx-v.x,dz=cz-v.z;if(std::sqrt(dx*dx+dz*dz)<v.baseRadius+180){close=true;break;}}
            if(close)continue;x=cx;z=cz;found=true;break;
        }
        (void)found;vx_=x;vz_=z;vr_=p.range(100,130);ve_=p.range(14.5,18);
        int target=static_cast<int>(std::floor(p.range(2.0,4.99)));
        double radii[4]={p.range(17,22),p.range(13,17.5),p.range(12,16),p.range(11,14.5)};
        for(int i=0;i<target;i++){
            double sr=radii[i];
            for(int a=0;a<48;a++){
                double ang=(static_cast<double>(i)/target)*PI*2+p.range(-0.45,0.45);
                double dist=p.range(sr*1.5,vr_*0.70),sx=vx_+std::cos(ang)*dist,sz=vz_+std::sin(ang)*dist;
                bool coll=false;for(const auto& e:springs_){double dx=sx-e.x,dz=sz-e.z;if(std::sqrt(dx*dx+dz*dz)<(sr*1.45+e.radius*1.45)+12){coll=true;break;}}
                if(!coll){double depth=p.range(2.8,3.8);bool gey=p.next()>0.40;p.range(6.5,11.5);p.range(2.5,4.0);double wl=ve_-p.range(0.8,1.2);springs_.push_back({sx,sz,sr,depth,wl,gey});break;}
            }
        }
    }
    uint32_t seed_;const MacroGeography& macro_;const VolcanoGenerator& volcano_;double vx_{},vz_{},vr_{},ve_{};std::vector<Spring> springs_;
};

struct CanyonResult{double carveDepth,influence,strata;bool floor,ravine;};

class CanyonGenerator {
public:
    CanyonGenerator(uint32_t seed,const MacroGeography& m,const VolcanoGenerator& v):noise_(seed^0x7c4e2a9fu),seed_(seed),macro_(m),volcano_(v){init();}
    CanyonResult query(double x,double z,double elevation)const{
        double dx=x-cx_,dz=z-cz_,d=std::sqrt(dx*dx/(rx_*rx_)+dz*dz/(rz_*rz_));
        if(d>1.2)return{0,0,0,false,false};
        double infl=smoothstep(1.2,0.6,d);if(infl<=0.005||elevation<4)return{0,infl,0,false,false};
        double wx=noise_.noise2D(x*0.004,z*0.004)*85,wz=noise_.noise2D(z*0.004+50,x*0.004+50)*85;
        double relx=dx+wx,relz=dz+wz,axis=std::sin(relx*0.012)*120+relz,dist=std::abs(axis);
        double trib=std::abs(noise_.fbm2D((x+wx)*0.022,(z+wz)*0.022,3));
        bool ravCut=trib<0.18&&infl>0.4;double carve=0;bool floor=false,rav=false;
        double width=bw_+noise_.noise2D(x*0.02,z*0.02)*35;
        if(dist<width){
            double prog=dist/width,sc=steps_,sp=std::floor(prog*sc)/sc+std::pow(prog*sc-std::floor(prog*sc),3.0)/sc;
            double mx=std::min(elevation-4.5,34.0);carve=(1-sp)*mx*infl;floor=prog<0.18;
        }else if(ravCut){double rp=trib/0.18,mx=std::min(elevation-5.0,7.0),t=1-rp;carve=t*t*(3-2*t)*mx*infl;rav=true;}
        double strata=std::fmod(elevation-carve,6.0)/6.0;return{carve,infl,strata,floor,rav};
    }
private:
    void init(){
        PRNG p(seed_^0x7c4e2a9fu);cx_=240;cz_=200;
        for(int a=0;a<48;a++){
            double angle=p.range(0,PI*2),dist=p.range(180,520),x=std::cos(angle)*dist,z=std::sin(angle)*dist;
            auto mask=macro_.getLandmassMask(x,z);if(mask.coastDist<=110)continue;
            bool close=false;for(const auto& v:volcano_.getVolcanoes()){double dx=x-v.x,dz=z-v.z;if(std::sqrt(dx*dx+dz*dz)<v.baseRadius+220){close=true;break;}}
            if(close)continue;cx_=x;cz_=z;break;
        }
        rx_=p.range(180,225);rz_=p.range(160,205);bw_=p.range(85,110);steps_=std::floor(p.range(4.0,6.99));
    }
    SimplexNoise noise_;uint32_t seed_;const MacroGeography& macro_;const VolcanoGenerator& volcano_;double cx_{},cz_{},rx_{},rz_{},bw_{},steps_{};
};

class TerrainCore {
public:
    explicit TerrainCore(uint32_t seed):seed_(seed),noise_(seed^0x1f83d9abu),macro_(seed),volcano_(seed,macro_),geo_(seed,macro_,volcano_),canyon_(seed,macro_,volcano_){}
    double getDryHeight(double x,double z)const{
        auto r=reliefHeight(x,z);if(r.deep)return r.h;return applySpecial(x,z,r.h);
    }
    double polarLatitudeZ(double x,double z)const{
        SimplexNoise n(seed_^0x3c6ef372u);
        return z+n.fbm2D(x*0.0022+311,z*0.0022-97,3)*140+n.fbm2D(x*0.009-53,z*0.009+171,2)*45;
    }
    const VolcanoGenerator& volcano()const{return volcano_;}
    const GeothermalGenerator& geothermal()const{return geo_;}
    const CanyonGenerator& canyon()const{return canyon_;}
private:
    struct Relief{double h;bool deep;};
    Relief reliefHeight(double x,double z)const{
        auto m=macro_.getLandmassMask(x,z);
        if(m.coastDist<=-200)return{oceanFloor(x,z),true};
        double mr=macro_.getMacroRelief(x,z,m.spineFactor,m.landFactor);
        double meso=noise_.fbm2D(x*0.015,z*0.015,4,0.45,2.1)*7.5;
        double micro=noise_.noise2D(x*0.06,z*0.06)*1.4;
        double alpine=smoothstep(28,75,mr),mesoMul=lerp(1,0.20,alpine),microMul=lerp(1,0.06,alpine);
        double raw;
        if(m.coastDist<=0)raw=continentalShelf(x,z,m.coastDist,meso);
        else{
            double beachRamp=m.coastDist*0.08,inland=smoothstep(25,75,m.coastDist),damp=smoothstep(0,25,m.coastDist);
            double inlandRelief=terrace(x,z,(mr+meso*mesoMul+micro*microMul*damp)*m.landFactor,mr);
            raw=lerp(beachRamp,std::max(beachRamp,inlandRelief),inland);
            raw+=mesaLift(x,z,m.coastDist,mr);
        }
        if(m.coastDist>0)raw=std::max(raw,0.05);
        return{raw,false};
    }
    double applySpecial(double x,double z,double e)const{
        double raw=e;auto v=volcano_.query(x,z);
        if(v.influence>0){double t=smoothstep(0,0.40,v.influence);raw=lerp(raw,std::max(raw,v.heightOffset),t);if(v.isCaldera)raw=v.heightOffset;}
        auto cr=canyon_.query(x,z,raw);if(cr.carveDepth>0)raw=std::max(raw-cr.carveDepth,2.5);
        auto g=geo_.query(x,z,raw);if(g.heightOffset!=0)raw+=g.heightOffset;
        return clamp(raw,OCEAN_FLOOR,MAX_HEIGHT);
    }
    double mesaLift(double x,double z,double coastDist,double macroRelief)const{
        double env=smoothstep(150,350,coastDist)*(1-smoothstep(16,30,macroRelief));if(env<=0)return 0;
        constexpr double CELL=640;int cx=static_cast<int>(std::floor(x/CELL)),cz=static_cast<int>(std::floor(z/CELL));double liftv=0;
        for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
            int gx=cx+i,gz=cz+j;
            auto rnd=[&](uint32_t k){
                uint32_t h=imul(static_cast<uint32_t>(gx),374761393u)^imul(static_cast<uint32_t>(gz),668265263u)^imul(seed_^0x5bd1e995u,k*2654435761u);
                h=imul(h^(h>>13),1274126177u);h^=h>>16;return static_cast<double>(h)/4294967296.0;
            };
            if(rnd(1)>0.40)continue;
            double sx=(gx+0.2+0.6*rnd(2))*CELL,sz=(gz+0.2+0.6*rnd(3))*CELL,R=70+110*rnd(4),d=std::hypot(x-sx,z-sz);
            if(d>R*1.45+40)continue;
            double H=16+22*rnd(5),k=rnd(6)*100,ang=std::atan2(z-sz,x-sx),ca=std::cos(ang),sa=std::sin(ang);
            double wobble=noise_.fbm2D(ca*1.6+k,sa*1.6-k,3,0.5,2.0)*0.30+noise_.noise2D(ca*7-k,sa*7+k)*0.07;
            double sdf=d-R*(1+wobble),upper=1-smoothstep(-3,3,sdf),ledgeW=10+14*rnd(7),lower=rnd(8)<0.5?1-smoothstep(ledgeW-3,ledgeW+3,sdf):0;
            double prof=lower>0?lower*0.30+upper*0.70:upper,dome=0.06*smoothstep(0,R,-sdf);
            liftv=std::max(liftv,H*(prof+dome*upper));
        }
        return liftv*env;
    }
    double terrace(double x,double z,double h,double macroRelief)const{
        double mountain=smoothstep(16,38,macroRelief);if(mountain<=0)return h;
        double region=noise_.noise2D(x*0.006+31.1,z*0.006-7.7)*0.5+0.5,amount=mountain*smoothstep(0.30,0.55,region);if(amount<=0)return h;
        double stepH=10+noise_.noise2D(x*0.004-3.3,z*0.004+9.1)*2.5;
        double warp=noise_.noise2D(x*0.02+5.5,z*0.02+1.7)*stepH*0.45+noise_.noise2D(x*0.07,z*0.07+3.3)*stepH*0.12;
        double hw=h+warp,k=std::floor(hw/stepH),t=hw/stepH-k,t3=t*t*t,stepped=(k+t3*t3)*stepH-warp;
        return lerp(h,stepped,amount*0.95);
    }
    double oceanFloor(double x,double z)const{return OCEAN_FLOOR+noise_.fbm2D(x*0.004,z*0.004,3)*8.0;}
    double continentalShelf(double x,double z,double coastDist,double meso)const{
        double od=-coastDist,shallow=-od*0.08,deepProg=smoothstep(15,180,od),deep=lerp(-1.2,OCEAN_FLOOR,deepProg);
        double near=(meso*0.25)*smoothstep(15,60,od),far=deepProg>0?oceanFloor(x,z)-OCEAN_FLOOR:0,bed=lerp(near,far,deepProg);
        return lerp(shallow,deep+bed,deepProg);
    }
    uint32_t seed_;SimplexNoise noise_;MacroGeography macro_;VolcanoGenerator volcano_;GeothermalGenerator geo_;CanyonGenerator canyon_;
};

} // namespace original
