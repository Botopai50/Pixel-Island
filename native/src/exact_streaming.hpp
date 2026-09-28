#pragma once
#include "js_world.hpp"

#include <condition_variable>
#include <cstdint>
#include <filesystem>
#include <mutex>
#include <optional>
#include <queue>
#include <string>
#include <thread>
#include <unordered_set>
#include <variant>
#include <vector>

struct ExactChunkCpu {
    int cx=0, cz=0;
    int segments=0;
    float density=1.0f;
    bool walls=false;

    std::vector<float> positions;
    std::vector<float> normals;
    std::vector<float> wall;
    std::vector<float> morph;
    std::vector<uint16_t> indices;
    std::vector<uint8_t> top;
    std::vector<uint8_t> topDark;
    std::vector<float> grass;
    uint32_t texW=0,texH=0;
};

struct HorizonTileCpu {
    int level=0, tx=0, tz=0;
    float minX=0,minZ=0,size=0,lower=0;
    int segments=0;
    std::vector<float> positions;
    std::vector<float> normals;
    std::vector<float> colors;
    std::vector<float> morph;
    std::vector<uint16_t> indices;
};

struct VegetationCpu {
    int cx=0,cz=0;
    bool detail=false;
    std::vector<float> data;
};

struct ImpostorBlockCpu {
    int tx=0,tz=0;
    float minX=0,minZ=0,size=0;
    std::vector<float> positions;
    std::vector<float> tree;
    std::vector<uint8_t> colors;
    std::vector<uint32_t> indices;
};

using ExactStreamPayload=std::variant<ExactChunkCpu,HorizonTileCpu,ImpostorBlockCpu,VegetationCpu>;

struct ExactStreamResult {
    std::string key;
    uint64_t generation=0;
    ExactStreamPayload payload;
};

class ExactStreamingWorker {
public:
    explicit ExactStreamingWorker(std::filesystem::path scriptPath);
    ~ExactStreamingWorker();

    ExactStreamingWorker(const ExactStreamingWorker&)=delete;
    ExactStreamingWorker& operator=(const ExactStreamingWorker&)=delete;

    void requestChunk(
        int cx,int cz,float density,int segments,bool walls,
        double priority,uint64_t generation
    );

    void requestVegetation(
        int cx,int cz,bool detail,double priority,uint64_t generation
    );

    void requestHorizon(
        int level,int tx,int tz,float minX,float minZ,float size,int segments,float lower,
        double priority,uint64_t generation
    );

    void requestImpostors(
        int tx,int tz,float minX,float minZ,float size,float originX,float originZ,
        double priority,uint64_t generation
    );

    bool take(ExactStreamResult& out);
    bool takeError(std::string& out);
    size_t pendingCount() const;

private:
    enum class Kind{Chunk,Vegetation,Horizon,Impostors};
    struct Request {
        Kind kind=Kind::Chunk;
        std::string key;
        double priority=0;
        uint64_t sequence=0;
        uint64_t generation=0;
        int a=0,b=0,c=0;
        float f0=0,f1=0,f2=0,f3=0,f4=0;
        bool flag=false;
    };
    struct Compare {
        bool operator()(const Request& a,const Request& b)const{
            if(a.priority==b.priority) return a.sequence>b.sequence;
            return a.priority>b.priority;
        }
    };

    void run();
    ExactChunkCpu decodeChunk(const Request&,const std::vector<uint8_t>&);
    HorizonTileCpu decodeHorizon(const Request&,const std::vector<uint8_t>&);
    ImpostorBlockCpu decodeImpostors(const Request&,const std::vector<uint8_t>&);
    void enqueue(Request);

    std::filesystem::path scriptPath_;
    mutable std::mutex m_;
    std::condition_variable cv_;
    std::priority_queue<Request,std::vector<Request>,Compare> queue_;
    std::unordered_set<std::string> queued_;
    std::vector<ExactStreamResult> ready_;
    std::optional<std::string> error_;
    bool stop_=false;
    uint64_t sequence_=0;
    std::thread worker_;
};
