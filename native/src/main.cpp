#define VK_USE_PLATFORM_WIN32_KHR
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <vulkan/vulkan.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {

constexpr uint32_t WINDOW_WIDTH = 1280;
constexpr uint32_t WINDOW_HEIGHT = 720;
constexpr int TERRAIN_SEGMENTS = 160;
constexpr float TERRAIN_SIZE = 2048.0f;
constexpr float STREAM_STEP = 256.0f;
constexpr float FOG_FAR = 720.0f;
constexpr uint32_t MAX_INSTANCES_PER_MESH = 60000;
constexpr int MAX_FRAMES_IN_FLIGHT = 2;
constexpr uint32_t WORLD_SEED = 0x5EED1234u;
constexpr float PI = 3.14159265358979323846f;

struct Vec3 {
    float x = 0, y = 0, z = 0;
};

Vec3 operator+(const Vec3& a, const Vec3& b) { return {a.x+b.x, a.y+b.y, a.z+b.z}; }
Vec3 operator-(const Vec3& a, const Vec3& b) { return {a.x-b.x, a.y-b.y, a.z-b.z}; }
Vec3 operator*(const Vec3& a, float s) { return {a.x*s, a.y*s, a.z*s}; }

float dot(const Vec3& a, const Vec3& b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
Vec3 cross(const Vec3& a, const Vec3& b) {
    return {a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x};
}
float length(const Vec3& v) { return std::sqrt(dot(v,v)); }
Vec3 normalize(const Vec3& v) {
    const float l = length(v);
    return l > 1e-6f ? v * (1.0f / l) : Vec3{0,1,0};
}

struct Mat4 {
    float m[16]{};
};

Mat4 multiply(const Mat4& a, const Mat4& b) {
    Mat4 r{};
    for (int c = 0; c < 4; ++c) {
        for (int row = 0; row < 4; ++row) {
            float s = 0.0f;
            for (int k = 0; k < 4; ++k) s += a.m[k*4 + row] * b.m[c*4 + k];
            r.m[c*4 + row] = s;
        }
    }
    return r;
}

Mat4 lookAt(const Vec3& eye, const Vec3& center, const Vec3& up) {
    const Vec3 f = normalize(center - eye);
    const Vec3 s = normalize(cross(f, up));
    const Vec3 u = cross(s, f);
    Mat4 r{};
    r.m[0]=s.x; r.m[1]=u.x; r.m[2]=-f.x; r.m[3]=0;
    r.m[4]=s.y; r.m[5]=u.y; r.m[6]=-f.y; r.m[7]=0;
    r.m[8]=s.z; r.m[9]=u.z; r.m[10]=-f.z; r.m[11]=0;
    r.m[12]=-dot(s,eye); r.m[13]=-dot(u,eye); r.m[14]=dot(f,eye); r.m[15]=1;
    return r;
}

Mat4 perspectiveVulkan(float fovY, float aspect, float zNear, float zFar) {
    const float f = 1.0f / std::tan(fovY * 0.5f);
    Mat4 r{};
    r.m[0] = f / aspect;
    r.m[5] = -f;
    r.m[10] = zFar / (zNear - zFar);
    r.m[11] = -1.0f;
    r.m[14] = (zNear * zFar) / (zNear - zFar);
    return r;
}

Mat4 orthographicVulkan(float left, float right, float bottom, float top, float zNear, float zFar) {
    Mat4 r{};
    r.m[0] = 2.0f / (right - left);
    r.m[5] = -2.0f / (top - bottom);
    r.m[10] = 1.0f / (zNear - zFar);
    r.m[12] = -(right + left) / (right - left);
    r.m[13] = -(top + bottom) / (top - bottom);
    r.m[14] = zNear / (zNear - zFar);
    r.m[15] = 1.0f;
    return r;
}

uint32_t hash32(uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

uint32_t hashCell(int x, int z, uint32_t seed) {
    uint32_t a = static_cast<uint32_t>(x) * 0x9E3779B9u;
    uint32_t b = static_cast<uint32_t>(z) * 0x85EBCA6Bu;
    return hash32(a ^ b ^ seed);
}

float rand01(uint32_t& state) {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return static_cast<float>(state & 0x00FFFFFFu) / static_cast<float>(0x01000000u);
}

float smooth(float t) { return t*t*(3.0f-2.0f*t); }

float valueNoise(float x, float z, uint32_t seed) {
    const int x0 = static_cast<int>(std::floor(x));
    const int z0 = static_cast<int>(std::floor(z));
    const float tx = smooth(x - std::floor(x));
    const float tz = smooth(z - std::floor(z));
    auto h = [&](int ix, int iz) {
        return static_cast<float>(hashCell(ix, iz, seed) & 0xFFFFu) / 65535.0f;
    };
    const float a = h(x0,z0);
    const float b = h(x0+1,z0);
    const float c = h(x0,z0+1);
    const float d = h(x0+1,z0+1);
    const float ab = a + (b-a)*tx;
    const float cd = c + (d-c)*tx;
    return ab + (cd-ab)*tz;
}

float fbm(float x, float z, uint32_t seed, int octaves=5) {
    float sum=0, amp=0.5f, freq=1.0f, norm=0;
    for (int i=0;i<octaves;i++) {
        sum += valueNoise(x*freq, z*freq, seed + static_cast<uint32_t>(i)*977u) * amp;
        norm += amp;
        amp *= 0.5f;
        freq *= 2.03f;
    }
    return sum / std::max(norm, 1e-6f);
}


struct WorldSample {
    float height = 0.0f;
    Vec3 color{0.2f,0.6f,0.25f};
    float moisture = 0.5f;
    float temperature = 0.5f;
    float river = 0.0f;
    float volcano = 0.0f;
    bool water = false;
    bool beach = false;
    bool snow = false;
    bool desert = false;
    bool swamp = false;
};

float clamp01(float v) { return std::clamp(v, 0.0f, 1.0f); }

float smoothstepf(float a, float b, float x) {
    float t = clamp01((x-a)/(b-a));
    return t*t*(3.0f-2.0f*t);
}

Vec3 islandCenter(int gx, int gz) {
    if (gx == 0 && gz == 0) return {0,0,0};
    uint32_t s = hashCell(gx,gz,WORLD_SEED ^ 0xD1B54A35u);
    const float jx = (rand01(s)-0.5f)*520.0f;
    const float jz = (rand01(s)-0.5f)*520.0f;
    return {gx*3200.0f+jx,0,gz*3200.0f+jz};
}

float riverStrength(float x, float z, const Vec3& center) {
    const float lz = z-center.z;
    const float warp = std::sin(lz*0.0041f + 0.9f) * 135.0f
                     + (fbm(lz*0.0014f, 17.0f, WORLD_SEED ^ 0x77112233u, 3)-0.5f)*190.0f;
    const float channelX = center.x - 160.0f + warp;
    const float dist = std::abs(x-channelX);
    float r = 1.0f - smoothstepf(5.5f,18.0f,dist);
    const float longitudinal = 1.0f - smoothstepf(780.0f,1250.0f,std::abs(lz));
    return r * longitudinal;
}

WorldSample sampleWorld(float x, float z) {
    const int gx = static_cast<int>(std::round(x/3200.0f));
    const int gz = static_cast<int>(std::round(z/3200.0f));
    const Vec3 center = islandCenter(gx,gz);

    uint32_t cellSeed = hashCell(gx,gz,WORLD_SEED);
    const float rx = 1260.0f + rand01(cellSeed)*300.0f;
    const float rz = 1180.0f + rand01(cellSeed)*360.0f;
    const float lx = x-center.x;
    const float lz = z-center.z;
    const float radial = std::sqrt((lx*lx)/(rx*rx)+(lz*lz)/(rz*rz));

    const float coastNoise = (fbm(x*0.00155f,z*0.00155f,WORLD_SEED ^ 0x93A7u,4)-0.5f)*0.21f;
    const float land = 1.0f - smoothstepf(0.76f+coastNoise,1.06f+coastNoise,radial);

    const float continental = fbm(x*0.00072f,z*0.00072f,WORLD_SEED ^ 0x1255AA33u,5)*2.0f-1.0f;
    const float hills = fbm((x+900.0f)*0.0021f,(z-500.0f)*0.0021f,WORLD_SEED ^ 0xA341316Cu,5);
    const float ridge = 1.0f-std::abs(hills*2.0f-1.0f);
    const float detail = fbm(x*0.009f,z*0.009f,WORLD_SEED ^ 0xC8013EA4u,3)*2.0f-1.0f;

    float raw = -38.0f + land*(49.0f + continental*31.0f + std::pow(ridge,3.2f)*50.0f + detail*7.5f);

    // Cânions suaves, concentrados no interior mais alto.
    const float canyonField = std::abs(std::sin((x+z*0.38f)*0.0031f + fbm(x*0.001f,z*0.001f,WORLD_SEED^0xCC77u,3)*4.0f));
    if (land > 0.68f && raw > 34.0f && canyonField < 0.075f) {
        raw -= (0.075f-canyonField)*330.0f;
    }

    // Vulcão determinístico no quadrante nordeste da ilha principal.
    const Vec3 volcanoCenter{center.x+470.0f,0,center.z+360.0f};
    const float vdx=x-volcanoCenter.x, vdz=z-volcanoCenter.z;
    const float vd=std::sqrt(vdx*vdx+vdz*vdz);
    float volcano=0.0f;
    if(vd<470.0f && land>0.45f) {
        volcano=1.0f-smoothstepf(120.0f,470.0f,vd);
        const float cone=(1.0f-vd/470.0f)*118.0f;
        raw += std::max(0.0f,cone);
        if(vd<92.0f) {
            raw -= (1.0f-vd/92.0f)*62.0f;
        }
    }

    // Rio principal e lago interior. O relevo é rebaixado, mas a superfície visual fica na água.
    const float river=riverStrength(x,z,center);
    if(river>0.01f && land>0.36f) {
        raw = std::min(raw, 1.15f + (1.0f-river)*2.1f);
    }
    const float lakeD=std::hypot(lx+330.0f,lz-220.0f);
    const float lake=1.0f-smoothstepf(95.0f,165.0f,lakeD);
    if(lake>0.01f && land>0.5f) raw=std::min(raw,0.85f+(1.0f-lake)*2.4f);

    WorldSample s{};
    s.moisture=clamp01(
        fbm((x+3100.0f)*0.00085f,(z-1800.0f)*0.00085f,WORLD_SEED^0x55AA11CCu,4)*0.78f
        + river*0.40f + lake*0.50f
    );
    s.temperature=clamp01(
        0.72f - std::max(raw,0.0f)/210.0f
        + (fbm(x*0.0005f,z*0.0005f,WORLD_SEED^0x9911u,3)-0.5f)*0.26f
    );
    s.river=std::max(river,lake);
    s.volcano=volcano;
    s.water = raw <= 0.0f || s.river > 0.42f;
    s.beach = !s.water && raw < 4.2f;
    s.snow = raw > 103.0f || (raw>84.0f && s.temperature<0.34f);
    s.desert = !s.snow && s.moisture < 0.29f && s.temperature > 0.52f;
    s.swamp = !s.desert && !s.snow && s.moisture > 0.77f && raw < 18.0f;

    // Superfície visível: oceano, rios e lagos ficam planos. Mantém o renderer barato.
    s.height = s.water ? (raw<=0.0f ? 0.0f : 1.0f) : raw;

    const float fleck=fbm(x*0.024f,z*0.024f,WORLD_SEED^0xB5297A4Du,2);
    if(s.water) {
        const float shallow=clamp01((raw+12.0f)/16.0f);
        s.color={0.10f+shallow*0.08f,0.38f+shallow*0.16f,0.49f+shallow*0.12f};
    } else if(vd<78.0f && volcano>0.0f) {
        s.color={0.95f,0.18f+fleck*0.12f,0.025f};
    } else if(s.beach) {
        s.color={0.72f+fleck*0.08f,0.65f+fleck*0.06f,0.39f};
    } else if(s.snow) {
        s.color={0.79f+fleck*0.12f,0.86f+fleck*0.10f,0.90f+fleck*0.08f};
    } else if(s.desert) {
        s.color={0.61f+fleck*0.12f,0.48f+fleck*0.09f,0.24f};
    } else if(s.swamp) {
        s.color={0.16f,0.38f+fleck*0.10f,0.20f};
    } else if(raw>76.0f) {
        const float v=0.36f+fleck*0.18f;
        s.color={v*0.90f,v*0.96f,v};
    } else {
        const float lush=0.78f+fleck*0.28f;
        s.color={0.19f*lush,0.58f*lush,0.23f*lush};
    }
    return s;
}

float terrainHeight(float x,float z){ return sampleWorld(x,z).height; }

Vec3 terrainNormal(float x,float z){
    constexpr float e=3.0f;
    const float hl=terrainHeight(x-e,z),hr=terrainHeight(x+e,z);
    const float hd=terrainHeight(x,z-e),hu=terrainHeight(x,z+e);
    return normalize({hl-hr,2.0f*e,hd-hu});
}

Vec3 terrainColor(float, const Vec3&, float x,float z){ return sampleWorld(x,z).color; }

struct Vertex {
    float px,py,pz;
    float nx,ny,nz;
    float r,g,b;
};

struct InstanceGPU {
    float x,y,z,scale;
    float rotation;
    float r,g,b;
};

enum MeshKind : int {
    TREE_LOD0=0,
    TREE_LOD1,
    TREE_LOD2,
    ROCK,
    SHRUB,
    GRASS,
    ICE,
    CAVE,
    GEYSER,
    LANDMARK,
    CACTUS,
    FLOWER,
    MESH_KIND_COUNT
};

struct ObjectSeed {
    float x=0,y=0,z=0,scale=1,rotation=0;
    float r=1,g=1,b=1;
    int kind=TREE_LOD0; // árvores armazenam kind TREE_LOD0 e escolhem LOD em runtime
};

struct WorldData {
    std::vector<Vertex> terrainVertices;
    std::vector<uint32_t> terrainIndices;
    std::vector<ObjectSeed> objects;
    int centerX=0;
    int centerZ=0;
};

void pushObject(WorldData& w,int kind,float x,float y,float z,float scale,float rotation,Vec3 tint){
    w.objects.push_back({x,y,z,scale,rotation,tint.x,tint.y,tint.z,kind});
}

WorldData generateWorld(int centerX,int centerZ){
    WorldData w;
    w.centerX=centerX;w.centerZ=centerZ;
    const int side=TERRAIN_SEGMENTS+1;
    w.terrainVertices.resize(static_cast<size_t>(side)*side);
    w.terrainIndices.reserve(static_cast<size_t>(TERRAIN_SEGMENTS)*TERRAIN_SEGMENTS*6);

    for(int z=0;z<side;++z){
        for(int x=0;x<side;++x){
            const float fx=static_cast<float>(centerX)-TERRAIN_SIZE*0.5f+TERRAIN_SIZE*(static_cast<float>(x)/TERRAIN_SEGMENTS);
            const float fz=static_cast<float>(centerZ)-TERRAIN_SIZE*0.5f+TERRAIN_SIZE*(static_cast<float>(z)/TERRAIN_SEGMENTS);
            const auto sample=sampleWorld(fx,fz);
            const Vec3 n=terrainNormal(fx,fz);
            const Vec3 col=sample.color;
            w.terrainVertices[static_cast<size_t>(z)*side+x]={fx,sample.height,fz,n.x,n.y,n.z,col.x,col.y,col.z};
        }
    }

    for(int z=0;z<TERRAIN_SEGMENTS;++z){
        for(int x=0;x<TERRAIN_SEGMENTS;++x){
            const uint32_t i0=static_cast<uint32_t>(z*side+x);
            const uint32_t i1=i0+1,i2=i0+static_cast<uint32_t>(side),i3=i2+1;
            w.terrainIndices.insert(w.terrainIndices.end(),{i0,i2,i1,i1,i2,i3});
        }
    }

    // Vegetação e props em células determinísticas. Geração toda fora do render loop.
    constexpr float cell=28.0f;
    const int minX=static_cast<int>(std::floor((centerX-TERRAIN_SIZE*0.5f)/cell));
    const int maxX=static_cast<int>(std::ceil ((centerX+TERRAIN_SIZE*0.5f)/cell));
    const int minZ=static_cast<int>(std::floor((centerZ-TERRAIN_SIZE*0.5f)/cell));
    const int maxZ=static_cast<int>(std::ceil ((centerZ+TERRAIN_SIZE*0.5f)/cell));
    w.objects.reserve(24000);

    for(int cz=minZ;cz<=maxZ;++cz){
        for(int cx=minX;cx<=maxX;++cx){
            uint32_t rng=hashCell(cx,cz,WORLD_SEED^0x68E31DA4u);
            const float wx=(cx+0.12f+rand01(rng)*0.76f)*cell;
            const float wz=(cz+0.12f+rand01(rng)*0.76f)*cell;
            const auto s=sampleWorld(wx,wz);
            const Vec3 n=terrainNormal(wx,wz);
            if(s.water||s.beach||n.y<0.76f) continue;

            const float rot=rand01(rng)*PI*2.0f;
            const float pick=rand01(rng);

            if(s.snow){
                if(pick<0.48f) pushObject(w,TREE_LOD0,wx,s.height,wz,0.9f+rand01(rng)*1.25f,rot,{0.63f,0.74f,0.68f});
                else if(pick<0.68f) pushObject(w,ICE,wx,s.height,wz,0.7f+rand01(rng)*1.7f,rot,{0.66f,0.88f,1.0f});
                else pushObject(w,ROCK,wx,s.height,wz,0.65f+rand01(rng)*1.7f,rot,{0.72f,0.78f,0.79f});
            } else if(s.desert){
                if(pick<0.35f) pushObject(w,CACTUS,wx,s.height,wz,0.7f+rand01(rng)*1.3f,rot,{0.48f,0.68f,0.26f});
                else if(pick<0.72f) pushObject(w,ROCK,wx,s.height,wz,0.55f+rand01(rng)*1.6f,rot,{0.58f,0.44f,0.28f});
            } else if(s.swamp){
                if(pick<0.58f) pushObject(w,TREE_LOD0,wx,s.height,wz,1.0f+rand01(rng)*1.35f,rot,{0.42f,0.62f,0.32f});
                else if(pick<0.82f) pushObject(w,SHRUB,wx,s.height,wz,0.8f+rand01(rng)*1.3f,rot,{0.40f,0.68f,0.32f});
            } else {
                const float autumn=fbm(wx*0.0011f,wz*0.0011f,WORLD_SEED^0xAA7711u,3);
                Vec3 treeTint = autumn>0.72f ? Vec3{0.88f,0.45f,0.12f} :
                                (s.moisture>0.63f ? Vec3{0.80f,1.0f,0.78f} : Vec3{0.92f,0.94f,0.82f});
                if(pick<0.48f) pushObject(w,TREE_LOD0,wx,s.height,wz,0.8f+rand01(rng)*1.7f,rot,treeTint);
                else if(pick<0.63f) pushObject(w,SHRUB,wx,s.height,wz,0.65f+rand01(rng)*1.1f,rot,{0.75f,0.95f,0.70f});
                else if(pick<0.77f) pushObject(w,ROCK,wx,s.height,wz,0.55f+rand01(rng)*1.55f,rot,{0.76f,0.78f,0.72f});
                else if(pick<0.88f) pushObject(w,FLOWER,wx,s.height,wz,0.75f+rand01(rng)*0.8f,rot,{1.0f,0.75f+rand01(rng)*0.2f,0.68f});
            }

            // Grama: múltiplos tufos, mas só será enviada à GPU quando estiver perto.
            if(!s.desert && !s.snow && rand01(rng)<0.72f){
                const int blades=2+static_cast<int>(rand01(rng)*5.0f);
                for(int g=0;g<blades;++g){
                    float gx=wx+(rand01(rng)-0.5f)*12.0f;
                    float gz=wz+(rand01(rng)-0.5f)*12.0f;
                    auto gs=sampleWorld(gx,gz);
                    if(!gs.water) pushObject(w,GRASS,gx,gs.height,gz,0.7f+rand01(rng)*0.9f,rand01(rng)*PI,{0.72f,0.92f,0.66f});
                }
            }

            // Cavernas nas encostas mais íngremes.
            if(n.y<0.84f && rand01(rng)<0.028f)
                pushObject(w,CAVE,wx,s.height,wz,1.4f+rand01(rng)*1.2f,rot,{0.36f,0.34f,0.31f});

            // Geotermia ao redor do vulcão.
            if(s.volcano>0.10f && s.volcano<0.72f && rand01(rng)<0.075f)
                pushObject(w,GEYSER,wx,s.height,wz,0.8f+rand01(rng)*1.5f,rot,{0.72f,0.90f,0.88f});
        }
    }

    // Landmarks raros em grade larga: monólitos / círculos de pedra representados por um prop instanciado.
    constexpr float landmarkCell=230.0f;
    const int lminX=static_cast<int>(std::floor((centerX-TERRAIN_SIZE*0.5f)/landmarkCell));
    const int lmaxX=static_cast<int>(std::ceil ((centerX+TERRAIN_SIZE*0.5f)/landmarkCell));
    const int lminZ=static_cast<int>(std::floor((centerZ-TERRAIN_SIZE*0.5f)/landmarkCell));
    const int lmaxZ=static_cast<int>(std::ceil ((centerZ+TERRAIN_SIZE*0.5f)/landmarkCell));
    for(int cz=lminZ;cz<=lmaxZ;++cz)for(int cx=lminX;cx<=lmaxX;++cx){
        uint32_t r=hashCell(cx,cz,WORLD_SEED^0xF00D1234u);
        if(rand01(r)>0.18f)continue;
        float x=(cx+0.5f+(rand01(r)-0.5f)*0.45f)*landmarkCell;
        float z=(cz+0.5f+(rand01(r)-0.5f)*0.45f)*landmarkCell;
        auto s=sampleWorld(x,z); Vec3 n=terrainNormal(x,z);
        if(s.water||s.beach||n.y<0.84f)continue;
        pushObject(w,LANDMARK,x,s.height,z,1.0f+rand01(r)*1.6f,rand01(r)*PI*2.0f,{0.70f,0.70f,0.64f});
    }

    return w;
}

class WorldStreamer {
public:
    WorldStreamer() : worker_([this]{ run(); }) {}
    ~WorldStreamer() {
        {
            std::lock_guard<std::mutex> lock(m_);
            stop_ = true;
            cv_.notify_all();
        }
        if (worker_.joinable()) worker_.join();
    }

    void request(int x, int z) {
        std::lock_guard<std::mutex> lock(m_);
        reqX_=x; reqZ_=z; requested_=true;
        cv_.notify_one();
    }

    bool take(WorldData& out) {
        std::lock_guard<std::mutex> lock(m_);
        if (!ready_) return false;
        out = std::move(*ready_);
        ready_.reset();
        return true;
    }

private:
    void run() {
        for (;;) {
            int x=0,z=0;
            {
                std::unique_lock<std::mutex> lock(m_);
                cv_.wait(lock,[&]{return stop_||requested_;});
                if (stop_) return;
                x=reqX_; z=reqZ_; requested_=false;
            }
            WorldData data = generateWorld(x,z);
            {
                std::lock_guard<std::mutex> lock(m_);
                if (!requested_ || (x==reqX_ && z==reqZ_)) ready_ = std::move(data);
            }
        }
    }

    std::thread worker_;
    std::mutex m_;
    std::condition_variable cv_;
    bool stop_=false, requested_=false;
    int reqX_=0, reqZ_=0;
    std::optional<WorldData> ready_;
};

struct CpuMesh {
    std::vector<Vertex> vertices;
    std::vector<uint32_t> indices;
};

void addTriangle(CpuMesh& m, Vec3 a, Vec3 b, Vec3 c, Vec3 color) {
    const Vec3 n = normalize(cross(b-a,c-a));
    const uint32_t base = static_cast<uint32_t>(m.vertices.size());
    m.vertices.push_back({a.x,a.y,a.z,n.x,n.y,n.z,color.x,color.y,color.z});
    m.vertices.push_back({b.x,b.y,b.z,n.x,n.y,n.z,color.x,color.y,color.z});
    m.vertices.push_back({c.x,c.y,c.z,n.x,n.y,n.z,color.x,color.y,color.z});
    m.indices.insert(m.indices.end(), {base,base+1,base+2});
}

void addCylinder(CpuMesh& m, float radius, float height, int sides, Vec3 color) {
    for (int i=0;i<sides;i++) {
        const float a0=PI*2.0f*i/sides, a1=PI*2.0f*(i+1)/sides;
        Vec3 p0{std::cos(a0)*radius,0,std::sin(a0)*radius};
        Vec3 p1{std::cos(a1)*radius,0,std::sin(a1)*radius};
        Vec3 p2{p0.x,height,p0.z};
        Vec3 p3{p1.x,height,p1.z};
        addTriangle(m,p0,p2,p1,color);
        addTriangle(m,p1,p2,p3,color);
    }
}

void addOcta(CpuMesh& m, Vec3 c, float rx, float ry, Vec3 color) {
    Vec3 top{c.x,c.y+ry,c.z}, bot{c.x,c.y-ry,c.z};
    Vec3 p[4] = {
        {c.x+rx,c.y,c.z},{c.x,c.y,c.z+rx},
        {c.x-rx,c.y,c.z},{c.x,c.y,c.z-rx}
    };
    for(int i=0;i<4;i++) {
        int j=(i+1)%4;
        addTriangle(m,top,p[i],p[j],color);
        addTriangle(m,bot,p[j],p[i],color*0.82f);
    }
}

void addCross(CpuMesh& m, float y0, float w, float h, Vec3 color) {
    auto quad=[&](Vec3 a,Vec3 b,Vec3 c,Vec3 d){
        addTriangle(m,a,b,c,color);
        addTriangle(m,a,c,d,color*0.86f);
    };
    quad({-w,y0,0},{w,y0,0},{w,y0+h,0},{-w,y0+h,0});
    quad({0,y0,-w},{0,y0,w},{0,y0+h,w},{0,y0+h,-w});
}


void addBox(CpuMesh& m, Vec3 mn, Vec3 mx, Vec3 color) {
    Vec3 p[8] = {
        {mn.x,mn.y,mn.z},{mx.x,mn.y,mn.z},{mx.x,mx.y,mn.z},{mn.x,mx.y,mn.z},
        {mn.x,mn.y,mx.z},{mx.x,mn.y,mx.z},{mx.x,mx.y,mx.z},{mn.x,mx.y,mx.z}
    };
    const int q[6][4] = {{0,1,2,3},{5,4,7,6},{4,0,3,7},{1,5,6,2},{3,2,6,7},{4,5,1,0}};
    for (auto& face : q) {
        addTriangle(m,p[face[0]],p[face[1]],p[face[2]],color);
        addTriangle(m,p[face[0]],p[face[2]],p[face[3]],color*0.90f);
    }
}

void addCone(CpuMesh& m, float radius, float y0, float height, int sides, Vec3 color) {
    Vec3 top{0,y0+height,0};
    for(int i=0;i<sides;i++){
        float a0=PI*2.0f*i/sides,a1=PI*2.0f*(i+1)/sides;
        Vec3 p0{std::cos(a0)*radius,y0,std::sin(a0)*radius};
        Vec3 p1{std::cos(a1)*radius,y0,std::sin(a1)*radius};
        addTriangle(m,p0,top,p1,color);
    }
}

CpuMesh buildTreeMesh(int lod) {
    CpuMesh m;
    const Vec3 bark{0.42f,0.27f,0.13f};
    if (lod==0) {
        addCylinder(m,0.34f,3.4f,8,bark);
        // galhos grossos simplificados: mantêm a silhueta sem milhares de triângulos
        addBox(m,{-0.17f,2.35f,-0.12f},{1.18f,2.60f,0.12f},bark*0.92f);
        addBox(m,{-1.06f,2.72f,-0.10f},{0.12f,2.94f,0.10f},bark*0.88f);
        addOcta(m,{0,4.15f,0},1.90f,1.55f,{0.15f,0.58f,0.16f});
        addOcta(m,{-0.92f,3.82f,0.42f},1.28f,1.08f,{0.13f,0.50f,0.14f});
        addOcta(m,{0.96f,3.90f,-0.34f},1.24f,1.12f,{0.17f,0.64f,0.17f});
        addOcta(m,{0.20f,4.75f,0.30f},1.08f,0.96f,{0.20f,0.67f,0.18f});
    } else if (lod==1) {
        addCylinder(m,0.29f,3.05f,6,bark);
        addOcta(m,{0,3.95f,0},1.82f,1.60f,{0.14f,0.54f,0.15f});
        addOcta(m,{0.70f,3.75f,0.0f},0.95f,0.88f,{0.17f,0.60f,0.16f});
    } else {
        addCross(m,0.0f,1.5f,5.0f,{0.12f,0.48f,0.13f});
    }
    return m;
}

CpuMesh buildRockMesh() {
    CpuMesh m;
    addOcta(m,{0,0.72f,0},0.92f,0.72f,{0.62f,0.64f,0.61f});
    addOcta(m,{0.35f,0.52f,0.16f},0.58f,0.50f,{0.54f,0.57f,0.53f});
    return m;
}

CpuMesh buildShrubMesh() {
    CpuMesh m;
    addOcta(m,{-0.35f,0.62f,0},0.72f,0.62f,{0.18f,0.55f,0.17f});
    addOcta(m,{0.38f,0.58f,0.12f},0.68f,0.58f,{0.23f,0.65f,0.20f});
    addOcta(m,{0,0.96f,-0.12f},0.62f,0.56f,{0.20f,0.60f,0.18f});
    return m;
}

CpuMesh buildGrassMesh() {
    CpuMesh m;
    addCross(m,0.0f,0.11f,0.62f,{0.25f,0.72f,0.20f});
    return m;
}

CpuMesh buildIceMesh() {
    CpuMesh m;
    addOcta(m,{0,1.2f,0},0.48f,1.35f,{0.62f,0.88f,0.98f});
    addOcta(m,{0.48f,0.62f,0.18f},0.34f,0.70f,{0.75f,0.94f,1.0f});
    return m;
}

CpuMesh buildCaveMesh() {
    CpuMesh m;
    const Vec3 stone{0.30f,0.30f,0.28f};
    addBox(m,{-1.45f,0,-0.46f},{-0.72f,2.55f,0.46f},stone);
    addBox(m,{0.72f,0,-0.46f},{1.45f,2.55f,0.46f},stone*0.92f);
    addBox(m,{-1.45f,2.15f,-0.46f},{1.45f,2.90f,0.46f},stone*0.86f);
    addBox(m,{-0.72f,0.02f,0.18f},{0.72f,2.15f,0.42f},{0.055f,0.052f,0.048f});
    return m;
}

CpuMesh buildGeyserMesh() {
    CpuMesh m;
    addCylinder(m,0.72f,0.35f,7,{0.50f,0.44f,0.34f});
    addOcta(m,{0,1.15f,0},0.32f,1.25f,{0.68f,0.88f,0.90f});
    addOcta(m,{0,2.35f,0},0.20f,0.80f,{0.82f,0.95f,0.96f});
    return m;
}

CpuMesh buildLandmarkMesh() {
    CpuMesh m;
    const Vec3 stone{0.53f,0.54f,0.49f};
    // pequeno círculo de pedra + monólito central
    for(int i=0;i<8;i++){
        float a=PI*2.0f*i/8.0f;
        float x=std::cos(a)*2.4f,z=std::sin(a)*2.4f;
        addOcta(m,{x,0.70f,z},0.55f,0.78f,stone*(0.84f+0.02f*i));
    }
    addBox(m,{-0.42f,0,-0.34f},{0.42f,3.8f,0.34f},stone*0.86f);
    return m;
}

CpuMesh buildCactusMesh() {
    CpuMesh m;
    Vec3 green{0.28f,0.56f,0.20f};
    addCylinder(m,0.28f,3.0f,8,green);
    addBox(m,{0.18f,1.45f,-0.13f},{1.00f,1.72f,0.13f},green*0.95f);
    addCylinder(m,0.17f,1.1f,7,green*0.96f);
    return m;
}

CpuMesh buildFlowerMesh() {
    CpuMesh m;
    addCross(m,0.0f,0.055f,0.52f,{0.18f,0.55f,0.16f});
    addOcta(m,{0,0.55f,0},0.18f,0.11f,{1.0f,0.72f,0.72f});
    return m;
}

CpuMesh buildMeshForKind(int kind) {
    switch(kind) {
        case TREE_LOD0: return buildTreeMesh(0);
        case TREE_LOD1: return buildTreeMesh(1);
        case TREE_LOD2: return buildTreeMesh(2);
        case ROCK: return buildRockMesh();
        case SHRUB: return buildShrubMesh();
        case GRASS: return buildGrassMesh();
        case ICE: return buildIceMesh();
        case CAVE: return buildCaveMesh();
        case GEYSER: return buildGeyserMesh();
        case LANDMARK: return buildLandmarkMesh();
        case CACTUS: return buildCactusMesh();
        case FLOWER: return buildFlowerMesh();
        default: return buildRockMesh();
    }
}

std::vector<char> readBinary(const std::wstring& path) {
    std::ifstream f(path,std::ios::ate|std::ios::binary);
    if(!f) throw std::runtime_error("Nao foi possivel abrir shader SPIR-V.");
    const size_t size=static_cast<size_t>(f.tellg());
    std::vector<char> data(size);
    f.seekg(0);
    f.read(data.data(),static_cast<std::streamsize>(size));
    return data;
}

std::wstring executableDir() {
    wchar_t buf[MAX_PATH]{};
    GetModuleFileNameW(nullptr,buf,MAX_PATH);
    std::wstring p(buf);
    const size_t pos=p.find_last_of(L"\\/");
    return pos==std::wstring::npos ? L"." : p.substr(0,pos);
}

struct QueueFamilies {
    std::optional<uint32_t> graphics;
    std::optional<uint32_t> present;
    bool complete() const { return graphics.has_value() && present.has_value(); }
};

struct SwapSupport {
    VkSurfaceCapabilitiesKHR caps{};
    std::vector<VkSurfaceFormatKHR> formats;
    std::vector<VkPresentModeKHR> modes;
};

struct Buffer {
    VkBuffer buffer=VK_NULL_HANDLE;
    VkDeviceMemory memory=VK_NULL_HANDLE;
    void* mapped=nullptr;
    VkDeviceSize size=0;
};

struct GpuMesh {
    Buffer vb;
    Buffer ib;
    uint32_t indexCount=0;
};

struct PushConstants {
    Mat4 viewProj;
    float cameraFog[4];
    float sunAmbient[4];
    float environment[4];
};

class VulkanApp {
public:
    void run(HINSTANCE hInstance) {
        createWindow(hInstance);
        initVulkan();
        createGpuWorldResources();
        uploadWorld(generateWorld(0,0));
        mainLoop();
        vkDeviceWaitIdle(device_);
    }

    ~VulkanApp() {
        streamer_.reset();
        if(device_!=VK_NULL_HANDLE) vkDeviceWaitIdle(device_);
        cleanup();
    }

private:
    static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
        VulkanApp* app=nullptr;
        if(msg==WM_NCCREATE) {
            auto* cs=reinterpret_cast<CREATESTRUCTW*>(lp);
            app=reinterpret_cast<VulkanApp*>(cs->lpCreateParams);
            SetWindowLongPtrW(hwnd,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(app));
        } else {
            app=reinterpret_cast<VulkanApp*>(GetWindowLongPtrW(hwnd,GWLP_USERDATA));
        }
        switch(msg) {
            case WM_SIZE:
                if(app) app->framebufferResized_=true;
                return 0;
            case WM_CLOSE:
                DestroyWindow(hwnd);
                return 0;
            case WM_DESTROY:
                PostQuitMessage(0);
                return 0;
            default:
                return DefWindowProcW(hwnd,msg,wp,lp);
        }
    }

    void createWindow(HINSTANCE hi) {
        WNDCLASSW wc{};
        wc.lpfnWndProc=WndProc;
        wc.hInstance=hi;
        wc.lpszClassName=L"PixelIslandNativeVulkan";
        wc.hCursor=LoadCursor(nullptr,IDC_ARROW);
        RegisterClassW(&wc);

        RECT r{0,0,static_cast<LONG>(WINDOW_WIDTH),static_cast<LONG>(WINDOW_HEIGHT)};
        AdjustWindowRect(&r,WS_OVERLAPPEDWINDOW,FALSE);
        hwnd_=CreateWindowExW(
            0,wc.lpszClassName,L"Pixel Island Native - Vulkan",
            WS_OVERLAPPEDWINDOW|WS_VISIBLE,
            CW_USEDEFAULT,CW_USEDEFAULT,r.right-r.left,r.bottom-r.top,
            nullptr,nullptr,hi,this
        );
        if(!hwnd_) throw std::runtime_error("Falha ao criar janela Win32.");
    }

    void initVulkan() {
        VkApplicationInfo ai{VK_STRUCTURE_TYPE_APPLICATION_INFO};
        ai.pApplicationName="Pixel Island Native";
        ai.applicationVersion=VK_MAKE_VERSION(0,1,0);
        ai.pEngineName="Pixel Island Native";
        ai.engineVersion=VK_MAKE_VERSION(0,1,0);
        ai.apiVersion=VK_API_VERSION_1_0;

        const char* exts[]={VK_KHR_SURFACE_EXTENSION_NAME,VK_KHR_WIN32_SURFACE_EXTENSION_NAME};
        VkInstanceCreateInfo ci{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
        ci.pApplicationInfo=&ai;
        ci.enabledExtensionCount=2;
        ci.ppEnabledExtensionNames=exts;
        check(vkCreateInstance(&ci,nullptr,&instance_),"vkCreateInstance");

        VkWin32SurfaceCreateInfoKHR sci{VK_STRUCTURE_TYPE_WIN32_SURFACE_CREATE_INFO_KHR};
        sci.hwnd=hwnd_;
        sci.hinstance=GetModuleHandleW(nullptr);
        check(vkCreateWin32SurfaceKHR(instance_,&sci,nullptr,&surface_),"vkCreateWin32SurfaceKHR");

        pickPhysicalDevice();
        createLogicalDevice();
        createSwapchain();
        createRenderPass();
        createPipeline();
        createDepthResources();
        createFramebuffers();
        createCommandPool();
        createCommandBuffers();
        createSyncObjects();

        streamer_=std::make_unique<WorldStreamer>();
    }

    void check(VkResult r,const char* what) {
        if(r!=VK_SUCCESS) throw std::runtime_error(std::string(what)+" falhou: "+std::to_string(r));
    }

    QueueFamilies findQueues(VkPhysicalDevice d) {
        uint32_t count=0;
        vkGetPhysicalDeviceQueueFamilyProperties(d,&count,nullptr);
        std::vector<VkQueueFamilyProperties> props(count);
        vkGetPhysicalDeviceQueueFamilyProperties(d,&count,props.data());
        QueueFamilies q;
        for(uint32_t i=0;i<count;i++) {
            if(props[i].queueFlags&VK_QUEUE_GRAPHICS_BIT) q.graphics=i;
            VkBool32 present=VK_FALSE;
            vkGetPhysicalDeviceSurfaceSupportKHR(d,i,surface_,&present);
            if(present) q.present=i;
            if(q.complete()) break;
        }
        return q;
    }

    SwapSupport querySwap(VkPhysicalDevice d) {
        SwapSupport s;
        vkGetPhysicalDeviceSurfaceCapabilitiesKHR(d,surface_,&s.caps);
        uint32_t c=0;
        vkGetPhysicalDeviceSurfaceFormatsKHR(d,surface_,&c,nullptr);
        if(c){s.formats.resize(c);vkGetPhysicalDeviceSurfaceFormatsKHR(d,surface_,&c,s.formats.data());}
        c=0;
        vkGetPhysicalDeviceSurfacePresentModesKHR(d,surface_,&c,nullptr);
        if(c){s.modes.resize(c);vkGetPhysicalDeviceSurfacePresentModesKHR(d,surface_,&c,s.modes.data());}
        return s;
    }

    bool hasSwapchainExtension(VkPhysicalDevice d) {
        uint32_t count=0;
        vkEnumerateDeviceExtensionProperties(d,nullptr,&count,nullptr);
        std::vector<VkExtensionProperties> p(count);
        vkEnumerateDeviceExtensionProperties(d,nullptr,&count,p.data());
        for(const auto& e:p) if(std::strcmp(e.extensionName,VK_KHR_SWAPCHAIN_EXTENSION_NAME)==0) return true;
        return false;
    }

    void pickPhysicalDevice() {
        uint32_t count=0;
        vkEnumeratePhysicalDevices(instance_,&count,nullptr);
        if(!count) throw std::runtime_error("Nenhuma GPU com Vulkan encontrada.");
        std::vector<VkPhysicalDevice> devs(count);
        vkEnumeratePhysicalDevices(instance_,&count,devs.data());

        int best=-1;
        for(auto d:devs) {
            auto q=findQueues(d);
            if(!q.complete()||!hasSwapchainExtension(d)) continue;
            auto sw=querySwap(d);
            if(sw.formats.empty()||sw.modes.empty()) continue;
            VkPhysicalDeviceProperties p{};
            vkGetPhysicalDeviceProperties(d,&p);
            int score=static_cast<int>(p.limits.maxImageDimension2D/64);
            if(p.deviceType==VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU) score+=2000;
            else if(p.deviceType==VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU) score+=1200;
            if(score>best){best=score;physicalDevice_=d;deviceProps_=p;}
        }
        if(physicalDevice_==VK_NULL_HANDLE) throw std::runtime_error("Nenhuma GPU Vulkan compativel com swapchain.");
        queues_=findQueues(physicalDevice_);
    }

    void createLogicalDevice() {
        std::vector<uint32_t> unique{*queues_.graphics};
        if(*queues_.present!=*queues_.graphics) unique.push_back(*queues_.present);
        float priority=1.0f;
        std::vector<VkDeviceQueueCreateInfo> qcis;
        for(uint32_t q:unique) {
            VkDeviceQueueCreateInfo qi{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
            qi.queueFamilyIndex=q; qi.queueCount=1; qi.pQueuePriorities=&priority;
            qcis.push_back(qi);
        }
        VkPhysicalDeviceFeatures features{};
        const char* ext=VK_KHR_SWAPCHAIN_EXTENSION_NAME;
        VkDeviceCreateInfo ci{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
        ci.queueCreateInfoCount=static_cast<uint32_t>(qcis.size());
        ci.pQueueCreateInfos=qcis.data();
        ci.pEnabledFeatures=&features;
        ci.enabledExtensionCount=1; ci.ppEnabledExtensionNames=&ext;
        check(vkCreateDevice(physicalDevice_,&ci,nullptr,&device_),"vkCreateDevice");
        vkGetDeviceQueue(device_,*queues_.graphics,0,&graphicsQueue_);
        vkGetDeviceQueue(device_,*queues_.present,0,&presentQueue_);
    }

    VkSurfaceFormatKHR chooseFormat(const std::vector<VkSurfaceFormatKHR>& f) {
        for(auto x:f) if(x.format==VK_FORMAT_B8G8R8A8_SRGB&&x.colorSpace==VK_COLOR_SPACE_SRGB_NONLINEAR_KHR) return x;
        return f[0];
    }

    VkExtent2D chooseExtent(const VkSurfaceCapabilitiesKHR& caps) {
        if(caps.currentExtent.width!=UINT32_MAX) return caps.currentExtent;
        RECT r{}; GetClientRect(hwnd_,&r);
        VkExtent2D e{static_cast<uint32_t>(std::max<LONG>(1,r.right-r.left)),static_cast<uint32_t>(std::max<LONG>(1,r.bottom-r.top))};
        e.width=std::clamp(e.width,caps.minImageExtent.width,caps.maxImageExtent.width);
        e.height=std::clamp(e.height,caps.minImageExtent.height,caps.maxImageExtent.height);
        return e;
    }

    void createSwapchain() {
        auto s=querySwap(physicalDevice_);
        auto fmt=chooseFormat(s.formats);
        swapExtent_=chooseExtent(s.caps);
        uint32_t imageCount=s.caps.minImageCount+1;
        if(s.caps.maxImageCount>0) imageCount=std::min(imageCount,s.caps.maxImageCount);

        VkSwapchainCreateInfoKHR ci{VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR};
        ci.surface=surface_;
        ci.minImageCount=imageCount;
        ci.imageFormat=fmt.format;
        ci.imageColorSpace=fmt.colorSpace;
        ci.imageExtent=swapExtent_;
        ci.imageArrayLayers=1;
        ci.imageUsage=VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
        uint32_t qidx[]={*queues_.graphics,*queues_.present};
        if(qidx[0]!=qidx[1]) {
            ci.imageSharingMode=VK_SHARING_MODE_CONCURRENT;
            ci.queueFamilyIndexCount=2; ci.pQueueFamilyIndices=qidx;
        } else ci.imageSharingMode=VK_SHARING_MODE_EXCLUSIVE;
        ci.preTransform=s.caps.currentTransform;
        ci.compositeAlpha=VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
        ci.presentMode=VK_PRESENT_MODE_FIFO_KHR;
        ci.clipped=VK_TRUE;
        check(vkCreateSwapchainKHR(device_,&ci,nullptr,&swapchain_),"vkCreateSwapchainKHR");

        swapFormat_=fmt.format;
        uint32_t c=0; vkGetSwapchainImagesKHR(device_,swapchain_,&c,nullptr);
        swapImages_.resize(c); vkGetSwapchainImagesKHR(device_,swapchain_,&c,swapImages_.data());
        swapViews_.resize(c);
        for(size_t i=0;i<c;i++) {
            VkImageViewCreateInfo vi{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
            vi.image=swapImages_[i]; vi.viewType=VK_IMAGE_VIEW_TYPE_2D; vi.format=swapFormat_;
            vi.subresourceRange.aspectMask=VK_IMAGE_ASPECT_COLOR_BIT;
            vi.subresourceRange.levelCount=1; vi.subresourceRange.layerCount=1;
            check(vkCreateImageView(device_,&vi,nullptr,&swapViews_[i]),"vkCreateImageView");
        }
    }

    VkFormat findDepthFormat() {
        const VkFormat candidates[]={VK_FORMAT_D32_SFLOAT,VK_FORMAT_D24_UNORM_S8_UINT,VK_FORMAT_D16_UNORM};
        for(auto f:candidates) {
            VkFormatProperties p{};
            vkGetPhysicalDeviceFormatProperties(physicalDevice_,f,&p);
            if(p.optimalTilingFeatures&VK_FORMAT_FEATURE_DEPTH_STENCIL_ATTACHMENT_BIT) return f;
        }
        throw std::runtime_error("Nenhum formato de depth Vulkan suportado.");
    }

    bool hasStencil(VkFormat f) const {
        return f==VK_FORMAT_D24_UNORM_S8_UINT||f==VK_FORMAT_D32_SFLOAT_S8_UINT;
    }

    void createRenderPass() {
        depthFormat_=findDepthFormat();
        VkAttachmentDescription color{};
        color.format=swapFormat_; color.samples=VK_SAMPLE_COUNT_1_BIT;
        color.loadOp=VK_ATTACHMENT_LOAD_OP_CLEAR; color.storeOp=VK_ATTACHMENT_STORE_OP_STORE;
        color.stencilLoadOp=VK_ATTACHMENT_LOAD_OP_DONT_CARE; color.stencilStoreOp=VK_ATTACHMENT_STORE_OP_DONT_CARE;
        color.initialLayout=VK_IMAGE_LAYOUT_UNDEFINED; color.finalLayout=VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;

        VkAttachmentDescription depth{};
        depth.format=depthFormat_; depth.samples=VK_SAMPLE_COUNT_1_BIT;
        depth.loadOp=VK_ATTACHMENT_LOAD_OP_CLEAR; depth.storeOp=VK_ATTACHMENT_STORE_OP_DONT_CARE;
        depth.stencilLoadOp=VK_ATTACHMENT_LOAD_OP_DONT_CARE; depth.stencilStoreOp=VK_ATTACHMENT_STORE_OP_DONT_CARE;
        depth.initialLayout=VK_IMAGE_LAYOUT_UNDEFINED; depth.finalLayout=VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

        VkAttachmentReference colorRef{0,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
        VkAttachmentReference depthRef{1,VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL};
        VkSubpassDescription sub{};
        sub.pipelineBindPoint=VK_PIPELINE_BIND_POINT_GRAPHICS;
        sub.colorAttachmentCount=1; sub.pColorAttachments=&colorRef; sub.pDepthStencilAttachment=&depthRef;

        std::array<VkAttachmentDescription,2> at{color,depth};
        VkSubpassDependency dep{};
        dep.srcSubpass=VK_SUBPASS_EXTERNAL; dep.dstSubpass=0;
        dep.srcStageMask=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT|VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
        dep.dstStageMask=dep.srcStageMask;
        dep.dstAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT|VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;

        VkRenderPassCreateInfo ci{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
        ci.attachmentCount=static_cast<uint32_t>(at.size()); ci.pAttachments=at.data();
        ci.subpassCount=1; ci.pSubpasses=&sub; ci.dependencyCount=1; ci.pDependencies=&dep;
        check(vkCreateRenderPass(device_,&ci,nullptr,&renderPass_),"vkCreateRenderPass");
    }

    VkShaderModule shaderModule(const std::wstring& path) {
        auto data=readBinary(path);
        VkShaderModuleCreateInfo ci{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
        ci.codeSize=data.size(); ci.pCode=reinterpret_cast<const uint32_t*>(data.data());
        VkShaderModule m{};
        check(vkCreateShaderModule(device_,&ci,nullptr,&m),"vkCreateShaderModule");
        return m;
    }

    void createPipeline() {
        const std::wstring dir=executableDir()+L"\\shaders\\";
        VkShaderModule vs=shaderModule(dir+L"world.vert.spv");
        VkShaderModule fs=shaderModule(dir+L"world.frag.spv");

        VkPipelineShaderStageCreateInfo stages[2]{};
        stages[0]={VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
        stages[0].stage=VK_SHADER_STAGE_VERTEX_BIT; stages[0].module=vs; stages[0].pName="main";
        stages[1]={VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
        stages[1].stage=VK_SHADER_STAGE_FRAGMENT_BIT; stages[1].module=fs; stages[1].pName="main";

        VkVertexInputBindingDescription binds[2]{};
        binds[0]={0,sizeof(Vertex),VK_VERTEX_INPUT_RATE_VERTEX};
        binds[1]={1,sizeof(InstanceGPU),VK_VERTEX_INPUT_RATE_INSTANCE};

        std::array<VkVertexInputAttributeDescription,7> attrs{};
        attrs[0]={0,0,VK_FORMAT_R32G32B32_SFLOAT,offsetof(Vertex,px)};
        attrs[1]={1,0,VK_FORMAT_R32G32B32_SFLOAT,offsetof(Vertex,nx)};
        attrs[2]={2,0,VK_FORMAT_R32G32B32_SFLOAT,offsetof(Vertex,r)};
        attrs[3]={3,1,VK_FORMAT_R32G32B32_SFLOAT,offsetof(InstanceGPU,x)};
        attrs[4]={4,1,VK_FORMAT_R32_SFLOAT,offsetof(InstanceGPU,scale)};
        attrs[5]={5,1,VK_FORMAT_R32_SFLOAT,offsetof(InstanceGPU,rotation)};
        attrs[6]={6,1,VK_FORMAT_R32G32B32_SFLOAT,offsetof(InstanceGPU,r)};

        VkPipelineVertexInputStateCreateInfo vi{VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
        vi.vertexBindingDescriptionCount=2; vi.pVertexBindingDescriptions=binds;
        vi.vertexAttributeDescriptionCount=static_cast<uint32_t>(attrs.size()); vi.pVertexAttributeDescriptions=attrs.data();

        VkPipelineInputAssemblyStateCreateInfo ia{VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO};
        ia.topology=VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;

        VkPipelineViewportStateCreateInfo vp{VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO};
        vp.viewportCount=1; vp.scissorCount=1;

        VkPipelineRasterizationStateCreateInfo rs{VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO};
        rs.polygonMode=VK_POLYGON_MODE_FILL; rs.lineWidth=1.0f;
        rs.cullMode=VK_CULL_MODE_NONE; rs.frontFace=VK_FRONT_FACE_COUNTER_CLOCKWISE;

        VkPipelineMultisampleStateCreateInfo ms{VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO};
        ms.rasterizationSamples=VK_SAMPLE_COUNT_1_BIT;

        VkPipelineDepthStencilStateCreateInfo ds{VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO};
        ds.depthTestEnable=VK_TRUE; ds.depthWriteEnable=VK_TRUE; ds.depthCompareOp=VK_COMPARE_OP_LESS;

        VkPipelineColorBlendAttachmentState att{};
        att.colorWriteMask=VK_COLOR_COMPONENT_R_BIT|VK_COLOR_COMPONENT_G_BIT|VK_COLOR_COMPONENT_B_BIT|VK_COLOR_COMPONENT_A_BIT;
        VkPipelineColorBlendStateCreateInfo blend{VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO};
        blend.attachmentCount=1; blend.pAttachments=&att;

        VkDynamicState dyns[]={VK_DYNAMIC_STATE_VIEWPORT,VK_DYNAMIC_STATE_SCISSOR};
        VkPipelineDynamicStateCreateInfo dyn{VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO};
        dyn.dynamicStateCount=2; dyn.pDynamicStates=dyns;

        if(pipelineLayout_==VK_NULL_HANDLE) {
            VkPushConstantRange range{};
            range.stageFlags=VK_SHADER_STAGE_VERTEX_BIT|VK_SHADER_STAGE_FRAGMENT_BIT;
            range.offset=0; range.size=sizeof(PushConstants);
            VkPipelineLayoutCreateInfo lci{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
            lci.pushConstantRangeCount=1; lci.pPushConstantRanges=&range;
            check(vkCreatePipelineLayout(device_,&lci,nullptr,&pipelineLayout_),"vkCreatePipelineLayout");
        }

        VkGraphicsPipelineCreateInfo ci{VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO};
        ci.stageCount=2; ci.pStages=stages; ci.pVertexInputState=&vi; ci.pInputAssemblyState=&ia;
        ci.pViewportState=&vp; ci.pRasterizationState=&rs; ci.pMultisampleState=&ms;
        ci.pDepthStencilState=&ds; ci.pColorBlendState=&blend; ci.pDynamicState=&dyn;
        ci.layout=pipelineLayout_; ci.renderPass=renderPass_; ci.subpass=0;
        check(vkCreateGraphicsPipelines(device_,VK_NULL_HANDLE,1,&ci,nullptr,&pipeline_),"vkCreateGraphicsPipelines");

        vkDestroyShaderModule(device_,fs,nullptr);
        vkDestroyShaderModule(device_,vs,nullptr);
    }

    uint32_t memoryType(uint32_t bits,VkMemoryPropertyFlags flags) {
        VkPhysicalDeviceMemoryProperties mp{};
        vkGetPhysicalDeviceMemoryProperties(physicalDevice_,&mp);
        for(uint32_t i=0;i<mp.memoryTypeCount;i++)
            if((bits&(1u<<i))&&(mp.memoryTypes[i].propertyFlags&flags)==flags) return i;
        throw std::runtime_error("Tipo de memoria Vulkan nao encontrado.");
    }

    Buffer createBuffer(VkDeviceSize size,VkBufferUsageFlags usage,bool map=true) {
        Buffer b{}; b.size=size;
        VkBufferCreateInfo ci{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
        ci.size=size; ci.usage=usage; ci.sharingMode=VK_SHARING_MODE_EXCLUSIVE;
        check(vkCreateBuffer(device_,&ci,nullptr,&b.buffer),"vkCreateBuffer");
        VkMemoryRequirements req{};
        vkGetBufferMemoryRequirements(device_,b.buffer,&req);
        VkMemoryAllocateInfo ai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        ai.allocationSize=req.size;
        ai.memoryTypeIndex=memoryType(req.memoryTypeBits,VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT|VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
        check(vkAllocateMemory(device_,&ai,nullptr,&b.memory),"vkAllocateMemory(buffer)");
        check(vkBindBufferMemory(device_,b.buffer,b.memory,0),"vkBindBufferMemory");
        if(map) check(vkMapMemory(device_,b.memory,0,size,0,&b.mapped),"vkMapMemory");
        return b;
    }

    void destroyBuffer(Buffer& b) {
        if(b.mapped) vkUnmapMemory(device_,b.memory);
        if(b.buffer) vkDestroyBuffer(device_,b.buffer,nullptr);
        if(b.memory) vkFreeMemory(device_,b.memory,nullptr);
        b={};
    }

    void createDepthResources() {
        VkImageCreateInfo ci{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
        ci.imageType=VK_IMAGE_TYPE_2D;
        ci.extent={swapExtent_.width,swapExtent_.height,1};
        ci.mipLevels=1; ci.arrayLayers=1; ci.format=depthFormat_;
        ci.tiling=VK_IMAGE_TILING_OPTIMAL; ci.initialLayout=VK_IMAGE_LAYOUT_UNDEFINED;
        ci.usage=VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT; ci.samples=VK_SAMPLE_COUNT_1_BIT;
        ci.sharingMode=VK_SHARING_MODE_EXCLUSIVE;
        check(vkCreateImage(device_,&ci,nullptr,&depthImage_),"vkCreateImage(depth)");
        VkMemoryRequirements req{}; vkGetImageMemoryRequirements(device_,depthImage_,&req);
        VkMemoryAllocateInfo ai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        ai.allocationSize=req.size; ai.memoryTypeIndex=memoryType(req.memoryTypeBits,VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
        check(vkAllocateMemory(device_,&ai,nullptr,&depthMemory_),"vkAllocateMemory(depth)");
        check(vkBindImageMemory(device_,depthImage_,depthMemory_,0),"vkBindImageMemory");

        VkImageViewCreateInfo vi{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        vi.image=depthImage_; vi.viewType=VK_IMAGE_VIEW_TYPE_2D; vi.format=depthFormat_;
        vi.subresourceRange.aspectMask=VK_IMAGE_ASPECT_DEPTH_BIT|(hasStencil(depthFormat_)?VK_IMAGE_ASPECT_STENCIL_BIT:0);
        vi.subresourceRange.levelCount=1; vi.subresourceRange.layerCount=1;
        check(vkCreateImageView(device_,&vi,nullptr,&depthView_),"vkCreateImageView(depth)");
    }

    void createFramebuffers() {
        framebuffers_.resize(swapViews_.size());
        for(size_t i=0;i<swapViews_.size();i++) {
            VkImageView at[]={swapViews_[i],depthView_};
            VkFramebufferCreateInfo ci{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
            ci.renderPass=renderPass_; ci.attachmentCount=2; ci.pAttachments=at;
            ci.width=swapExtent_.width; ci.height=swapExtent_.height; ci.layers=1;
            check(vkCreateFramebuffer(device_,&ci,nullptr,&framebuffers_[i]),"vkCreateFramebuffer");
        }
    }

    void createCommandPool() {
        VkCommandPoolCreateInfo ci{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
        ci.flags=VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
        ci.queueFamilyIndex=*queues_.graphics;
        check(vkCreateCommandPool(device_,&ci,nullptr,&commandPool_),"vkCreateCommandPool");
    }

    void createCommandBuffers() {
        VkCommandBufferAllocateInfo ai{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
        ai.commandPool=commandPool_; ai.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY; ai.commandBufferCount=MAX_FRAMES_IN_FLIGHT;
        check(vkAllocateCommandBuffers(device_,&ai,commandBuffers_.data()),"vkAllocateCommandBuffers");
    }

    void createSyncObjects() {
        VkSemaphoreCreateInfo si{VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
        VkFenceCreateInfo fi{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO}; fi.flags=VK_FENCE_CREATE_SIGNALED_BIT;
        for(int i=0;i<MAX_FRAMES_IN_FLIGHT;i++) {
            check(vkCreateSemaphore(device_,&si,nullptr,&imageAvailable_[i]),"vkCreateSemaphore");
            check(vkCreateSemaphore(device_,&si,nullptr,&renderFinished_[i]),"vkCreateSemaphore");
            check(vkCreateFence(device_,&fi,nullptr,&inFlight_[i]),"vkCreateFence");
        }
    }

    GpuMesh uploadMesh(const CpuMesh& m) {
        GpuMesh g{};
        g.vb=createBuffer(sizeof(Vertex)*m.vertices.size(),VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
        g.ib=createBuffer(sizeof(uint32_t)*m.indices.size(),VK_BUFFER_USAGE_INDEX_BUFFER_BIT);
        std::memcpy(g.vb.mapped,m.vertices.data(),sizeof(Vertex)*m.vertices.size());
        std::memcpy(g.ib.mapped,m.indices.data(),sizeof(uint32_t)*m.indices.size());
        g.indexCount=static_cast<uint32_t>(m.indices.size());
        return g;
    }

    void destroyMesh(GpuMesh& m) { destroyBuffer(m.vb); destroyBuffer(m.ib); m.indexCount=0; }


    void createGpuWorldResources() {
        terrainVB_=createBuffer(sizeof(Vertex)*static_cast<size_t>(TERRAIN_SEGMENTS+1)*(TERRAIN_SEGMENTS+1),VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
        terrainIB_=createBuffer(sizeof(uint32_t)*static_cast<size_t>(TERRAIN_SEGMENTS)*TERRAIN_SEGMENTS*6,VK_BUFFER_USAGE_INDEX_BUFFER_BIT);

        dummyInstance_=createBuffer(sizeof(InstanceGPU),VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
        InstanceGPU d{0,0,0,1,0,1,1,1};
        std::memcpy(dummyInstance_.mapped,&d,sizeof(d));

        for(int i=0;i<MESH_KIND_COUNT;i++) {
            meshes_[i]=uploadMesh(buildMeshForKind(i));
            instanceBuffers_[i]=createBuffer(sizeof(InstanceGPU)*MAX_INSTANCES_PER_MESH,VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
            visible_[i].reserve(i==GRASS?MAX_INSTANCES_PER_MESH:12000);
        }
    }

    void uploadWorld(WorldData&& w) {
        vkDeviceWaitIdle(device_);
        const size_t vbBytes=w.terrainVertices.size()*sizeof(Vertex);
        const size_t ibBytes=w.terrainIndices.size()*sizeof(uint32_t);
        if(vbBytes>terrainVB_.size||ibBytes>terrainIB_.size) throw std::runtime_error("World terrain excedeu buffers.");
        std::memcpy(terrainVB_.mapped,w.terrainVertices.data(),vbBytes);
        std::memcpy(terrainIB_.mapped,w.terrainIndices.data(),ibBytes);
        terrainIndexCount_=static_cast<uint32_t>(w.terrainIndices.size());
        objects_=std::move(w.objects);
        worldCenterX_=w.centerX; worldCenterZ_=w.centerZ;
        requestedCenterX_=worldCenterX_; requestedCenterZ_=worldCenterZ_;
    }

    Vec3 observerEye() const {
        const float horizontal=observerSize_*0.72f;
        return {
            focus_.x + std::sin(observerYaw_)*horizontal,
            std::max(terrainHeight(focus_.x,focus_.z)+35.0f, observerSize_*0.62f),
            focus_.z + std::cos(observerYaw_)*horizontal
        };
    }

    void updateCamera(float dt) {
        const bool tabNow=(GetAsyncKeyState(VK_TAB)&0x8000)!=0;
        if(tabNow&&!tabDown_) {
            observerMode_=!observerMode_;
            if(observerMode_) {
                focus_={camera_.x,terrainHeight(camera_.x,camera_.z),camera_.z};
            } else {
                camera_={focus_.x,terrainHeight(focus_.x,focus_.z)+1.75f,focus_.z};
                yaw_=observerYaw_+PI;
                pitch_=-0.05f;
            }
        }
        tabDown_=tabNow;

        // presets rápidos para medir a Intel UHD
        if(GetAsyncKeyState('1')&0x8000) fogFar_=520.0f;
        if(GetAsyncKeyState('2')&0x8000) fogFar_=720.0f;
        if(GetAsyncKeyState('3')&0x8000) fogFar_=980.0f;

        if(observerMode_) {
            const float turn=1.30f*dt;
            if(GetAsyncKeyState(VK_LEFT)&0x8000) observerYaw_-=turn;
            if(GetAsyncKeyState(VK_RIGHT)&0x8000) observerYaw_+=turn;
            if(GetAsyncKeyState('Q')&0x8000) observerSize_=std::min(760.0f,observerSize_*(1.0f+1.5f*dt));
            if(GetAsyncKeyState('E')&0x8000) observerSize_=std::max(38.0f,observerSize_*(1.0f-1.5f*dt));

            Vec3 flat{std::sin(observerYaw_+PI),0,std::cos(observerYaw_+PI)};
            Vec3 right=normalize(cross({0,1,0},flat));
            const float speed=(GetAsyncKeyState(VK_SHIFT)&0x8000)?180.0f:75.0f;
            if(GetAsyncKeyState('W')&0x8000) focus_=focus_+flat*(speed*dt);
            if(GetAsyncKeyState('S')&0x8000) focus_=focus_-flat*(speed*dt);
            if(GetAsyncKeyState('D')&0x8000) focus_=focus_+right*(speed*dt);
            if(GetAsyncKeyState('A')&0x8000) focus_=focus_-right*(speed*dt);
            focus_.y=terrainHeight(focus_.x,focus_.z);
            camera_=observerEye();
        } else {
            const float turn=1.65f*dt;
            if(GetAsyncKeyState(VK_LEFT)&0x8000) yaw_-=turn;
            if(GetAsyncKeyState(VK_RIGHT)&0x8000) yaw_+=turn;
            if(GetAsyncKeyState(VK_UP)&0x8000) pitch_+=turn*0.75f;
            if(GetAsyncKeyState(VK_DOWN)&0x8000) pitch_-=turn*0.75f;
            pitch_=std::clamp(pitch_,-1.05f,0.82f);

            Vec3 forward{std::sin(yaw_)*std::cos(pitch_),std::sin(pitch_),std::cos(yaw_)*std::cos(pitch_)};
            Vec3 flat=normalize({forward.x,0,forward.z});
            Vec3 right=normalize(cross({0,1,0},flat));
            const float speed=(GetAsyncKeyState(VK_SHIFT)&0x8000)?42.0f:12.5f;
            if(GetAsyncKeyState('W')&0x8000) camera_=camera_+flat*(speed*dt);
            if(GetAsyncKeyState('S')&0x8000) camera_=camera_-flat*(speed*dt);
            if(GetAsyncKeyState('D')&0x8000) camera_=camera_+right*(speed*dt);
            if(GetAsyncKeyState('A')&0x8000) camera_=camera_-right*(speed*dt);
            camera_.y=terrainHeight(camera_.x,camera_.z)+1.75f;
        }

        if(GetAsyncKeyState(VK_ESCAPE)&0x8000) PostMessageW(hwnd_,WM_CLOSE,0,0);
    }

    void updateStreaming() {
        const Vec3 anchor=observerMode_?focus_:camera_;
        const int cx=static_cast<int>(std::floor(anchor.x/STREAM_STEP))*static_cast<int>(STREAM_STEP);
        const int cz=static_cast<int>(std::floor(anchor.z/STREAM_STEP))*static_cast<int>(STREAM_STEP);
        if((cx!=requestedCenterX_||cz!=requestedCenterZ_)&&streamer_) {
            requestedCenterX_=cx; requestedCenterZ_=cz;
            streamer_->request(cx,cz);
        }
        WorldData ready;
        if(streamer_&&streamer_->take(ready)) uploadWorld(std::move(ready));
    }

    float maxDistanceForKind(int kind) const {
        const float base=observerMode_?std::min(fogFar_*1.05f,1100.0f):fogFar_;
        switch(kind){
            case GRASS: return observerMode_?135.0f:72.0f;
            case FLOWER: return observerMode_?150.0f:85.0f;
            case SHRUB: return std::min(base,300.0f);
            case ROCK: return std::min(base,390.0f);
            case CAVE:
            case GEYSER:
            case LANDMARK: return std::min(base,650.0f);
            case ICE:
            case CACTUS: return std::min(base,430.0f);
            default: return base;
        }
    }

    void updateVisibleObjects() {
        for(auto& v:visible_) v.clear();

        const Vec3 eye=observerMode_?observerEye():camera_;
        Vec3 viewDir;
        if(observerMode_) viewDir=normalize(focus_-eye);
        else viewDir=normalize({std::sin(yaw_)*std::cos(pitch_),std::sin(pitch_),std::cos(yaw_)*std::cos(pitch_)});

        for(const auto& o:objects_) {
            const float dx=o.x-eye.x,dy=o.y-eye.y,dz=o.z-eye.z;
            const float d2=dx*dx+dy*dy+dz*dz;
            const float d=std::sqrt(d2);

            int kind=o.kind;
            if(kind==TREE_LOD0) {
                const float maxD=maxDistanceForKind(TREE_LOD0);
                if(d>maxD) continue;
                kind=d<105.0f?TREE_LOD0:(d<270.0f?TREE_LOD1:TREE_LOD2);
            } else {
                if(d>maxDistanceForKind(kind)) continue;
            }

            // Frustum aproximado barato. Perto nunca corta; longe remove tudo claramente atrás.
            if(d>90.0f) {
                Vec3 dir=normalize({dx,dy,dz});
                if(dot(dir,viewDir)<-0.30f) continue;
            }

            if(visible_[kind].size()>=MAX_INSTANCES_PER_MESH) continue;
            visible_[kind].push_back({o.x,o.y,o.z,o.scale,o.rotation,o.r,o.g,o.b});
        }

        for(int i=0;i<MESH_KIND_COUNT;i++) {
            if(!visible_[i].empty())
                std::memcpy(instanceBuffers_[i].mapped,visible_[i].data(),visible_[i].size()*sizeof(InstanceGPU));
        }
    }

    PushConstants makePush() {
        Mat4 view{},proj{};
        Vec3 eye{};
        if(observerMode_) {
            eye=observerEye();
            const Vec3 target{focus_.x,focus_.y,focus_.z};
            view=lookAt(eye,target,{0,1,0});
            const float aspect=static_cast<float>(swapExtent_.width)/swapExtent_.height;
            const float half=observerSize_*0.5f;
            proj=orthographicVulkan(-half*aspect,half*aspect,-half,half,0.5f,5000.0f);
        } else {
            eye=camera_;
            const Vec3 dir{std::sin(yaw_)*std::cos(pitch_),std::sin(pitch_),std::cos(yaw_)*std::cos(pitch_)};
            view=lookAt(eye,eye+dir,{0,1,0});
            proj=perspectiveVulkan(74.0f*PI/180.0f,static_cast<float>(swapExtent_.width)/swapExtent_.height,0.08f,2400.0f);
        }

        PushConstants p{};
        p.viewProj=multiply(proj,view);
        p.cameraFog[0]=eye.x;p.cameraFog[1]=eye.y;p.cameraFog[2]=eye.z;
        p.cameraFog[3]=observerMode_?std::max(fogFar_,observerSize_*2.4f):fogFar_;
        p.sunAmbient[0]=0.36f;p.sunAmbient[1]=0.82f;p.sunAmbient[2]=0.43f;p.sunAmbient[3]=0.34f;
        p.environment[0]=time_;p.environment[1]=observerMode_?1.0f:0.0f;p.environment[2]=0.0f;p.environment[3]=0.0f;
        return p;
    }

    void record(VkCommandBuffer cmd,uint32_t imageIndex) {
        VkCommandBufferBeginInfo bi{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        check(vkBeginCommandBuffer(cmd,&bi),"vkBeginCommandBuffer");

        VkClearValue clear[2]{};
        clear[0].color={{0.52f,0.70f,0.79f,1.0f}};
        clear[1].depthStencil={1.0f,0};

        VkRenderPassBeginInfo ri{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
        ri.renderPass=renderPass_;ri.framebuffer=framebuffers_[imageIndex];
        ri.renderArea.extent=swapExtent_;ri.clearValueCount=2;ri.pClearValues=clear;
        vkCmdBeginRenderPass(cmd,&ri,VK_SUBPASS_CONTENTS_INLINE);
        vkCmdBindPipeline(cmd,VK_PIPELINE_BIND_POINT_GRAPHICS,pipeline_);

        VkViewport vp{0,0,static_cast<float>(swapExtent_.width),static_cast<float>(swapExtent_.height),0,1};
        VkRect2D sc{{0,0},swapExtent_};
        vkCmdSetViewport(cmd,0,1,&vp);
        vkCmdSetScissor(cmd,0,1,&sc);

        PushConstants p=makePush();
        vkCmdPushConstants(cmd,pipelineLayout_,VK_SHADER_STAGE_VERTEX_BIT|VK_SHADER_STAGE_FRAGMENT_BIT,0,sizeof(p),&p);

        VkDeviceSize off[2]={0,0};
        VkBuffer terrainBuffers[2]={terrainVB_.buffer,dummyInstance_.buffer};
        vkCmdBindVertexBuffers(cmd,0,2,terrainBuffers,off);
        vkCmdBindIndexBuffer(cmd,terrainIB_.buffer,0,VK_INDEX_TYPE_UINT32);
        vkCmdDrawIndexed(cmd,terrainIndexCount_,1,0,0,0);

        for(int i=0;i<MESH_KIND_COUNT;i++) {
            if(visible_[i].empty()) continue;
            VkBuffer bufs[2]={meshes_[i].vb.buffer,instanceBuffers_[i].buffer};
            vkCmdBindVertexBuffers(cmd,0,2,bufs,off);
            vkCmdBindIndexBuffer(cmd,meshes_[i].ib.buffer,0,VK_INDEX_TYPE_UINT32);
            vkCmdDrawIndexed(cmd,meshes_[i].indexCount,static_cast<uint32_t>(visible_[i].size()),0,0,0);
        }

        vkCmdEndRenderPass(cmd);
        check(vkEndCommandBuffer(cmd),"vkEndCommandBuffer");
    }

    void drawFrame() {
        vkWaitForFences(device_,1,&inFlight_[frame_],VK_TRUE,UINT64_MAX);
        uint32_t imageIndex=0;
        VkResult r=vkAcquireNextImageKHR(device_,swapchain_,UINT64_MAX,imageAvailable_[frame_],VK_NULL_HANDLE,&imageIndex);
        if(r==VK_ERROR_OUT_OF_DATE_KHR){recreateSwapchain();return;}
        if(r!=VK_SUCCESS&&r!=VK_SUBOPTIMAL_KHR) check(r,"vkAcquireNextImageKHR");

        vkResetFences(device_,1,&inFlight_[frame_]);
        vkResetCommandBuffer(commandBuffers_[frame_],0);
        record(commandBuffers_[frame_],imageIndex);

        VkPipelineStageFlags waitStage=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
        VkSubmitInfo si{VK_STRUCTURE_TYPE_SUBMIT_INFO};
        si.waitSemaphoreCount=1;si.pWaitSemaphores=&imageAvailable_[frame_];si.pWaitDstStageMask=&waitStage;
        si.commandBufferCount=1;si.pCommandBuffers=&commandBuffers_[frame_];
        si.signalSemaphoreCount=1;si.pSignalSemaphores=&renderFinished_[frame_];
        check(vkQueueSubmit(graphicsQueue_,1,&si,inFlight_[frame_]),"vkQueueSubmit");

        VkPresentInfoKHR pi{VK_STRUCTURE_TYPE_PRESENT_INFO_KHR};
        pi.waitSemaphoreCount=1;pi.pWaitSemaphores=&renderFinished_[frame_];
        pi.swapchainCount=1;pi.pSwapchains=&swapchain_;pi.pImageIndices=&imageIndex;
        r=vkQueuePresentKHR(presentQueue_,&pi);
        if(r==VK_ERROR_OUT_OF_DATE_KHR||r==VK_SUBOPTIMAL_KHR||framebufferResized_) {
            framebufferResized_=false;recreateSwapchain();
        } else if(r!=VK_SUCCESS) check(r,"vkQueuePresentKHR");
        frame_=(frame_+1)%MAX_FRAMES_IN_FLIGHT;
    }

    void updateTitle(double fps,double ms) {
        size_t visibleTotal=0;
        int draws=1;
        for(const auto& v:visible_){visibleTotal+=v.size();if(!v.empty())draws++;}
        std::wostringstream ss;
        ss<<L"Pixel Island Native Full | Vulkan | "
          <<deviceProps_.deviceName
          <<L" | "<<static_cast<int>(fps)<<L" FPS"
          <<L" | "<<static_cast<int>(ms*10.0)/10.0<<L" ms"
          <<L" | "<<(observerMode_?L"OBSERVADOR":L"FPS")
          <<L" | Objetos "<<objects_.size()<<L"/"<<visibleTotal
          <<L" | Trees LOD "<<visible_[TREE_LOD0].size()<<L"/"<<visible_[TREE_LOD1].size()<<L"/"<<visible_[TREE_LOD2].size()
          <<L" | Draws "<<draws
          <<L" | TAB modo | 1/2/3 qualidade";
        SetWindowTextW(hwnd_,ss.str().c_str());
    }

    void mainLoop() {
        using clock=std::chrono::high_resolution_clock;
        auto prev=clock::now(), statsStart=prev;
        int frames=0;
        double accumMs=0;

        MSG msg{};
        bool quit=false;
        while(!quit) {
            while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)) {
                if(msg.message==WM_QUIT){quit=true;break;}
                TranslateMessage(&msg);DispatchMessageW(&msg);
            }
            if(quit) break;

            RECT rc{};GetClientRect(hwnd_,&rc);
            if(rc.right==0||rc.bottom==0){Sleep(20);continue;}

            auto now=clock::now();
            float dt=std::chrono::duration<float>(now-prev).count();
            prev=now;dt=std::min(dt,0.05f);

            updateCamera(dt);
            updateStreaming();
            updateVisibleObjects();
            time_+=dt;

            auto frameStart=clock::now();
            drawFrame();
            auto frameEnd=clock::now();

            accumMs+=std::chrono::duration<double,std::milli>(frameEnd-frameStart).count();
            frames++;
            const double statsSec=std::chrono::duration<double>(now-statsStart).count();
            if(statsSec>=0.5) {
                updateTitle(frames/statsSec,accumMs/std::max(frames,1));
                statsStart=now;frames=0;accumMs=0;
            }
        }
    }

    void cleanupSwapchain() {
        for(auto f:framebuffers_) vkDestroyFramebuffer(device_,f,nullptr);
        framebuffers_.clear();
        if(depthView_)vkDestroyImageView(device_,depthView_,nullptr);
        if(depthImage_)vkDestroyImage(device_,depthImage_,nullptr);
        if(depthMemory_)vkFreeMemory(device_,depthMemory_,nullptr);
        depthView_=VK_NULL_HANDLE;depthImage_=VK_NULL_HANDLE;depthMemory_=VK_NULL_HANDLE;
        if(pipeline_)vkDestroyPipeline(device_,pipeline_,nullptr);
        pipeline_=VK_NULL_HANDLE;
        if(renderPass_)vkDestroyRenderPass(device_,renderPass_,nullptr);
        renderPass_=VK_NULL_HANDLE;
        for(auto v:swapViews_)vkDestroyImageView(device_,v,nullptr);
        swapViews_.clear();
        if(swapchain_)vkDestroySwapchainKHR(device_,swapchain_,nullptr);
        swapchain_=VK_NULL_HANDLE;
    }

    void recreateSwapchain() {
        RECT r{};
        do {GetClientRect(hwnd_,&r); if(r.right==0||r.bottom==0) Sleep(20);} while(r.right==0||r.bottom==0);
        vkDeviceWaitIdle(device_);
        cleanupSwapchain();
        createSwapchain();
        createRenderPass();
        createPipeline();
        createDepthResources();
        createFramebuffers();
    }

    void cleanup() {
        if(device_!=VK_NULL_HANDLE) {
            for(int i=0;i<MESH_KIND_COUNT;i++){destroyMesh(meshes_[i]);destroyBuffer(instanceBuffers_[i]);}
            destroyBuffer(dummyInstance_);
            destroyBuffer(terrainVB_);destroyBuffer(terrainIB_);
            for(int i=0;i<MAX_FRAMES_IN_FLIGHT;i++) {
                if(imageAvailable_[i])vkDestroySemaphore(device_,imageAvailable_[i],nullptr);
                if(renderFinished_[i])vkDestroySemaphore(device_,renderFinished_[i],nullptr);
                if(inFlight_[i])vkDestroyFence(device_,inFlight_[i],nullptr);
            }
            if(commandPool_)vkDestroyCommandPool(device_,commandPool_,nullptr);
            cleanupSwapchain();
            if(pipelineLayout_)vkDestroyPipelineLayout(device_,pipelineLayout_,nullptr);
            vkDestroyDevice(device_,nullptr);
            device_=VK_NULL_HANDLE;
        }
        if(surface_)vkDestroySurfaceKHR(instance_,surface_,nullptr);
        if(instance_)vkDestroyInstance(instance_,nullptr);
        if(hwnd_&&IsWindow(hwnd_))DestroyWindow(hwnd_);
    }

private:
    HWND hwnd_=nullptr;
    bool framebufferResized_=false;

    VkInstance instance_=VK_NULL_HANDLE;
    VkSurfaceKHR surface_=VK_NULL_HANDLE;
    VkPhysicalDevice physicalDevice_=VK_NULL_HANDLE;
    VkPhysicalDeviceProperties deviceProps_{};
    QueueFamilies queues_{};
    VkDevice device_=VK_NULL_HANDLE;
    VkQueue graphicsQueue_=VK_NULL_HANDLE,presentQueue_=VK_NULL_HANDLE;

    VkSwapchainKHR swapchain_=VK_NULL_HANDLE;
    VkFormat swapFormat_=VK_FORMAT_UNDEFINED,depthFormat_=VK_FORMAT_UNDEFINED;
    VkExtent2D swapExtent_{};
    std::vector<VkImage> swapImages_;
    std::vector<VkImageView> swapViews_;
    VkRenderPass renderPass_=VK_NULL_HANDLE;
    VkPipelineLayout pipelineLayout_=VK_NULL_HANDLE;
    VkPipeline pipeline_=VK_NULL_HANDLE;
    VkImage depthImage_=VK_NULL_HANDLE;
    VkDeviceMemory depthMemory_=VK_NULL_HANDLE;
    VkImageView depthView_=VK_NULL_HANDLE;
    std::vector<VkFramebuffer> framebuffers_;

    VkCommandPool commandPool_=VK_NULL_HANDLE;
    std::array<VkCommandBuffer,MAX_FRAMES_IN_FLIGHT> commandBuffers_{};
    std::array<VkSemaphore,MAX_FRAMES_IN_FLIGHT> imageAvailable_{},renderFinished_{};
    std::array<VkFence,MAX_FRAMES_IN_FLIGHT> inFlight_{};
    int frame_=0;

    Buffer terrainVB_,terrainIB_,dummyInstance_;
    uint32_t terrainIndexCount_=0;
    std::array<GpuMesh,MESH_KIND_COUNT> meshes_{};
    std::array<Buffer,MESH_KIND_COUNT> instanceBuffers_{};
    std::array<std::vector<InstanceGPU>,MESH_KIND_COUNT> visible_{};
    std::vector<ObjectSeed> objects_;

    Vec3 camera_{0,terrainHeight(0,-160)+1.75f,-160};
    Vec3 focus_{0,terrainHeight(0,0),0};
    float yaw_=0.0f,pitch_=-0.05f;
    bool observerMode_=true;
    bool tabDown_=false;
    float observerYaw_=42.0f*PI/180.0f;
    float observerSize_=220.0f;
    float fogFar_=720.0f;
    float time_=0.0f;
    int worldCenterX_=0,worldCenterZ_=0;
    int requestedCenterX_=0,requestedCenterZ_=0;
    std::unique_ptr<WorldStreamer> streamer_;
};

} // namespace

int WINAPI wWinMain(HINSTANCE hInstance,HINSTANCE,LPWSTR,int) {
    try {
        VulkanApp app;
        app.run(hInstance);
        return 0;
    } catch(const std::exception& e) {
        MessageBoxA(nullptr,e.what(),"Pixel Island Native - erro",MB_OK|MB_ICONERROR);
        return 1;
    }
}
