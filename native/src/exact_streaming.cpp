#include "exact_streaming.hpp"

#include <algorithm>
#include <cstring>
#include <stdexcept>

namespace {
template<class T>
std::vector<T> copyArray(const std::vector<uint8_t>& src,size_t& off,size_t count){
    const size_t bytes=count*sizeof(T);
    if(off+bytes>src.size()) throw std::runtime_error("Pacote procedural truncado.");
    std::vector<T> out(count);
    if(bytes) std::memcpy(out.data(),src.data()+off,bytes);
    off+=bytes;
    return out;
}
size_t align4(size_t x){return (x+3u)&~size_t(3u);}
uint32_t u32(const std::vector<uint8_t>& b,size_t off){
    if(off+4>b.size())throw std::runtime_error("Header procedural truncado.");
    uint32_t v=0;std::memcpy(&v,b.data()+off,4);return v;
}
}

ExactStreamingWorker::ExactStreamingWorker(std::filesystem::path scriptPath)
    :scriptPath_(std::move(scriptPath)),worker_([this]{run();}){}

ExactStreamingWorker::~ExactStreamingWorker(){
    {
        std::lock_guard<std::mutex> lock(m_);
        stop_=true;
        cv_.notify_all();
    }
    if(worker_.joinable())worker_.join();
}

void ExactStreamingWorker::enqueue(Request r){
    std::lock_guard<std::mutex> lock(m_);
    if(queued_.contains(r.key))return;
    r.sequence=sequence_++;
    queued_.insert(r.key);
    queue_.push(std::move(r));
    cv_.notify_one();
}

void ExactStreamingWorker::requestChunk(int cx,int cz,float density,int segments,bool walls,double priority,uint64_t generation){
    Request r;
    r.kind=Kind::Chunk;
    r.a=cx;r.b=cz;r.c=segments;r.f0=density;r.flag=walls;
    r.priority=priority;r.generation=generation;
    r.key="c:"+std::to_string(cx)+":"+std::to_string(cz)+":"+std::to_string(segments)+":"+std::to_string(static_cast<int>(density*100));
    enqueue(std::move(r));
}

void ExactStreamingWorker::requestVegetation(int cx,int cz,bool detail,double priority,uint64_t generation){
    Request r;
    r.kind=Kind::Vegetation;
    r.a=cx;r.b=cz;r.flag=detail;
    r.priority=priority;r.generation=generation;
    r.key="v:"+std::to_string(cx)+":"+std::to_string(cz)+":"+(detail?"1":"0");
    enqueue(std::move(r));
}

void ExactStreamingWorker::requestHorizon(int level,int tx,int tz,float minX,float minZ,float size,int segments,float lower,double priority,uint64_t generation){
    Request r;
    r.kind=Kind::Horizon;
    r.a=level;r.b=tx;r.c=tz;
    r.f0=minX;r.f1=minZ;r.f2=size;r.f3=static_cast<float>(segments);r.f4=lower;
    r.priority=priority;r.generation=generation;
    r.key="h:"+std::to_string(level)+":"+std::to_string(tx)+":"+std::to_string(tz);
    enqueue(std::move(r));
}

void ExactStreamingWorker::requestImpostors(int tx,int tz,float minX,float minZ,float size,float originX,float originZ,double priority,uint64_t generation){
    Request r;
    r.kind=Kind::Impostors;
    r.a=tx;r.b=tz;
    r.f0=minX;r.f1=minZ;r.f2=size;r.f3=originX;r.f4=originZ;
    r.priority=priority;r.generation=generation;
    r.key="i:"+std::to_string(tx)+":"+std::to_string(tz);
    enqueue(std::move(r));
}

bool ExactStreamingWorker::take(ExactStreamResult& out){
    std::lock_guard<std::mutex> lock(m_);
    if(ready_.empty())return false;
    out=std::move(ready_.front());
    ready_.erase(ready_.begin());
    return true;
}
bool ExactStreamingWorker::takeError(std::string& out){
    std::lock_guard<std::mutex> lock(m_);
    if(!error_)return false;
    out=*error_;error_.reset();return true;
}
size_t ExactStreamingWorker::pendingCount()const{
    std::lock_guard<std::mutex> lock(m_);
    return queue_.size();
}

ExactChunkCpu ExactStreamingWorker::decodeChunk(const Request& r,const std::vector<uint8_t>& b){
    if(b.size()<40||u32(b,0)!=0x50494348u||u32(b,4)!=1u)throw std::runtime_error("Pacote exact chunk invalido.");
    ExactChunkCpu o;
    o.cx=r.a;o.cz=r.b;o.segments=static_cast<int>(u32(b,8));o.density=r.f0;o.walls=r.flag;
    const size_t nv=u32(b,12),ni=u32(b,16);
    o.texW=u32(b,20);o.texH=u32(b,24);
    const size_t ng=u32(b,28);
    size_t off=40;
    o.positions=copyArray<float>(b,off,nv*3);
    o.normals=copyArray<float>(b,off,nv*3);
    o.wall=copyArray<float>(b,off,nv*3);
    o.morph=copyArray<float>(b,off,nv);
    o.indices=copyArray<uint16_t>(b,off,ni);
    off=align4(off);
    const size_t texBytes=static_cast<size_t>(o.texW)*o.texH*4u;
    o.top=copyArray<uint8_t>(b,off,texBytes);
    o.topDark=copyArray<uint8_t>(b,off,texBytes);
    o.grass=copyArray<float>(b,off,ng);
    return o;
}

HorizonTileCpu ExactStreamingWorker::decodeHorizon(const Request& r,const std::vector<uint8_t>& b){
    if(b.size()<24||u32(b,0)!=0x5049485au||u32(b,4)!=1u)throw std::runtime_error("Pacote horizon invalido.");
    HorizonTileCpu o;
    o.level=r.a;o.tx=r.b;o.tz=r.c;o.minX=r.f0;o.minZ=r.f1;o.size=r.f2;o.segments=static_cast<int>(r.f3);o.lower=r.f4;
    const size_t nv=u32(b,8),ni=u32(b,12);
    size_t off=24;
    o.positions=copyArray<float>(b,off,nv*3);
    o.normals=copyArray<float>(b,off,nv*3);
    o.colors=copyArray<float>(b,off,nv*3);
    o.morph=copyArray<float>(b,off,nv);
    o.indices=copyArray<uint16_t>(b,off,ni);
    return o;
}

ImpostorBlockCpu ExactStreamingWorker::decodeImpostors(const Request& r,const std::vector<uint8_t>& b){
    if(b.size()<20||u32(b,0)!=0x5049494du||u32(b,4)!=1u)throw std::runtime_error("Pacote impostor invalido.");
    ImpostorBlockCpu o;
    o.tx=r.a;o.tz=r.b;o.minX=r.f0;o.minZ=r.f1;o.size=r.f2;
    const size_t nv=u32(b,8),ni=u32(b,12);
    size_t off=20;
    o.positions=copyArray<float>(b,off,nv*3);
    o.tree=copyArray<float>(b,off,nv*4);
    o.colors=copyArray<uint8_t>(b,off,nv*3);
    off=align4(off);
    o.indices=copyArray<uint32_t>(b,off,ni);
    return o;
}

void ExactStreamingWorker::run(){
    try{
        std::unique_ptr<JsWorldRuntime> js;
        for(;;){
            Request r;
            {
                std::unique_lock<std::mutex> lock(m_);
                cv_.wait(lock,[&]{return stop_||!queue_.empty();});
                if(stop_)return;
                r=queue_.top();queue_.pop();
            }
            if(!js) js=std::make_unique<JsWorldRuntime>(scriptPath_);

            ExactStreamResult result;
            result.key=r.key;result.generation=r.generation;
            if(r.kind==Kind::Chunk){
                auto raw=js->generateExactChunk("Avalon",r.a,r.b,64.0,r.f0,r.c,r.flag);
                result.payload=decodeChunk(r,raw);
            }else if(r.kind==Kind::Vegetation){
                VegetationCpu v{};
                v.cx=r.a;v.cz=r.b;v.detail=r.flag;
                v.data=js->generateVegetation("Avalon",r.a,r.b,64.0,r.flag);
                result.payload=std::move(v);
            }else if(r.kind==Kind::Horizon){
                auto raw=js->generateHorizonTile("Avalon",r.f0,r.f1,r.f2,static_cast<int>(r.f3));
                result.payload=decodeHorizon(r,raw);
            }else{
                auto raw=js->generateImpostorBlock("Avalon",r.f0,r.f1,r.f2,r.f3,r.f4);
                result.payload=decodeImpostors(r,raw);
            }

            {
                std::lock_guard<std::mutex> lock(m_);
                queued_.erase(r.key);
                ready_.push_back(std::move(result));
                if(ready_.size()>64)ready_.erase(ready_.begin(),ready_.begin()+static_cast<std::ptrdiff_t>(ready_.size()-64));
            }
        }
    }catch(const std::exception& e){
        std::lock_guard<std::mutex> lock(m_);
        error_=e.what();
    }
}
