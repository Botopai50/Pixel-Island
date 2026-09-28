#define VK_USE_PLATFORM_WIN32_KHR
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <vulkan/vulkan.h>
#include "js_world.hpp"
#include "exact_streaming.hpp"
#include "pixel_tree_native.hpp"
#include "original_world.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace {

constexpr uint32_t WINDOW_WIDTH = 1280;
constexpr uint32_t WINDOW_HEIGHT = 720;
constexpr int TERRAIN_SEGMENTS = 208; // 13 chunks de 64m, 4m por vértice
constexpr float TERRAIN_SIZE = 832.0f; // raio 6: centros -6..+6, cobrindo bordas completas
constexpr float STREAM_STEP = 64.0f;
constexpr float FOG_FAR = 720.0f;
constexpr uint32_t MAX_INSTANCES_PER_MESH = 60000;
constexpr uint32_t PIXEL_TREE_MAX_INSTANCES = 4096;
constexpr uint32_t TERRAIN_ATLAS_GRID = 13;
constexpr uint32_t TERRAIN_ATLAS_SLOT_PX = 112;
constexpr uint32_t TERRAIN_ATLAS_SIZE_PX = TERRAIN_ATLAS_GRID * TERRAIN_ATLAS_SLOT_PX;
constexpr int MAX_FRAMES_IN_FLIGHT = 2;
constexpr const char* WORLD_SEED_TEXT = "Avalon";
constexpr uint32_t WORLD_SEED = 0x5EED1234u; // legado do protótipo; não é usado pelo gerador exato
constexpr float PI = 3.14159265358979323846f;

struct Vec3 {
    float x = 0, y = 0, z = 0;
};

struct NativeInput {
    std::array<bool,256> keys{};
    bool leftDown=false;
    bool middleDown=false;
    bool rightDown=false;
    int mouseX=0,mouseY=0;
    float rotateDeltaX=0;
    float panDeltaX=0,panDeltaY=0;
    float lookDeltaX=0,lookDeltaY=0;
    float wheelDelta=0;

    bool key(int vk) const { return vk>=0&&vk<256?keys[static_cast<size_t>(vk)]:false; }
    void clearTransient(){
        rotateDeltaX=panDeltaX=panDeltaY=lookDeltaX=lookDeltaY=wheelDelta=0;
    }
};

Vec3 operator+(const Vec3& a, const Vec3& b) { return {a.x+b.x, a.y+b.y, a.z+b.z}; }
Vec3 operator-(const Vec3& a, const Vec3& b) { return {a.x-b.x, a.y-b.y, a.z-b.z}; }
Vec3 operator*(const Vec3& a, float s) { return {a.x*s, a.y*s, a.z*s}; }

Vec3 lerpVec(const Vec3& a,const Vec3& b,float t){
    return {a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t};
}
float cubicEaseInOut(float t){
    return t<0.5f?4.0f*t*t*t:1.0f-std::pow(-2.0f*t+2.0f,3.0f)/2.0f;
}

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

Mat4 identity4() {
    Mat4 r{};
    r.m[0]=r.m[5]=r.m[10]=r.m[15]=1.0f;
    return r;
}

Mat4 waterModelMatrix(float x,float z) {
    Mat4 r{};
    // Mesma transformação do original: Plane XY + rotation.x=-PI/2 + translate no nível do mar.
    r.m[0]=1.0f;
    r.m[6]=-1.0f;
    r.m[9]=1.0f;
    r.m[12]=x;
    r.m[13]=0.0f;
    r.m[14]=z;
    r.m[15]=1.0f;
    return r;
}

Mat4 textureBiasMatrix() {
    Mat4 r{};
    r.m[0]=0.5f;
    r.m[5]=0.5f;
    r.m[10]=0.5f;
    r.m[12]=0.5f;
    r.m[13]=0.5f;
    r.m[14]=0.5f;
    r.m[15]=1.0f;
    return r;
}

float srgbLinearChannel(float v){
    return v<=0.04045f?v/12.92f:std::pow((v+0.055f)/1.055f,2.4f);
}

Vec3 linearHex(uint32_t rgb){
    return {
        srgbLinearChannel(((rgb>>16)&255u)/255.0f),
        srgbLinearChannel(((rgb>>8)&255u)/255.0f),
        srgbLinearChannel((rgb&255u)/255.0f)
    };
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
    float px=0,py=0,pz=0;
    float nx=0,ny=1,nz=0;
    float r=1,g=1,b=1;
    float wallX=99,wallY=99,wallZ=0;
    float morph=0;
    float u=0,v=0;
    float treeX=0,treeY=0,treeType=0,treeScale=0;
};

struct WaterVertex {
    float x=0,y=0,z=0;
    float u=0,v=0;
};

struct WaterMeshCpu {
    std::vector<WaterVertex> vertices;
    std::vector<uint32_t> indices;
};

struct SkyVertex {
    float x=0,y=0,z=0;
};

struct SkyMeshCpu {
    std::vector<SkyVertex> vertices;
    std::vector<uint32_t> indices;
};

struct alignas(16) SkyUniformsGpu {
    Mat4 model{};
    Mat4 viewProj{};
    float sunDirTime[4]{};
    float moonDirStar[4]{};
    float zenithColor[4]{};
    float horizonColor[4]{};
    float groundColor[4]{};
    float cloudColor[4]{};
    float cloudShadowColor[4]{};
    float sunColor[4]{};
    float coronaColor[4]{};
    float fogColorMoon[4]{};
    float coveragePixel[4]{};
    float windOffsets[4]{};
    float cameraPos[4]{};
};

struct alignas(16) WaterUniformsGpu {
    Mat4 model{};
    Mat4 viewProj{};
    Mat4 reflectTextureMatrix{};
    float cameraPosTime[4]{};
    float waterParams0[4]{}; // waveHeight, frequency, speed, foamAmount
    float waterParams1[4]{}; // flowSpeed, windAngle, opacity, foamDistance
    float deepColor[4]{};
    float shallowColor[4]{};
    float foamColor[4]{};
    float crestColor[4]{};
    float lightDirMode[4]{}; // xyz + isOrthographic
    float fogColorNear[4]{};
    float fogSunColorFar[4]{};
    float fogSunDirOn[4]{};
    float resolutionTexel[4]{};
    float biomeOriginSpanReady[4]{};
    float cameraNearFarActive[4]{};
    float ripples[8][4]{};
};

struct InstanceGPU {
    float m[16];
    float r,g,b,a;
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
    LOG_PROP,
    FERN_PROP,
    REED_PROP,
    DEAD_TREE_PROP,
    MESH_KIND_COUNT
};

struct ObjectSeed {
    float x=0,y=0,z=0,scale=1,rotation=0;
    float r=1,g=1,b=1;
    int kind=TREE_LOD0;
    int planType=-1;
    std::array<float,16> matrix{};
    bool exactMatrix=false;
};

struct ChunkVegetationNative {
    bool detail=false;
    std::vector<ObjectSeed> objects;
};

struct WorldData {
    std::vector<Vertex> terrainVertices;
    std::vector<uint32_t> terrainIndices;
    std::vector<ObjectSeed> objects;

    // Atlas 13x13 do Terrain Texture Forge original.
    // Cada slot reserva 112px (64m * 1.75 tx/m); slots distantes usam somente 80px.
    std::vector<uint8_t> terrainTexture;
    uint32_t terrainTextureWidth=0;
    uint32_t terrainTextureHeight=0;
    float terrainTextureOriginX=0;
    float terrainTextureOriginZ=0;

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


int nativeKindForPlanType(int type) {
    if (type >= 0 && type <= 16) return TREE_LOD0;
    if (type == 17) return DEAD_TREE_PROP;
    if (type == 18 || type == 19) return CACTUS;
    if (type == 20 || type == 21) return SHRUB;
    if (type >= 22 && type <= 26) return ROCK;
    if (type >= 27 && type <= 30) return LOG_PROP;
    if (type == 31) return FERN_PROP;
    if (type == 32) return FLOWER;
    if (type == 33) return REED_PROP;
    return ROCK;
}

static const std::array<const char*,30> PIXEL_TREE_PRESETS = {
    "hyrule_oak","korok_ancient","hyrule_oak_sapling","hebra_pine","hebra_pine_sapling",
    "akkala_birch","akkala_birch_sapling","faron_palm","faron_palm_sapling",
    "savanna_acacia","savanna_acacia_sapling","maple_red","maple_orange","maple_yellow",
    "swamp_mangrove","swamp_mangrove_sapling","hebra_pine_snowy","arctic_willow",
    "dry_withered","gerudo_cactus","gerudo_cactus_sapling","hyrule_shrub","berry_shrub",
    "hollow_log","rooted_log","tree_stump","fallen_log","fern_plant","wildflower_patch","reed_clump"
};

int nearestMaplePreset(float r,float g,float b){
    struct C{float r,g,b;int id;};
    const C c[3]={
        {0xd4/255.0f,0x40/255.0f,0x22/255.0f,11},
        {0xe8/255.0f,0x7a/255.0f,0x1a/255.0f,12},
        {0xe8/255.0f,0xb8/255.0f,0x24/255.0f,13}
    };
    int best=11;float bestD=1e9f;
    for(const auto& x:c){
        const float dr=r-x.r,dg=g-x.g,db=b-x.b;
        const float d=dr*dr+dg*dg+db*db;
        if(d<bestD){bestD=d;best=x.id;}
    }
    return best;
}

int pixelPresetForPlanType(int type,float r,float g,float b){
    switch(type){
        case 0:return 0;   // hyrule_oak
        case 1:return 1;   // korok_ancient
        case 2:return 2;
        case 3:return 3;
        case 4:return 4;
        case 5:
        case 6:return 5;   // birch + twin birch
        case 7:return 6;
        case 8:return 7;
        case 9:return 8;
        case 10:return 9;
        case 11:return 10;
        case 12:return nearestMaplePreset(r,g,b);
        case 13:return 14;
        case 14:return 15;
        case 15:return 16;
        case 16:return 17;
        case 17:return 18;
        case 18:return 19;
        case 19:return 20;
        case 20:return 21;
        case 21:return 22;
        case 27:return 23;
        case 28:return 24;
        case 29:return 25;
        case 30:return 26;
        case 31:return 27;
        case 32:return 28;
        case 33:return 29;
        default:return -1; // rocks ficam no sistema leve original do Pixel-Island
    }
}

void logLine(const std::string& text);

WorldData generateWorldExact(JsWorldRuntime& js, int centerX, int centerZ) {
    logLine("WORLD: inicio center="+std::to_string(centerX)+","+std::to_string(centerZ));
    WorldData w;
    w.centerX=centerX;
    w.centerZ=centerZ;

    constexpr int terrainStride=12;
    const auto terrain=js.generateTerrain(
        WORLD_SEED_TEXT,
        static_cast<double>(centerX),
        static_cast<double>(centerZ),
        TERRAIN_SEGMENTS,
        TERRAIN_SIZE
    );

    logLine("WORLD: terreno/hidrologia/biomas concluido");
    const int side=TERRAIN_SEGMENTS+1;
    const size_t expected=static_cast<size_t>(side)*side*terrainStride;
    if(terrain.size()!=expected) throw std::runtime_error("Buffer de terreno original com tamanho inesperado.");

    w.terrainVertices.resize(static_cast<size_t>(side)*side);
    for(size_t i=0;i<w.terrainVertices.size();++i){
        const float* p=&terrain[i*terrainStride];
        // p: x,y,z,nx,ny,nz,r,g,b,isWater,isLava,biome
        Vec3 color{p[6],p[7],p[8]};
        if(p[9]>0.5f){
            // O material final de água ainda será portado; mantém a paleta aquática original por enquanto.
            const bool deep=p[1]<-8.0f;
            color=deep?Vec3{0.078f,0.22f,0.34f}:Vec3{0.145f,0.47f,0.55f};
        }
        if(p[10]>0.5f) color={1.0f,0.27f,0.0f};
        w.terrainVertices[i]={p[0],p[1],p[2],p[3],p[4],p[5],color.x,color.y,color.z};
    }

    w.terrainIndices.reserve(static_cast<size_t>(TERRAIN_SEGMENTS)*TERRAIN_SEGMENTS*6);
    for(int z=0;z<TERRAIN_SEGMENTS;++z){
        for(int x=0;x<TERRAIN_SEGMENTS;++x){
            const uint32_t i0=static_cast<uint32_t>(z*side+x);
            const uint32_t i1=i0+1;
            const uint32_t i2=i0+static_cast<uint32_t>(side);
            const uint32_t i3=i2+1;
            w.terrainIndices.insert(w.terrainIndices.end(),{i0,i2,i1,i1,i2,i3});
        }
    }

    // Textura pixel-art: chama o Terrain Texture Forge ORIGINAL por chunk.
    // O atlas mantém o grid de chunks do jogo para que o fragment shader possa localizar
    // exatamente a textura correspondente a cada coordenada do mundo.
    constexpr int atlasRadius=6;
    constexpr int atlasGrid=atlasRadius*2+1;
    constexpr int atlasSlotPx=112; // round(64 * 1.75)
    constexpr int atlasOuterPx=80; // round(64 * 1.25)
    constexpr int atlasSizePx=atlasGrid*atlasSlotPx;
    constexpr double chunkSize=64.0;

    const int centerCx=static_cast<int>(std::round(centerX/chunkSize));
    const int centerCz=static_cast<int>(std::round(centerZ/chunkSize));

    w.terrainTextureWidth=atlasSizePx;
    w.terrainTextureHeight=atlasSizePx;
    w.terrainTexture.assign(static_cast<size_t>(atlasSizePx)*atlasSizePx*4u,0);
    w.terrainTextureOriginX=static_cast<float>((centerCx-atlasRadius)*chunkSize-chunkSize*0.5);
    w.terrainTextureOriginZ=static_cast<float>((centerCz-atlasRadius)*chunkSize-chunkSize*0.5);

    logLine("WORLD: iniciando Terrain Texture Forge 13x13");
    for(int gz=0;gz<atlasGrid;++gz){
        logLine("WORLD: textura linha "+std::to_string(gz+1)+"/13");
        for(int gx=0;gx<atlasGrid;++gx){
            const int cx=centerCx-atlasRadius+gx;
            const int cz=centerCz-atlasRadius+gz;
            const int dx=cx-centerCx,dz=cz-centerCz;
            const int ring=std::max(std::abs(dx),std::abs(dz));
            const double density=ring<=1?1.75:1.25;
            const int srcPx=ring<=1?atlasSlotPx:atlasOuterPx;

            const double minX=cx*chunkSize-chunkSize*0.5;
            const double minZ=cz*chunkSize-chunkSize*0.5;
            const auto tex=js.generateChunkTexture(WORLD_SEED_TEXT,minX,minZ,chunkSize,density);
            const size_t expectedTex=static_cast<size_t>(srcPx)*srcPx*4u;
            if(tex.size()!=expectedTex) throw std::runtime_error("Terrain Texture Forge retornou tamanho inesperado.");

            const int dstX=gx*atlasSlotPx;
            const int dstY=gz*atlasSlotPx;
            for(int y=0;y<srcPx;++y){
                const uint8_t* src=tex.data()+static_cast<size_t>(y)*srcPx*4u;
                uint8_t* dst=w.terrainTexture.data()+
                    (static_cast<size_t>(dstY+y)*atlasSizePx+dstX)*4u;
                std::memcpy(dst,src,static_cast<size_t>(srcPx)*4u);
            }
        }
    }

    logLine("WORLD: Terrain Texture Forge concluido");
    // Mesmas coordenadas de chunk da versão original: centro = (cx,cz) * 64.
    const double half=TERRAIN_SIZE*0.5;
    const int minCx=static_cast<int>(std::ceil((centerX-half)/chunkSize));
    const int maxCx=static_cast<int>(std::floor((centerX+half)/chunkSize));
    const int minCz=static_cast<int>(std::ceil((centerZ-half)/chunkSize));
    const int maxCz=static_cast<int>(std::floor((centerZ+half)/chunkSize));

    constexpr int vegStride=23;
    w.objects.reserve(30000);

    logLine("WORLD: iniciando VegetationPlanner");
    for(int cz=minCz;cz<=maxCz;++cz){
        for(int cx=minCx;cx<=maxCx;++cx){
            // Mesmo raio circular do ChunkManager do preset "integrada fraca":
            // vegetação = 3 chunks; flora detalhada/grama = 1 chunk.
            const int dx=cx-static_cast<int>(std::round(centerX/chunkSize));
            const int dz=cz-static_cast<int>(std::round(centerZ/chunkSize));
            const int distSq=dx*dx+dz*dz;
            if(distSq>9) continue;
            const bool detail=distSq<=1;

            const auto veg=js.generateVegetation(WORLD_SEED_TEXT,cx,cz,chunkSize,detail);
            if(veg.size()%vegStride!=0) throw std::runtime_error("Buffer de vegetacao original invalido.");

            for(size_t o=0;o<veg.size();o+=vegStride){
                const int planType=static_cast<int>(std::round(veg[o]));
                ObjectSeed obj{};
                obj.kind=nativeKindForPlanType(planType);
                for(int k=0;k<16;k++) obj.matrix[k]=veg[o+1+k];
                obj.exactMatrix=true;
                obj.x=obj.matrix[12];obj.y=obj.matrix[13];obj.z=obj.matrix[14];

                // Tint principal. Para árvores com folha separada, o asset final Pixel_Tree usará
                // tint de tronco/folha individualmente; a malha provisória usa leaf tint.
                const bool treePlan=planType>=0&&planType<=16;
                const size_t tintOff=17;
                const size_t leafOff=20;
                obj.r=veg[o+(treePlan?leafOff:tintOff)+0];
                obj.g=veg[o+(treePlan?leafOff:tintOff)+1];
                obj.b=veg[o+(treePlan?leafOff:tintOff)+2];
                w.objects.push_back(obj);
            }
        }
    }
    logLine("WORLD: concluido; objetos="+std::to_string(w.objects.size()));
    return w;
}

class WorldStreamer {
public:
    explicit WorldStreamer(std::filesystem::path scriptPath)
        : scriptPath_(std::move(scriptPath)), worker_([this]{ run(); }) {}
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

    bool takeError(std::string& out) {
        std::lock_guard<std::mutex> lock(m_);
        if (!error_) return false;
        out=*error_;
        error_.reset();
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
            try {
                if(!js_) {
                    logLine("WORKER: carregando world.bundle.js");
                    js_=std::make_unique<JsWorldRuntime>(scriptPath_);
                    logLine("WORKER: QuickJS pronto");
                }
                WorldData data = generateWorldExact(*js_,x,z);
                {
                    std::lock_guard<std::mutex> lock(m_);
                    if (!requested_ || (x==reqX_ && z==reqZ_)) ready_ = std::move(data);
                }
            } catch(const std::exception& ex) {
                logLine(std::string("WORKER ERRO: ")+ex.what());
                std::lock_guard<std::mutex> lock(m_);
                error_=ex.what();
            }
        }
    }

    std::filesystem::path scriptPath_;
    std::unique_ptr<JsWorldRuntime> js_;
    std::thread worker_;
    std::mutex m_;
    std::condition_variable cv_;
    bool stop_=false, requested_=false;
    int reqX_=0, reqZ_=0;
    std::optional<WorldData> ready_;
    std::optional<std::string> error_;
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

SkyMeshCpu buildOriginalSkySphere(){
    SkyMeshCpu out;
    constexpr float radius=1500.0f;
    constexpr int widthSegments=64;
    constexpr int heightSegments=48;

    std::vector<std::vector<uint32_t>> grid(heightSegments+1);
    uint32_t index=0;
    for(int iy=0;iy<=heightSegments;iy++){
        grid[iy].reserve(widthSegments+1);
        const float v=static_cast<float>(iy)/heightSegments;
        const float theta=v*PI;
        for(int ix=0;ix<=widthSegments;ix++){
            const float u=static_cast<float>(ix)/widthSegments;
            const float phi=u*PI*2.0f;
            SkyVertex sv{};
            sv.x=-radius*std::cos(phi)*std::sin(theta);
            sv.y= radius*std::cos(theta);
            sv.z= radius*std::sin(phi)*std::sin(theta);
            out.vertices.push_back(sv);
            grid[iy].push_back(index++);
        }
    }

    for(int iy=0;iy<heightSegments;iy++){
        for(int ix=0;ix<widthSegments;ix++){
            const uint32_t a=grid[iy][ix+1];
            const uint32_t b=grid[iy][ix];
            const uint32_t cc=grid[iy+1][ix];
            const uint32_t d=grid[iy+1][ix+1];
            if(iy!=0) out.indices.insert(out.indices.end(),{a,b,d});
            if(iy!=heightSegments-1) out.indices.insert(out.indices.end(),{b,cc,d});
        }
    }
    return out;
}

WaterMeshCpu buildOriginalWaterMesh() {
    WaterMeshCpu out;
    auto pushVertex=[&](float x,float y,float u,float v){
        out.vertices.push_back({x,y,0.0f,u,v});
    };

    // createSeamlessCascadedWaterGeometry() original.
    constexpr int innerHalf=512;
    constexpr int innerSegs=128;
    constexpr float step=(innerHalf*2.0f)/innerSegs;

    for(int j=0;j<=innerSegs;j++){
        const float y=-innerHalf+j*step;
        for(int i=0;i<=innerSegs;i++){
            const float x=-innerHalf+i*step;
            pushVertex(x,y,static_cast<float>(i)/innerSegs,static_cast<float>(j)/innerSegs);
        }
    }

    const int row=innerSegs+1;
    for(int j=0;j<innerSegs;j++){
        for(int i=0;i<innerSegs;i++){
            const uint32_t a=j*row+i;
            const uint32_t b=j*row+i+1;
            const uint32_t cc=(j+1)*row+i;
            const uint32_t d=(j+1)*row+i+1;
            out.indices.insert(out.indices.end(),{a,b,cc,b,d,cc});
        }
    }

    struct Ring{int inR,outR,segs;};
    const Ring rings[]={{512,1024,128},{1024,2048,64},{2048,4096,32},{4096,8192,16}};
    for(const auto& ring:rings){
        const uint32_t base=static_cast<uint32_t>(out.vertices.size());
        std::vector<std::pair<float,float>> inner,outer;
        inner.reserve(ring.segs*4);outer.reserve(ring.segs*4);
        for(int edge=0;edge<4;edge++){
            for(int st=0;st<ring.segs;st++){
                const float t=static_cast<float>(st)/ring.segs;
                float xi=0,yi=0,xo=0,yo=0;
                if(edge==0){
                    xi=-ring.inR+t*(2.0f*ring.inR);yi=-ring.inR;
                    xo=-ring.outR+t*(2.0f*ring.outR);yo=-ring.outR;
                }else if(edge==1){
                    xi=ring.inR;yi=-ring.inR+t*(2.0f*ring.inR);
                    xo=ring.outR;yo=-ring.outR+t*(2.0f*ring.outR);
                }else if(edge==2){
                    xi=ring.inR-t*(2.0f*ring.inR);yi=ring.inR;
                    xo=ring.outR-t*(2.0f*ring.outR);yo=ring.outR;
                }else{
                    xi=-ring.inR;yi=ring.inR-t*(2.0f*ring.inR);
                    xo=-ring.outR;yo=ring.outR-t*(2.0f*ring.outR);
                }
                inner.emplace_back(xi,yi);
                outer.emplace_back(xo,yo);
            }
        }
        const uint32_t count=static_cast<uint32_t>(inner.size());
        for(auto [x,y]:inner)pushVertex(x,y,0.5f,0.5f);
        for(auto [x,y]:outer)pushVertex(x,y,0.5f,0.5f);
        for(uint32_t i=0;i<count;i++){
            const uint32_t next=(i+1)%count;
            const uint32_t inCur=base+i,inNext=base+next;
            const uint32_t outCur=base+count+i,outNext=base+count+next;
            out.indices.insert(out.indices.end(),{inCur,outCur,inNext,inNext,outCur,outNext});
        }
    }
    return out;
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


std::mutex gLogMutex;
std::ofstream gLog;

std::string nowStamp() {
    using namespace std::chrono;
    const auto now=system_clock::now();
    const auto tt=system_clock::to_time_t(now);
    std::tm tm{};
    localtime_s(&tm,&tt);
    char buf[32]{};
    std::strftime(buf,sizeof(buf),"%H:%M:%S",&tm);
    return buf;
}

void initLog() {
    const std::filesystem::path path=std::filesystem::path(executableDir())/L"PixelIslandNative.log";
    gLog.open(path,std::ios::out|std::ios::trunc);
    if(gLog) {
        gLog<<"["<<nowStamp()<<"] Pixel Island Native iniciado\n";
        gLog.flush();
    }
}

void logLine(const std::string& msg) {
    std::lock_guard<std::mutex> lock(gLogMutex);
    if(gLog) {
        gLog<<"["<<nowStamp()<<"] "<<msg<<"\n";
        gLog.flush();
    }
    OutputDebugStringA((msg+"\n").c_str());
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

struct WaterMeshGpu {
    Buffer vb;
    Buffer ib;
    uint32_t indexCount=0;
};

struct SkyMeshGpu {
    Buffer vb;
    Buffer ib;
    uint32_t indexCount=0;
};

struct TextureGpu {
    VkImage image=VK_NULL_HANDLE;
    VkDeviceMemory memory=VK_NULL_HANDLE;
    VkImageView view=VK_NULL_HANDLE;
    uint32_t width=0,height=0;
};

struct SceneTargetGpu {
    TextureGpu color;
    VkImage depth=VK_NULL_HANDLE;
    VkDeviceMemory depthMemory=VK_NULL_HANDLE;
    VkImageView depthView=VK_NULL_HANDLE;
    VkFramebuffer framebuffer=VK_NULL_HANDLE;
    uint32_t width=0,height=0;
};

struct ExactChunkGpu {
    int cx=0,cz=0,segments=0;
    float density=1.0f;
    GpuMesh mesh;
    TextureGpu texture;
    VkDescriptorSet descriptor=VK_NULL_HANDLE;
    std::vector<float> heights;
};

struct HorizonGpu {
    int level=0,tx=0,tz=0;
    float inner=0,outer=0;
    GpuMesh mesh;
};

struct ImpostorBlockGpu {
    int tx=0,tz=0;
    float minX=0,minZ=0,size=0;
    GpuMesh mesh;
};

struct alignas(16) ImpostorInfoGpu {
    float v[16][4]{};
};

struct PixelTreePartGpu {
    std::string name;
    GpuMesh mesh;
    TextureGpu texture;
    VkDescriptorSet descriptor=VK_NULL_HANDLE;
    float repeatX=1.0f,repeatY=1.0f;
    float alphaTest=0.0f;
    bool flipY=false;
    bool castShadow=false;
};

struct PixelTreeAssetGpu {
    uint16_t presetId=0;
    uint16_t variant=0;
    std::vector<PixelTreePartGpu> parts;
    Buffer instanceBuffer;
    std::vector<InstanceGPU> visible;
};

struct PushConstants {
    Mat4 viewProj;
    float cameraFog[4];
    float sunAmbient[4];
    float environment[4];
    float terrain[4];
};

class VulkanApp {
public:
    void run(HINSTANCE hInstance) {
        logLine("APP: criando janela");
        createWindow(hInstance);
        SetWindowTextW(hwnd_,L"Pixel Island Native | Carregando chunk central...");
        logLine("APP: inicializando Vulkan");
        initVulkan();
        logLine("APP: criando recursos GPU");
        createGpuWorldResources();

        const std::filesystem::path bundle=std::filesystem::path(executableDir())/L"world.bundle.js";
        loadOriginalSpawn();
        logLine("APP: iniciando streaming exato de chunks/horizon");
        exactStreamer_=std::make_unique<ExactStreamingWorker>(bundle);
        horizonStreamer_=std::make_unique<ExactStreamingWorker>(bundle);
        planExactStreaming(spawnX_,spawnZ_,true);

        mainLoop();
        vkDeviceWaitIdle(device_);
    }

    ~VulkanApp() {
        horizonStreamer_.reset();
        exactStreamer_.reset();
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
            case WM_KEYDOWN:
                if(app && wp<256) app->input_.keys[static_cast<size_t>(wp)]=true;
                return 0;
            case WM_SYSKEYDOWN:
                if(wp==VK_F4 && (GetKeyState(VK_MENU)&0x8000)) return DefWindowProcW(hwnd,msg,wp,lp);
                if(app && wp<256) app->input_.keys[static_cast<size_t>(wp)]=true;
                return 0;
            case WM_KEYUP:
            case WM_SYSKEYUP:
                if(app && wp<256) app->input_.keys[static_cast<size_t>(wp)]=false;
                return 0;
            case WM_MOUSEWHEEL:
                if(app) app->input_.wheelDelta += -static_cast<float>(GET_WHEEL_DELTA_WPARAM(wp)) * (100.0f/120.0f);
                return 0;
            case WM_LBUTTONDOWN:
            case WM_MBUTTONDOWN:
            case WM_RBUTTONDOWN:
                if(app){
                    SetCapture(hwnd);
                    const int x=static_cast<int>(static_cast<short>(LOWORD(lp))),y=static_cast<int>(static_cast<short>(HIWORD(lp)));
                    app->input_.mouseX=x;app->input_.mouseY=y;
                    if(msg==WM_LBUTTONDOWN)app->input_.leftDown=true;
                    if(msg==WM_MBUTTONDOWN)app->input_.middleDown=true;
                    if(msg==WM_RBUTTONDOWN)app->input_.rightDown=true;
                }
                return 0;
            case WM_LBUTTONUP:
            case WM_MBUTTONUP:
            case WM_RBUTTONUP:
                if(app){
                    if(msg==WM_LBUTTONUP)app->input_.leftDown=false;
                    if(msg==WM_MBUTTONUP)app->input_.middleDown=false;
                    if(msg==WM_RBUTTONUP)app->input_.rightDown=false;
                    if(!app->input_.leftDown&&!app->input_.middleDown&&!app->input_.rightDown)ReleaseCapture();
                }
                return 0;
            case WM_MOUSEMOVE:
                if(app){
                    const int x=static_cast<int>(static_cast<short>(LOWORD(lp))),y=static_cast<int>(static_cast<short>(HIWORD(lp)));
                    const int dx=x-app->input_.mouseX,dy=y-app->input_.mouseY;
                    app->input_.mouseX=x;app->input_.mouseY=y;
                    if(app->observerMode_){
                        if(app->input_.rightDown)app->input_.rotateDeltaX+=static_cast<float>(dx);
                        if(app->input_.leftDown||app->input_.middleDown){
                            app->input_.panDeltaX+=static_cast<float>(dx);
                            app->input_.panDeltaY+=static_cast<float>(dy);
                        }
                    }else{
                        if(app->input_.leftDown){
                            app->input_.lookDeltaX+=static_cast<float>(dx);
                            app->input_.lookDeltaY+=static_cast<float>(dy);
                        }
                    }
                }
                return 0;
            case WM_KILLFOCUS:
                if(app){
                    app->input_.keys.fill(false);
                    app->input_.leftDown=app->input_.middleDown=app->input_.rightDown=false;
                    app->input_.clearTransient();
                    ReleaseCapture();
                }
                return 0;
            case WM_SIZE:
                if(app) app->framebufferResized_=true;
                return 0;
            case WM_CLOSE:
                DestroyWindow(hwnd);
                return 0;
            case WM_PAINT:
                if(app && !app->worldReady_) {
                    PAINTSTRUCT ps{};
                    HDC dc=BeginPaint(hwnd,&ps);
                    RECT rc{};GetClientRect(hwnd,&rc);
                    HBRUSH bg=CreateSolidBrush(RGB(24,28,34));
                    FillRect(dc,&rc,bg);
                    DeleteObject(bg);
                    SetBkMode(dc,TRANSPARENT);
                    SetTextColor(dc,RGB(230,235,240));
                    RECT titleRc=rc;
                    DrawTextW(dc,L"Pixel Island Native",-1,&titleRc,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
                    RECT subRc=rc; subRc.top+=52;
                    DrawTextW(dc,L"Gerando o mundo original... veja PixelIslandNative.log",-1,&subRc,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
                    EndPaint(hwnd,&ps);
                    return 0;
                }
                break;
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
        wc.hbrBackground=CreateSolidBrush(RGB(24,28,34));
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
        createDescriptorSetLayout();
        createSwapchain();
        createRenderPass();
        createPipeline();
        createDepthResources();
        createFramebuffers();
        createCommandPool();
        createCommandBuffers();
        createSyncObjects();

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

    void createDescriptorSetLayout() {
        std::array<VkDescriptorSetLayoutBinding,3> bindings{};
        for(uint32_t i=0;i<2;i++){
            bindings[i].binding=i;
            bindings[i].descriptorType=VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
            bindings[i].descriptorCount=1;
            bindings[i].stageFlags=VK_SHADER_STAGE_FRAGMENT_BIT;
        }
        bindings[2].binding=2;
        bindings[2].descriptorType=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
        bindings[2].descriptorCount=1;
        bindings[2].stageFlags=VK_SHADER_STAGE_VERTEX_BIT;

        VkDescriptorSetLayoutCreateInfo ci{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
        ci.bindingCount=static_cast<uint32_t>(bindings.size());
        ci.pBindings=bindings.data();
        check(vkCreateDescriptorSetLayout(device_,&ci,nullptr,&descriptorSetLayout_),"vkCreateDescriptorSetLayout");

        VkDescriptorSetLayoutBinding blitBinding{};
        blitBinding.binding=0;
        blitBinding.descriptorType=VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        blitBinding.descriptorCount=1;
        blitBinding.stageFlags=VK_SHADER_STAGE_FRAGMENT_BIT;
        VkDescriptorSetLayoutCreateInfo bci{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
        bci.bindingCount=1;
        bci.pBindings=&blitBinding;
        check(vkCreateDescriptorSetLayout(device_,&bci,nullptr,&blitDescriptorSetLayout_),"vkCreateDescriptorSetLayout(blit)");

        std::array<VkDescriptorSetLayoutBinding,4> waterBindings{};
        for(uint32_t i=0;i<3;i++){
            waterBindings[i].binding=i;
            waterBindings[i].descriptorType=VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
            waterBindings[i].descriptorCount=1;
            waterBindings[i].stageFlags=VK_SHADER_STAGE_FRAGMENT_BIT|(i==2?VK_SHADER_STAGE_VERTEX_BIT:0);
        }
        waterBindings[3].binding=3;
        waterBindings[3].descriptorType=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
        waterBindings[3].descriptorCount=1;
        waterBindings[3].stageFlags=VK_SHADER_STAGE_VERTEX_BIT|VK_SHADER_STAGE_FRAGMENT_BIT;
        VkDescriptorSetLayoutCreateInfo wci{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
        wci.bindingCount=static_cast<uint32_t>(waterBindings.size());
        wci.pBindings=waterBindings.data();
        check(vkCreateDescriptorSetLayout(device_,&wci,nullptr,&waterDescriptorSetLayout_),"vkCreateDescriptorSetLayout(water)");

        VkDescriptorSetLayoutBinding skyBinding{};
        skyBinding.binding=0;
        skyBinding.descriptorType=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
        skyBinding.descriptorCount=1;
        skyBinding.stageFlags=VK_SHADER_STAGE_VERTEX_BIT|VK_SHADER_STAGE_FRAGMENT_BIT;
        VkDescriptorSetLayoutCreateInfo sci{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
        sci.bindingCount=1;
        sci.pBindings=&skyBinding;
        check(vkCreateDescriptorSetLayout(device_,&sci,nullptr,&skyDescriptorSetLayout_),"vkCreateDescriptorSetLayout(sky)");
    }

    VkSurfaceFormatKHR chooseFormat(const std::vector<VkSurfaceFormatKHR>& f) {
        // O blit original já escreve sRGB explicitamente; UNORM evita uma segunda conversão.
        for(auto x:f) if(x.format==VK_FORMAT_B8G8R8A8_UNORM&&x.colorSpace==VK_COLOR_SPACE_SRGB_NONLINEAR_KHR) return x;
        for(auto x:f) if(x.format==VK_FORMAT_R8G8B8A8_UNORM&&x.colorSpace==VK_COLOR_SPACE_SRGB_NONLINEAR_KHR) return x;
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
        sceneColorFormat_=VK_FORMAT_R8G8B8A8_UNORM;

        // Passo opaco/reflexão: render target linear + depth amostrável.
        {
            VkAttachmentDescription color{};
            color.format=sceneColorFormat_;
            color.samples=VK_SAMPLE_COUNT_1_BIT;
            color.loadOp=VK_ATTACHMENT_LOAD_OP_CLEAR;
            color.storeOp=VK_ATTACHMENT_STORE_OP_STORE;
            color.initialLayout=VK_IMAGE_LAYOUT_UNDEFINED;
            color.finalLayout=VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

            VkAttachmentDescription depth{};
            depth.format=depthFormat_;
            depth.samples=VK_SAMPLE_COUNT_1_BIT;
            depth.loadOp=VK_ATTACHMENT_LOAD_OP_CLEAR;
            depth.storeOp=VK_ATTACHMENT_STORE_OP_STORE;
            depth.stencilLoadOp=VK_ATTACHMENT_LOAD_OP_DONT_CARE;
            depth.stencilStoreOp=VK_ATTACHMENT_STORE_OP_DONT_CARE;
            depth.initialLayout=VK_IMAGE_LAYOUT_UNDEFINED;
            depth.finalLayout=VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL;

            VkAttachmentReference colorRef{0,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
            VkAttachmentReference depthRef{1,VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL};
            VkSubpassDescription sub{};
            sub.pipelineBindPoint=VK_PIPELINE_BIND_POINT_GRAPHICS;
            sub.colorAttachmentCount=1;
            sub.pColorAttachments=&colorRef;
            sub.pDepthStencilAttachment=&depthRef;

            std::array<VkAttachmentDescription,2> at{color,depth};
            std::array<VkSubpassDependency,2> deps{};
            deps[0].srcSubpass=VK_SUBPASS_EXTERNAL;
            deps[0].dstSubpass=0;
            deps[0].srcStageMask=VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT|VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
            deps[0].dstStageMask=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT|VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
            deps[0].srcAccessMask=VK_ACCESS_SHADER_READ_BIT;
            deps[0].dstAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT|VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;

            deps[1].srcSubpass=0;
            deps[1].dstSubpass=VK_SUBPASS_EXTERNAL;
            deps[1].srcStageMask=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT|VK_PIPELINE_STAGE_LATE_FRAGMENT_TESTS_BIT;
            deps[1].dstStageMask=VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
            deps[1].srcAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT|VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;
            deps[1].dstAccessMask=VK_ACCESS_SHADER_READ_BIT;

            VkRenderPassCreateInfo ci{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
            ci.attachmentCount=static_cast<uint32_t>(at.size());
            ci.pAttachments=at.data();
            ci.subpassCount=1;
            ci.pSubpasses=&sub;
            ci.dependencyCount=static_cast<uint32_t>(deps.size());
            ci.pDependencies=deps.data();
            check(vkCreateRenderPass(device_,&ci,nullptr,&renderPass_),"vkCreateRenderPass(scene)");
        }

        // Passo final: canvas/swapchain. O opaco é blitado, depois a água é desenhada por cima.
        {
            VkAttachmentDescription color{};
            color.format=swapFormat_;
            color.samples=VK_SAMPLE_COUNT_1_BIT;
            color.loadOp=VK_ATTACHMENT_LOAD_OP_CLEAR;
            color.storeOp=VK_ATTACHMENT_STORE_OP_STORE;
            color.initialLayout=VK_IMAGE_LAYOUT_UNDEFINED;
            color.finalLayout=VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;

            VkAttachmentReference colorRef{0,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
            VkSubpassDescription sub{};
            sub.pipelineBindPoint=VK_PIPELINE_BIND_POINT_GRAPHICS;
            sub.colorAttachmentCount=1;
            sub.pColorAttachments=&colorRef;

            VkSubpassDependency dep{};
            dep.srcSubpass=VK_SUBPASS_EXTERNAL;
            dep.dstSubpass=0;
            dep.srcStageMask=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
            dep.dstStageMask=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
            dep.dstAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;

            VkRenderPassCreateInfo ci{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
            ci.attachmentCount=1;
            ci.pAttachments=&color;
            ci.subpassCount=1;
            ci.pSubpasses=&sub;
            ci.dependencyCount=1;
            ci.pDependencies=&dep;
            check(vkCreateRenderPass(device_,&ci,nullptr,&presentRenderPass_),"vkCreateRenderPass(present)");
        }
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

        std::array<VkVertexInputAttributeDescription,12> attrs{};
        attrs[0]={0,0,VK_FORMAT_R32G32B32_SFLOAT,offsetof(Vertex,px)};
        attrs[1]={1,0,VK_FORMAT_R32G32B32_SFLOAT,offsetof(Vertex,nx)};
        attrs[2]={2,0,VK_FORMAT_R32G32B32_SFLOAT,offsetof(Vertex,r)};
        attrs[3]={3,1,VK_FORMAT_R32G32B32A32_SFLOAT,offsetof(InstanceGPU,m)+sizeof(float)*0};
        attrs[4]={4,1,VK_FORMAT_R32G32B32A32_SFLOAT,offsetof(InstanceGPU,m)+sizeof(float)*4};
        attrs[5]={5,1,VK_FORMAT_R32G32B32A32_SFLOAT,offsetof(InstanceGPU,m)+sizeof(float)*8};
        attrs[6]={6,1,VK_FORMAT_R32G32B32A32_SFLOAT,offsetof(InstanceGPU,m)+sizeof(float)*12};
        attrs[7]={7,1,VK_FORMAT_R32G32B32A32_SFLOAT,offsetof(InstanceGPU,r)};
        attrs[8]={8,0,VK_FORMAT_R32G32B32_SFLOAT,offsetof(Vertex,wallX)};
        attrs[9]={9,0,VK_FORMAT_R32_SFLOAT,offsetof(Vertex,morph)};
        attrs[10]={10,0,VK_FORMAT_R32G32_SFLOAT,offsetof(Vertex,u)};
        attrs[11]={11,0,VK_FORMAT_R32G32B32A32_SFLOAT,offsetof(Vertex,treeX)};

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
            lci.setLayoutCount=1;
            lci.pSetLayouts=&descriptorSetLayout_;
            lci.pushConstantRangeCount=1;
            lci.pPushConstantRanges=&range;
            check(vkCreatePipelineLayout(device_,&lci,nullptr,&pipelineLayout_),"vkCreatePipelineLayout");
        }

        VkGraphicsPipelineCreateInfo ci{VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO};
        ci.stageCount=2; ci.pStages=stages; ci.pVertexInputState=&vi; ci.pInputAssemblyState=&ia;
        ci.pViewportState=&vp; ci.pRasterizationState=&rs; ci.pMultisampleState=&ms;
        ci.pDepthStencilState=&ds; ci.pColorBlendState=&blend; ci.pDynamicState=&dyn;
        ci.layout=pipelineLayout_; ci.renderPass=renderPass_; ci.subpass=0;
        check(vkCreateGraphicsPipelines(device_,VK_NULL_HANDLE,1,&ci,nullptr,&pipeline_),"vkCreateGraphicsPipelines");

        // Fullscreen blit: cena linear -> ACES 1.05 -> swapchain.
        {
            VkShaderModule bvs=shaderModule(dir+L"blit.vert.spv");
            VkShaderModule bfs=shaderModule(dir+L"blit.frag.spv");
            VkPipelineShaderStageCreateInfo bst[2]{};
            bst[0]={VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
            bst[0].stage=VK_SHADER_STAGE_VERTEX_BIT;bst[0].module=bvs;bst[0].pName="main";
            bst[1]={VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
            bst[1].stage=VK_SHADER_STAGE_FRAGMENT_BIT;bst[1].module=bfs;bst[1].pName="main";

            VkPipelineVertexInputStateCreateInfo bvi{VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
            VkPipelineDepthStencilStateCreateInfo bds{VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO};
            bds.depthTestEnable=VK_FALSE;bds.depthWriteEnable=VK_FALSE;

            if(blitPipelineLayout_==VK_NULL_HANDLE){
                VkPipelineLayoutCreateInfo lci{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
                lci.setLayoutCount=1;lci.pSetLayouts=&blitDescriptorSetLayout_;
                check(vkCreatePipelineLayout(device_,&lci,nullptr,&blitPipelineLayout_),"vkCreatePipelineLayout(blit)");
            }

            VkGraphicsPipelineCreateInfo pci=ci;
            pci.pStages=bst;
            pci.pVertexInputState=&bvi;
            pci.pDepthStencilState=&bds;
            pci.layout=blitPipelineLayout_;
            pci.renderPass=presentRenderPass_;
            check(vkCreateGraphicsPipelines(device_,VK_NULL_HANDLE,1,&pci,nullptr,&blitPipeline_),"vkCreateGraphicsPipelines(blit)");
            vkDestroyShaderModule(device_,bfs,nullptr);
            vkDestroyShaderModule(device_,bvs,nullptr);
        }

        // WaterShader original convertido automaticamente para Vulkan.
        {
            VkShaderModule wvs=shaderModule(dir+L"water.vert.spv");
            VkShaderModule wfs=shaderModule(dir+L"water.frag.spv");
            VkPipelineShaderStageCreateInfo wst[2]{};
            wst[0]={VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
            wst[0].stage=VK_SHADER_STAGE_VERTEX_BIT;wst[0].module=wvs;wst[0].pName="main";
            wst[1]={VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
            wst[1].stage=VK_SHADER_STAGE_FRAGMENT_BIT;wst[1].module=wfs;wst[1].pName="main";

            VkVertexInputBindingDescription wb{0,sizeof(WaterVertex),VK_VERTEX_INPUT_RATE_VERTEX};
            std::array<VkVertexInputAttributeDescription,2> wa{};
            wa[0]={0,0,VK_FORMAT_R32G32B32_SFLOAT,offsetof(WaterVertex,x)};
            wa[1]={1,0,VK_FORMAT_R32G32_SFLOAT,offsetof(WaterVertex,u)};
            VkPipelineVertexInputStateCreateInfo wvi{VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
            wvi.vertexBindingDescriptionCount=1;wvi.pVertexBindingDescriptions=&wb;
            wvi.vertexAttributeDescriptionCount=static_cast<uint32_t>(wa.size());wvi.pVertexAttributeDescriptions=wa.data();

            VkPipelineDepthStencilStateCreateInfo wds{VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO};
            wds.depthTestEnable=VK_FALSE;wds.depthWriteEnable=VK_FALSE;

            VkPipelineColorBlendAttachmentState watt{};
            watt.colorWriteMask=VK_COLOR_COMPONENT_R_BIT|VK_COLOR_COMPONENT_G_BIT|VK_COLOR_COMPONENT_B_BIT|VK_COLOR_COMPONENT_A_BIT;
            watt.blendEnable=VK_TRUE;
            watt.srcColorBlendFactor=VK_BLEND_FACTOR_SRC_ALPHA;
            watt.dstColorBlendFactor=VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
            watt.colorBlendOp=VK_BLEND_OP_ADD;
            watt.srcAlphaBlendFactor=VK_BLEND_FACTOR_ONE;
            watt.dstAlphaBlendFactor=VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
            watt.alphaBlendOp=VK_BLEND_OP_ADD;
            VkPipelineColorBlendStateCreateInfo wblend{VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO};
            wblend.attachmentCount=1;wblend.pAttachments=&watt;

            if(waterPipelineLayout_==VK_NULL_HANDLE){
                VkPipelineLayoutCreateInfo lci{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
                lci.setLayoutCount=1;lci.pSetLayouts=&waterDescriptorSetLayout_;
                check(vkCreatePipelineLayout(device_,&lci,nullptr,&waterPipelineLayout_),"vkCreatePipelineLayout(water)");
            }

            VkGraphicsPipelineCreateInfo pci=ci;
            pci.pStages=wst;
            pci.pVertexInputState=&wvi;
            pci.pDepthStencilState=&wds;
            pci.pColorBlendState=&wblend;
            pci.layout=waterPipelineLayout_;
            pci.renderPass=presentRenderPass_;
            check(vkCreateGraphicsPipelines(device_,VK_NULL_HANDLE,1,&pci,nullptr,&waterPipeline_),"vkCreateGraphicsPipelines(water)");
            vkDestroyShaderModule(device_,wfs,nullptr);
            vkDestroyShaderModule(device_,wvs,nullptr);
        }

        // CartoonSkybox original convertido automaticamente para Vulkan.
        {
            VkShaderModule svs=shaderModule(dir+L"sky.vert.spv");
            VkShaderModule sfs=shaderModule(dir+L"sky.frag.spv");
            VkPipelineShaderStageCreateInfo sst[2]{};
            sst[0]={VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
            sst[0].stage=VK_SHADER_STAGE_VERTEX_BIT;sst[0].module=svs;sst[0].pName="main";
            sst[1]={VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
            sst[1].stage=VK_SHADER_STAGE_FRAGMENT_BIT;sst[1].module=sfs;sst[1].pName="main";

            VkVertexInputBindingDescription sb{0,sizeof(SkyVertex),VK_VERTEX_INPUT_RATE_VERTEX};
            VkVertexInputAttributeDescription sa{0,0,VK_FORMAT_R32G32B32_SFLOAT,offsetof(SkyVertex,x)};
            VkPipelineVertexInputStateCreateInfo svi{VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
            svi.vertexBindingDescriptionCount=1;
            svi.pVertexBindingDescriptions=&sb;
            svi.vertexAttributeDescriptionCount=1;
            svi.pVertexAttributeDescriptions=&sa;

            VkPipelineRasterizationStateCreateInfo srs=rs;
            srs.cullMode=VK_CULL_MODE_FRONT_BIT;

            VkPipelineDepthStencilStateCreateInfo sds{VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO};
            sds.depthTestEnable=VK_TRUE;
            sds.depthWriteEnable=VK_FALSE;
            sds.depthCompareOp=VK_COMPARE_OP_LESS_OR_EQUAL;

            if(skyPipelineLayout_==VK_NULL_HANDLE){
                VkPipelineLayoutCreateInfo lci{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
                lci.setLayoutCount=1;
                lci.pSetLayouts=&skyDescriptorSetLayout_;
                check(vkCreatePipelineLayout(device_,&lci,nullptr,&skyPipelineLayout_),"vkCreatePipelineLayout(sky)");
            }

            VkGraphicsPipelineCreateInfo pci=ci;
            pci.pStages=sst;
            pci.pVertexInputState=&svi;
            pci.pRasterizationState=&srs;
            pci.pDepthStencilState=&sds;
            pci.layout=skyPipelineLayout_;
            pci.renderPass=renderPass_;
            check(vkCreateGraphicsPipelines(device_,VK_NULL_HANDLE,1,&pci,nullptr,&skyPipeline_),"vkCreateGraphicsPipelines(sky)");
            vkDestroyShaderModule(device_,sfs,nullptr);
            vkDestroyShaderModule(device_,svs,nullptr);
        }

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


    void createImage(
        uint32_t width,uint32_t height,VkFormat format,
        VkImageUsageFlags usage,VkImage& image,VkDeviceMemory& memory
    ) {
        VkImageCreateInfo ci{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
        ci.imageType=VK_IMAGE_TYPE_2D;
        ci.extent={width,height,1};
        ci.mipLevels=1;
        ci.arrayLayers=1;
        ci.format=format;
        ci.tiling=VK_IMAGE_TILING_OPTIMAL;
        ci.initialLayout=VK_IMAGE_LAYOUT_UNDEFINED;
        ci.usage=usage;
        ci.samples=VK_SAMPLE_COUNT_1_BIT;
        ci.sharingMode=VK_SHARING_MODE_EXCLUSIVE;
        check(vkCreateImage(device_,&ci,nullptr,&image),"vkCreateImage(texture)");

        VkMemoryRequirements req{};
        vkGetImageMemoryRequirements(device_,image,&req);
        VkMemoryAllocateInfo ai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        ai.allocationSize=req.size;
        ai.memoryTypeIndex=memoryType(req.memoryTypeBits,VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
        check(vkAllocateMemory(device_,&ai,nullptr,&memory),"vkAllocateMemory(texture)");
        check(vkBindImageMemory(device_,image,memory,0),"vkBindImageMemory(texture)");
    }

    VkImageView createColorImageView(VkImage image,VkFormat format) {
        VkImageViewCreateInfo vi{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        vi.image=image;
        vi.viewType=VK_IMAGE_VIEW_TYPE_2D;
        vi.format=format;
        vi.subresourceRange.aspectMask=VK_IMAGE_ASPECT_COLOR_BIT;
        vi.subresourceRange.baseMipLevel=0;
        vi.subresourceRange.levelCount=1;
        vi.subresourceRange.baseArrayLayer=0;
        vi.subresourceRange.layerCount=1;
        VkImageView view=VK_NULL_HANDLE;
        check(vkCreateImageView(device_,&vi,nullptr,&view),"vkCreateImageView(texture)");
        return view;
    }

    VkCommandBuffer beginOneTimeCommands() {
        VkCommandBufferAllocateInfo ai{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
        ai.commandPool=commandPool_;
        ai.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        ai.commandBufferCount=1;
        VkCommandBuffer cmd=VK_NULL_HANDLE;
        check(vkAllocateCommandBuffers(device_,&ai,&cmd),"vkAllocateCommandBuffers(one-time)");

        VkCommandBufferBeginInfo bi{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        bi.flags=VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        check(vkBeginCommandBuffer(cmd,&bi),"vkBeginCommandBuffer(one-time)");
        return cmd;
    }

    void endOneTimeCommands(VkCommandBuffer cmd) {
        check(vkEndCommandBuffer(cmd),"vkEndCommandBuffer(one-time)");
        VkSubmitInfo si{VK_STRUCTURE_TYPE_SUBMIT_INFO};
        si.commandBufferCount=1;
        si.pCommandBuffers=&cmd;
        check(vkQueueSubmit(graphicsQueue_,1,&si,VK_NULL_HANDLE),"vkQueueSubmit(one-time)");
        check(vkQueueWaitIdle(graphicsQueue_),"vkQueueWaitIdle(one-time)");
        vkFreeCommandBuffers(device_,commandPool_,1,&cmd);
    }

    void transitionTerrainTexture(VkImageLayout oldLayout,VkImageLayout newLayout) {
        VkCommandBuffer cmd=beginOneTimeCommands();
        VkImageMemoryBarrier b{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
        b.oldLayout=oldLayout;
        b.newLayout=newLayout;
        b.srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED;
        b.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED;
        b.image=terrainTextureImage_;
        b.subresourceRange.aspectMask=VK_IMAGE_ASPECT_COLOR_BIT;
        b.subresourceRange.levelCount=1;
        b.subresourceRange.layerCount=1;

        VkPipelineStageFlags srcStage=VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT;
        VkPipelineStageFlags dstStage=VK_PIPELINE_STAGE_TRANSFER_BIT;

        if(oldLayout==VK_IMAGE_LAYOUT_UNDEFINED && newLayout==VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL){
            b.srcAccessMask=0;
            b.dstAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;
        }else if(oldLayout==VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL && newLayout==VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL){
            b.srcAccessMask=VK_ACCESS_SHADER_READ_BIT;
            b.dstAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;
            srcStage=VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
            dstStage=VK_PIPELINE_STAGE_TRANSFER_BIT;
        }else if(oldLayout==VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL && newLayout==VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL){
            b.srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;
            b.dstAccessMask=VK_ACCESS_SHADER_READ_BIT;
            srcStage=VK_PIPELINE_STAGE_TRANSFER_BIT;
            dstStage=VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
        }else{
            throw std::runtime_error("Transicao de layout de textura nao suportada.");
        }

        vkCmdPipelineBarrier(cmd,srcStage,dstStage,0,0,nullptr,0,nullptr,1,&b);
        endOneTimeCommands(cmd);
    }

    void transitionImage(VkImage image,VkImageLayout oldLayout,VkImageLayout newLayout) {
        VkCommandBuffer cmd=beginOneTimeCommands();
        VkImageMemoryBarrier b{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
        b.oldLayout=oldLayout;b.newLayout=newLayout;
        b.srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED;
        b.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED;
        b.image=image;
        b.subresourceRange.aspectMask=VK_IMAGE_ASPECT_COLOR_BIT;
        b.subresourceRange.levelCount=1;b.subresourceRange.layerCount=1;

        VkPipelineStageFlags srcStage=VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT;
        VkPipelineStageFlags dstStage=VK_PIPELINE_STAGE_TRANSFER_BIT;
        if(oldLayout==VK_IMAGE_LAYOUT_UNDEFINED&&newLayout==VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL){
            b.dstAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;
        }else if(oldLayout==VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL&&newLayout==VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL){
            b.srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;
            b.dstAccessMask=VK_ACCESS_SHADER_READ_BIT;
            srcStage=VK_PIPELINE_STAGE_TRANSFER_BIT;
            dstStage=VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
        }else{
            throw std::runtime_error("Transicao generica de imagem nao suportada.");
        }
        vkCmdPipelineBarrier(cmd,srcStage,dstStage,0,0,nullptr,0,nullptr,1,&b);
        endOneTimeCommands(cmd);
    }

    TextureGpu createTextureRgba(const std::vector<uint8_t>& pixels,uint32_t width,uint32_t height) {
        if(pixels.size()!=static_cast<size_t>(width)*height*4u)
            throw std::runtime_error("Texture RGBA possui tamanho invalido.");

        TextureGpu t{};
        t.width=width;t.height=height;
        constexpr VkFormat fmt=VK_FORMAT_R8G8B8A8_SRGB;
        createImage(width,height,fmt,VK_IMAGE_USAGE_TRANSFER_DST_BIT|VK_IMAGE_USAGE_SAMPLED_BIT,t.image,t.memory);
        t.view=createColorImageView(t.image,fmt);

        Buffer staging=createBuffer(static_cast<VkDeviceSize>(pixels.size()),VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
        std::memcpy(staging.mapped,pixels.data(),pixels.size());

        transitionImage(t.image,VK_IMAGE_LAYOUT_UNDEFINED,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL);
        VkCommandBuffer cmd=beginOneTimeCommands();
        VkBufferImageCopy region{};
        region.imageSubresource.aspectMask=VK_IMAGE_ASPECT_COLOR_BIT;
        region.imageSubresource.layerCount=1;
        region.imageExtent={width,height,1};
        vkCmdCopyBufferToImage(cmd,staging.buffer,t.image,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,1,&region);
        endOneTimeCommands(cmd);
        transitionImage(t.image,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);
        destroyBuffer(staging);
        return t;
    }

    void destroyTexture(TextureGpu& t) {
        if(t.view)vkDestroyImageView(device_,t.view,nullptr);
        if(t.image)vkDestroyImage(device_,t.image,nullptr);
        if(t.memory)vkFreeMemory(device_,t.memory,nullptr);
        t={};
    }

    VkDescriptorSet allocateTerrainDescriptor(const TextureGpu& chunkTexture,VkSampler primarySampler=VK_NULL_HANDLE) {
        VkDescriptorSet set=VK_NULL_HANDLE;
        VkDescriptorSetAllocateInfo ai{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
        ai.descriptorPool=descriptorPool_;
        ai.descriptorSetCount=1;
        ai.pSetLayouts=&descriptorSetLayout_;
        check(vkAllocateDescriptorSets(device_,&ai,&set),"vkAllocateDescriptorSets(chunk)");

        VkDescriptorImageInfo infos[2]{};
        infos[0].sampler=primarySampler?primarySampler:terrainTextureSampler_;
        infos[0].imageView=chunkTexture.view;
        infos[0].imageLayout=VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        infos[1].sampler=wallTextureSampler_;
        infos[1].imageView=wallTexture_.view;
        infos[1].imageLayout=VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

        VkDescriptorBufferInfo bi{};
        bi.buffer=impostorInfoBuffer_.buffer;
        bi.offset=0;
        bi.range=sizeof(ImpostorInfoGpu);

        VkWriteDescriptorSet writes[3]{};
        for(uint32_t i=0;i<2;i++){
            writes[i].sType=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            writes[i].dstSet=set;
            writes[i].dstBinding=i;
            writes[i].descriptorCount=1;
            writes[i].descriptorType=VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
            writes[i].pImageInfo=&infos[i];
        }
        writes[2].sType=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[2].dstSet=set;
        writes[2].dstBinding=2;
        writes[2].descriptorCount=1;
        writes[2].descriptorType=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
        writes[2].pBufferInfo=&bi;

        vkUpdateDescriptorSets(device_,3,writes,0,nullptr);
        return set;
    }

    std::vector<uint8_t> loadWallAtlasPixels() {
        const std::wstring path=executableDir()+L"\\forge_globals.bin";
        auto raw=readBinary(path);
        if(raw.size()<32)throw std::runtime_error("forge_globals.bin ausente ou invalido.");
        auto rd=[&](size_t o){uint32_t v=0;std::memcpy(&v,raw.data()+o,4);return v;};
        if(rd(0)!=0x50494647u||rd(4)!=1u)throw std::runtime_error("forge_globals.bin magic/version invalido.");
        const uint32_t wallW=rd(8),wallH=rd(12);
        if(wallW!=256u||wallH!=1024u)throw std::runtime_error("Dimensao inesperada dos atlas de parede.");
        const size_t one=static_cast<size_t>(wallW)*wallH*4u;
        if(raw.size()<32+one*4)throw std::runtime_error("forge_globals.bin truncado.");

        std::vector<uint8_t> atlas(1024u*1024u*4u,0);
        for(uint32_t which=0;which<4;which++){
            const uint8_t* src=reinterpret_cast<const uint8_t*>(raw.data()+32+one*which);
            for(uint32_t y=0;y<1024;y++){
                uint8_t* dst=atlas.data()+(static_cast<size_t>(y)*1024u+which*256u)*4u;
                std::memcpy(dst,src+static_cast<size_t>(y)*256u*4u,256u*4u);
            }
        }
        return atlas;
    }

    std::vector<uint8_t> loadTreeImpostorAtlas(ImpostorInfoGpu& info,uint32_t& width,uint32_t& height) {
        const std::wstring path=executableDir()+L"\\tree_impostor_atlas.bin";
        auto raw=readBinary(path);
        if(raw.size()<24)throw std::runtime_error("tree_impostor_atlas.bin ausente/invalido.");
        auto rd=[&](size_t o){uint32_t v=0;std::memcpy(&v,raw.data()+o,4);return v;};
        if(rd(0)!=0x50494d50u||rd(4)!=1u)throw std::runtime_error("tree_impostor_atlas.bin magic/version invalido.");
        width=rd(8);height=rd(12);
        const uint32_t cols=rd(16),rows=rd(20);
        if(cols!=4u||rows!=4u)throw std::runtime_error("Grid inesperado do atlas de impostores.");
        constexpr uint32_t typeCount=15;
        const size_t metaBytes=24u+typeCount*12u;
        if(raw.size()<metaBytes+static_cast<size_t>(width)*height*4u)
            throw std::runtime_error("tree_impostor_atlas.bin truncado.");
        for(uint32_t i=0;i<typeCount;i++){
            float xyz[3]{};
            std::memcpy(xyz,raw.data()+24u+i*12u,12u);
            info.v[i][0]=xyz[0];
            info.v[i][1]=xyz[1];
            info.v[i][2]=xyz[2];
            info.v[i][3]=0.0f;
        }
        std::vector<uint8_t> rgba(static_cast<size_t>(width)*height*4u);
        std::memcpy(rgba.data(),raw.data()+metaBytes,rgba.size());
        return rgba;
    }

    void createTerrainTextureResources() {
        VkSamplerCreateInfo sci{VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO};
        sci.magFilter=VK_FILTER_LINEAR;
        sci.minFilter=VK_FILTER_LINEAR;
        sci.mipmapMode=VK_SAMPLER_MIPMAP_MODE_NEAREST;
        sci.addressModeU=VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        sci.addressModeV=VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        sci.addressModeW=VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        sci.maxAnisotropy=1.0f;
        sci.borderColor=VK_BORDER_COLOR_INT_OPAQUE_BLACK;
        check(vkCreateSampler(device_,&sci,nullptr,&terrainTextureSampler_),"vkCreateSampler(terrain)");

        VkSamplerCreateInfo wallSci=sci;
        wallSci.magFilter=VK_FILTER_NEAREST;
        wallSci.minFilter=VK_FILTER_NEAREST;
        check(vkCreateSampler(device_,&wallSci,nullptr,&wallTextureSampler_),"vkCreateSampler(walls)");

        VkSamplerCreateInfo pixelClampSci=wallSci;
        pixelClampSci.addressModeU=VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        pixelClampSci.addressModeV=VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        check(vkCreateSampler(device_,&pixelClampSci,nullptr,&pixelClampSampler_),"vkCreateSampler(pixel-clamp)");

        VkSamplerCreateInfo pixelRepeatSci=wallSci;
        pixelRepeatSci.addressModeU=VK_SAMPLER_ADDRESS_MODE_REPEAT;
        pixelRepeatSci.addressModeV=VK_SAMPLER_ADDRESS_MODE_REPEAT;
        check(vkCreateSampler(device_,&pixelRepeatSci,nullptr,&pixelRepeatSampler_),"vkCreateSampler(pixel-repeat)");

        std::array<VkDescriptorPoolSize,2> ps{};
        ps[0].type=VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        ps[0].descriptorCount=1024;
        ps[1].type=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
        ps[1].descriptorCount=512;
        VkDescriptorPoolCreateInfo pci{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
        pci.flags=VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT;
        pci.maxSets=512;
        pci.poolSizeCount=static_cast<uint32_t>(ps.size());
        pci.pPoolSizes=ps.data();
        check(vkCreateDescriptorPool(device_,&pci,nullptr,&descriptorPool_),"vkCreateDescriptorPool");

        ImpostorInfoGpu impInfo{};
        uint32_t impW=0,impH=0;
        auto impPixels=loadTreeImpostorAtlas(impInfo,impW,impH);
        impostorInfoBuffer_=createBuffer(sizeof(ImpostorInfoGpu),VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);
        std::memcpy(impostorInfoBuffer_.mapped,&impInfo,sizeof(impInfo));

        std::vector<uint8_t> white(256u*128u*4u,255);
        fallbackTexture_=createTextureRgba(white,256,128);
        wallTexture_=createTextureRgba(loadWallAtlasPixels(),1024,1024);
        impostorAtlasTexture_=createTextureRgba(impPixels,impW,impH);
        descriptorSet_=allocateTerrainDescriptor(fallbackTexture_);
        impostorDescriptor_=allocateTerrainDescriptor(impostorAtlasTexture_,pixelClampSampler_);
    }

    void uploadTerrainTexture(const std::vector<uint8_t>& pixels) {
        const size_t expected=static_cast<size_t>(TERRAIN_ATLAS_SIZE_PX)*TERRAIN_ATLAS_SIZE_PX*4u;
        if(pixels.size()!=expected) throw std::runtime_error("Atlas de terreno com dimensao invalida.");

        Buffer staging=createBuffer(
            static_cast<VkDeviceSize>(pixels.size()),
            VK_BUFFER_USAGE_TRANSFER_SRC_BIT
        );
        std::memcpy(staging.mapped,pixels.data(),pixels.size());

        transitionTerrainTexture(
            terrainTextureInitialized_?VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL:VK_IMAGE_LAYOUT_UNDEFINED,
            VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL
        );

        VkCommandBuffer cmd=beginOneTimeCommands();
        VkBufferImageCopy region{};
        region.bufferOffset=0;
        region.bufferRowLength=0;
        region.bufferImageHeight=0;
        region.imageSubresource.aspectMask=VK_IMAGE_ASPECT_COLOR_BIT;
        region.imageSubresource.mipLevel=0;
        region.imageSubresource.baseArrayLayer=0;
        region.imageSubresource.layerCount=1;
        region.imageOffset={0,0,0};
        region.imageExtent={TERRAIN_ATLAS_SIZE_PX,TERRAIN_ATLAS_SIZE_PX,1};
        vkCmdCopyBufferToImage(
            cmd,staging.buffer,terrainTextureImage_,
            VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,1,&region
        );
        endOneTimeCommands(cmd);

        transitionTerrainTexture(
            VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
            VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL
        );
        terrainTextureInitialized_=true;
        destroyBuffer(staging);
    }

    VkImageView createDepthImageView(VkImage image,VkFormat format) {
        VkImageViewCreateInfo vi{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        vi.image=image;
        vi.viewType=VK_IMAGE_VIEW_TYPE_2D;
        vi.format=format;
        vi.subresourceRange.aspectMask=VK_IMAGE_ASPECT_DEPTH_BIT;
        vi.subresourceRange.baseMipLevel=0;
        vi.subresourceRange.levelCount=1;
        vi.subresourceRange.baseArrayLayer=0;
        vi.subresourceRange.layerCount=1;
        VkImageView view=VK_NULL_HANDLE;
        check(vkCreateImageView(device_,&vi,nullptr,&view),"vkCreateImageView(scene-depth)");
        return view;
    }

    void createSceneTarget(SceneTargetGpu& t,uint32_t width,uint32_t height) {
        t.width=width;t.height=height;
        t.color.width=width;t.color.height=height;
        createImage(
            width,height,sceneColorFormat_,
            VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT|VK_IMAGE_USAGE_SAMPLED_BIT,
            t.color.image,t.color.memory
        );
        t.color.view=createColorImageView(t.color.image,sceneColorFormat_);

        createImage(
            width,height,depthFormat_,
            VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT|VK_IMAGE_USAGE_SAMPLED_BIT,
            t.depth,t.depthMemory
        );
        t.depthView=createDepthImageView(t.depth,depthFormat_);

        VkImageView at[]={t.color.view,t.depthView};
        VkFramebufferCreateInfo ci{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
        ci.renderPass=renderPass_;
        ci.attachmentCount=2;
        ci.pAttachments=at;
        ci.width=width;ci.height=height;ci.layers=1;
        check(vkCreateFramebuffer(device_,&ci,nullptr,&t.framebuffer),"vkCreateFramebuffer(scene-target)");
    }

    void destroySceneTarget(SceneTargetGpu& t) {
        if(t.framebuffer)vkDestroyFramebuffer(device_,t.framebuffer,nullptr);
        if(t.depthView)vkDestroyImageView(device_,t.depthView,nullptr);
        if(t.depth)vkDestroyImage(device_,t.depth,nullptr);
        if(t.depthMemory)vkFreeMemory(device_,t.depthMemory,nullptr);
        if(t.color.view)vkDestroyImageView(device_,t.color.view,nullptr);
        if(t.color.image)vkDestroyImage(device_,t.color.image,nullptr);
        if(t.color.memory)vkFreeMemory(device_,t.color.memory,nullptr);
        t={};
    }

    void createDepthResources() {
        const uint32_t rw=std::max(1u,static_cast<uint32_t>(std::lround(swapExtent_.width*0.72)));
        const uint32_t rh=std::max(1u,static_cast<uint32_t>(std::lround(swapExtent_.height*0.72)));
        createSceneTarget(sceneTarget_,rw,rh);
        createSceneTarget(reflectionTarget_,128,128);
    }

    void createFramebuffers() {
        framebuffers_.resize(swapViews_.size());
        for(size_t i=0;i<swapViews_.size();i++) {
            VkImageView at[]={swapViews_[i]};
            VkFramebufferCreateInfo ci{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
            ci.renderPass=presentRenderPass_;
            ci.attachmentCount=1;
            ci.pAttachments=at;
            ci.width=swapExtent_.width;
            ci.height=swapExtent_.height;
            ci.layers=1;
            check(vkCreateFramebuffer(device_,&ci,nullptr,&framebuffers_[i]),"vkCreateFramebuffer(present)");
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

    WaterMeshGpu uploadWaterMesh(const WaterMeshCpu& m){
        WaterMeshGpu g{};
        if(m.vertices.empty()||m.indices.empty())return g;
        g.vb=createBuffer(sizeof(WaterVertex)*m.vertices.size(),VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
        g.ib=createBuffer(sizeof(uint32_t)*m.indices.size(),VK_BUFFER_USAGE_INDEX_BUFFER_BIT);
        std::memcpy(g.vb.mapped,m.vertices.data(),sizeof(WaterVertex)*m.vertices.size());
        std::memcpy(g.ib.mapped,m.indices.data(),sizeof(uint32_t)*m.indices.size());
        g.indexCount=static_cast<uint32_t>(m.indices.size());
        return g;
    }

    void destroyWaterMesh(WaterMeshGpu& m){
        destroyBuffer(m.vb);destroyBuffer(m.ib);m.indexCount=0;
    }

    SkyMeshGpu uploadSkyMesh(const SkyMeshCpu& m){
        SkyMeshGpu g{};
        if(m.vertices.empty()||m.indices.empty())return g;
        g.vb=createBuffer(sizeof(SkyVertex)*m.vertices.size(),VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
        g.ib=createBuffer(sizeof(uint32_t)*m.indices.size(),VK_BUFFER_USAGE_INDEX_BUFFER_BIT);
        std::memcpy(g.vb.mapped,m.vertices.data(),sizeof(SkyVertex)*m.vertices.size());
        std::memcpy(g.ib.mapped,m.indices.data(),sizeof(uint32_t)*m.indices.size());
        g.indexCount=static_cast<uint32_t>(m.indices.size());
        return g;
    }

    void destroySkyMesh(SkyMeshGpu& m){
        destroyBuffer(m.vb);destroyBuffer(m.ib);m.indexCount=0;
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

    GpuMesh uploadVertexIndexMesh(const std::vector<Vertex>& vertices,const std::vector<uint32_t>& indices) {
        GpuMesh g{};
        if(vertices.empty()||indices.empty())return g;
        g.vb=createBuffer(sizeof(Vertex)*vertices.size(),VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
        g.ib=createBuffer(sizeof(uint32_t)*indices.size(),VK_BUFFER_USAGE_INDEX_BUFFER_BIT);
        std::memcpy(g.vb.mapped,vertices.data(),sizeof(Vertex)*vertices.size());
        std::memcpy(g.ib.mapped,indices.data(),sizeof(uint32_t)*indices.size());
        g.indexCount=static_cast<uint32_t>(indices.size());
        return g;
    }

    ExactChunkGpu uploadExactChunk(ExactChunkCpu&& src) {
        ExactChunkGpu out{};
        out.cx=src.cx;out.cz=src.cz;out.segments=src.segments;out.density=src.density;

        const size_t nv=src.positions.size()/3u;
        std::vector<Vertex> vertices(nv);
        const float centerX=src.cx*64.0f,centerZ=src.cz*64.0f;
        for(size_t i=0;i<nv;i++){
            Vertex v{};
            v.px=src.positions[i*3+0]+centerX;
            v.py=src.positions[i*3+1];
            v.pz=src.positions[i*3+2]+centerZ;
            v.nx=src.normals[i*3+0];v.ny=src.normals[i*3+1];v.nz=src.normals[i*3+2];
            v.r=v.g=v.b=1.0f;
            if(src.wall.size()>=i*3+3){
                v.wallX=src.wall[i*3+0];v.wallY=src.wall[i*3+1];v.wallZ=src.wall[i*3+2];
            }
            if(src.morph.size()>i)v.morph=src.morph[i];
            vertices[i]=v;
        }
        std::vector<uint32_t> indices(src.indices.begin(),src.indices.end());
        out.mesh=uploadVertexIndexMesh(vertices,indices);

        // top e topDark permanecem byte-a-byte como saíram do TerrainTextureForge.
        // Só são colocados lado a lado numa imagem fixa para usar um descriptor por chunk.
        std::vector<uint8_t> packed(256u*128u*4u,0);
        if(src.texW>128u||src.texH>128u)throw std::runtime_error("Textura de chunk excedeu pack nativo.");
        const size_t rowBytes=static_cast<size_t>(src.texW)*4u;
        for(uint32_t y=0;y<src.texH;y++){
            std::memcpy(
                packed.data()+static_cast<size_t>(y)*256u*4u,
                src.top.data()+static_cast<size_t>(y)*rowBytes,
                rowBytes
            );
            std::memcpy(
                packed.data()+(static_cast<size_t>(y)*256u+128u)*4u,
                src.topDark.data()+static_cast<size_t>(y)*rowBytes,
                rowBytes
            );
        }
        out.texture=createTextureRgba(packed,256,128);
        out.descriptor=allocateTerrainDescriptor(out.texture);

        const int grid=src.segments+1;
        const size_t mainVerts=static_cast<size_t>(grid)*grid;
        out.heights.resize(mainVerts);
        for(size_t i=0;i<mainVerts&&i<nv;i++)out.heights[i]=src.positions[i*3+1];
        return out;
    }

    HorizonGpu uploadHorizon(HorizonTileCpu&& src,float inner,float outer) {
        HorizonGpu out{};
        out.level=src.level;out.tx=src.tx;out.tz=src.tz;out.inner=inner;out.outer=outer;
        const size_t nv=src.positions.size()/3u;
        std::vector<Vertex> vertices(nv);
        const float centerX=src.minX+src.size*0.5f;
        const float centerZ=src.minZ+src.size*0.5f;
        for(size_t i=0;i<nv;i++){
            Vertex v{};
            v.px=src.positions[i*3+0]+centerX;
            v.py=src.positions[i*3+1]-src.lower;
            v.pz=src.positions[i*3+2]+centerZ;
            v.nx=src.normals[i*3+0];v.ny=src.normals[i*3+1];v.nz=src.normals[i*3+2];
            v.r=src.colors[i*3+0];v.g=src.colors[i*3+1];v.b=src.colors[i*3+2];
            v.wallX=v.wallY=99.0f;v.wallZ=0;
            if(src.morph.size()>i)v.morph=src.morph[i];
            vertices[i]=v;
        }
        std::vector<uint32_t> indices(src.indices.begin(),src.indices.end());
        out.mesh=uploadVertexIndexMesh(vertices,indices);
        return out;
    }

    ImpostorBlockGpu uploadImpostorBlock(ImpostorBlockCpu&& src) {
        ImpostorBlockGpu out{};
        out.tx=src.tx;out.tz=src.tz;out.minX=src.minX;out.minZ=src.minZ;out.size=src.size;
        const size_t nv=src.positions.size()/3u;
        std::vector<Vertex> vertices(nv);

        // buildImpostorBlock guarda posições locais ao centro do tile de horizonte de 1024m.
        const float tileMinX=std::floor(src.minX/1024.0f)*1024.0f;
        const float tileMinZ=std::floor(src.minZ/1024.0f)*1024.0f;
        const float ox=tileMinX+512.0f;
        const float oz=tileMinZ+512.0f;

        for(size_t i=0;i<nv;i++){
            Vertex v{};
            v.px=src.positions[i*3+0]+ox;
            v.py=src.positions[i*3+1];
            v.pz=src.positions[i*3+2]+oz;
            v.nx=0;v.ny=1;v.nz=0;
            if(src.colors.size()>=i*3+3){
                v.r=src.colors[i*3+0]/255.0f;
                v.g=src.colors[i*3+1]/255.0f;
                v.b=src.colors[i*3+2]/255.0f;
            }
            if(src.tree.size()>=i*4+4){
                v.treeX=src.tree[i*4+0];
                v.treeY=src.tree[i*4+1];
                v.treeType=src.tree[i*4+2];
                v.treeScale=src.tree[i*4+3];
            }
            vertices[i]=v;
        }
        out.mesh=uploadVertexIndexMesh(vertices,src.indices);
        return out;
    }

    void destroyImpostorBlock(ImpostorBlockGpu& b){
        destroyMesh(b.mesh);
    }

    void destroyExactChunk(ExactChunkGpu& c) {
        if(c.descriptor&&descriptorPool_)vkFreeDescriptorSets(device_,descriptorPool_,1,&c.descriptor);
        c.descriptor=VK_NULL_HANDLE;
        destroyTexture(c.texture);
        destroyMesh(c.mesh);
    }

    void destroyHorizon(HorizonGpu& h) {
        destroyMesh(h.mesh);
    }

    std::vector<uint8_t> makeEmptyFallbackTexture() {
        return std::vector<uint8_t>(256u*128u*4u,255u);
    }

    static uint32_t pixelTreeAssetKey(int presetId,int variant){
        return (static_cast<uint32_t>(presetId)<<16)|static_cast<uint32_t>(variant&0xffff);
    }

    PixelTreePartGpu uploadPixelTreePart(const PixelTreeCpuPart& src){
        PixelTreePartGpu out{};
        out.name=src.name;
        out.repeatX=src.repeatX;
        out.repeatY=src.repeatY;
        out.alphaTest=src.alphaTest;
        out.flipY=(src.flags&2u)!=0u;
        out.castShadow=(src.flags&4u)!=0u;

        const size_t nv=src.positions.size()/3u;
        std::vector<Vertex> vertices(nv);
        for(size_t i=0;i<nv;i++){
            Vertex v{};
            v.px=src.positions[i*3+0];
            v.py=src.positions[i*3+1];
            v.pz=src.positions[i*3+2];

            if(src.normals.size()>=i*3+3){
                v.nx=src.normals[i*3+0];
                v.ny=src.normals[i*3+1];
                v.nz=src.normals[i*3+2];
            }
            const float cr=src.colors.size()>=i*3+3?src.colors[i*3+0]:1.0f;
            const float cg=src.colors.size()>=i*3+3?src.colors[i*3+1]:1.0f;
            const float cb=src.colors.size()>=i*3+3?src.colors[i*3+2]:1.0f;
            v.r=cr*src.materialR;
            v.g=cg*src.materialG;
            v.b=cb*src.materialB;

            if(src.uvs.size()>=i*2+2){
                v.u=src.uvs[i*2+0];
                v.v=src.uvs[i*2+1];
            }
            vertices[i]=v;
        }

        out.mesh=uploadVertexIndexMesh(vertices,src.indices);
        out.texture=createTextureRgba(src.rgba,src.texW,src.texH);
        const bool repeats=std::abs(src.repeatX-1.0f)>0.001f||std::abs(src.repeatY-1.0f)>0.001f;
        out.descriptor=allocateTerrainDescriptor(out.texture,repeats?pixelRepeatSampler_:pixelClampSampler_);
        return out;
    }

    void loadPixelTreeAssets(){
        PixelTreeCpuLibrary cpu;
        cpu.load(std::filesystem::path(executableDir())/L"pixel_tree_assets.bin");
        pixelTreeWorldSeed_=cpu.worldSeed();

        for(int preset=0;preset<static_cast<int>(PIXEL_TREE_PRESETS.size());preset++){
            const int variants=cpu.variantCount(static_cast<uint16_t>(preset));
            for(int variant=0;variant<variants;variant++){
                const auto* src=cpu.find(static_cast<uint16_t>(preset),static_cast<uint16_t>(variant));
                if(!src)continue;

                PixelTreeAssetGpu gpu{};
                gpu.presetId=src->presetId;
                gpu.variant=src->variant;
                gpu.parts.reserve(src->parts.size());
                for(const auto& p:src->parts)gpu.parts.push_back(uploadPixelTreePart(p));

                gpu.instanceBuffer=createBuffer(
                    sizeof(InstanceGPU)*PIXEL_TREE_MAX_INSTANCES,
                    VK_BUFFER_USAGE_VERTEX_BUFFER_BIT
                );
                gpu.visible.reserve(PIXEL_TREE_MAX_INSTANCES);
                pixelTreeAssets_.emplace(pixelTreeAssetKey(preset,variant),std::move(gpu));
            }
        }

        logLine("PIXEL_TREE: "+std::to_string(pixelTreeAssets_.size())+" variantes carregadas");
    }

    void destroyPixelTreeAssets(){
        for(auto& [key,a]:pixelTreeAssets_){
            for(auto& p:a.parts){
                if(p.descriptor&&descriptorPool_)vkFreeDescriptorSets(device_,descriptorPool_,1,&p.descriptor);
                p.descriptor=VK_NULL_HANDLE;
                destroyTexture(p.texture);
                destroyMesh(p.mesh);
            }
            destroyBuffer(a.instanceBuffer);
        }
        pixelTreeAssets_.clear();
    }


    void updateBlitDescriptor(){
        if(!blitDescriptorSet_)return;
        VkDescriptorImageInfo ii{};
        ii.sampler=postLinearSampler_;
        ii.imageView=sceneTarget_.color.view;
        ii.imageLayout=VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        VkWriteDescriptorSet w{VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
        w.dstSet=blitDescriptorSet_;
        w.dstBinding=0;
        w.descriptorCount=1;
        w.descriptorType=VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        w.pImageInfo=&ii;
        vkUpdateDescriptorSets(device_,1,&w,0,nullptr);
    }

    void updateWaterDescriptor(){
        if(!waterDescriptorSet_)return;
        VkDescriptorImageInfo images[3]{};
        images[0].sampler=waterDepthSampler_;
        images[0].imageView=sceneTarget_.depthView;
        images[0].imageLayout=VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL;
        images[1].sampler=postLinearSampler_;
        images[1].imageView=reflectionTarget_.color.view;
        images[1].imageLayout=VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        images[2].sampler=postLinearSampler_;
        images[2].imageView=waterBiomeTexture_.view;
        images[2].imageLayout=VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

        VkDescriptorBufferInfo bi{};
        bi.buffer=waterUniformBuffer_.buffer;
        bi.offset=0;
        bi.range=sizeof(WaterUniformsGpu);

        VkWriteDescriptorSet writes[4]{};
        for(uint32_t i=0;i<3;i++){
            writes[i].sType=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            writes[i].dstSet=waterDescriptorSet_;
            writes[i].dstBinding=i;
            writes[i].descriptorCount=1;
            writes[i].descriptorType=VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
            writes[i].pImageInfo=&images[i];
        }
        writes[3].sType=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[3].dstSet=waterDescriptorSet_;
        writes[3].dstBinding=3;
        writes[3].descriptorCount=1;
        writes[3].descriptorType=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
        writes[3].pBufferInfo=&bi;
        vkUpdateDescriptorSets(device_,4,writes,0,nullptr);
    }

    void refreshPostDescriptors(){
        updateBlitDescriptor();
        updateWaterDescriptor();
    }

    void createPostProcessResources(){
        WaterMeshCpu wm=buildOriginalWaterMesh();
        waterMesh_=uploadWaterMesh(wm);
        waterUniformBuffer_=createBuffer(sizeof(WaterUniformsGpu),VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);

        SkyMeshCpu sm=buildOriginalSkySphere();
        skyMesh_=uploadSkyMesh(sm);
        for(auto& b:skyUniformBuffers_)
            b=createBuffer(sizeof(SkyUniformsGpu),VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);

        VkSamplerCreateInfo sci{VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO};
        sci.magFilter=VK_FILTER_LINEAR;
        sci.minFilter=VK_FILTER_LINEAR;
        sci.mipmapMode=VK_SAMPLER_MIPMAP_MODE_NEAREST;
        sci.addressModeU=VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        sci.addressModeV=VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        sci.addressModeW=VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        sci.maxAnisotropy=1.0f;
        check(vkCreateSampler(device_,&sci,nullptr,&postLinearSampler_),"vkCreateSampler(post-linear)");

        VkSamplerCreateInfo dci=sci;
        dci.magFilter=VK_FILTER_NEAREST;
        dci.minFilter=VK_FILTER_NEAREST;
        check(vkCreateSampler(device_,&dci,nullptr,&waterDepthSampler_),"vkCreateSampler(water-depth)");

        std::array<VkDescriptorPoolSize,2> ps{};
        ps[0].type=VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        ps[0].descriptorCount=8;
        ps[1].type=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
        ps[1].descriptorCount=4;
        VkDescriptorPoolCreateInfo pci{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
        pci.maxSets=4;
        pci.poolSizeCount=static_cast<uint32_t>(ps.size());
        pci.pPoolSizes=ps.data();
        check(vkCreateDescriptorPool(device_,&pci,nullptr,&postDescriptorPool_),"vkCreateDescriptorPool(post)");

        VkDescriptorSetAllocateInfo bai{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
        bai.descriptorPool=postDescriptorPool_;
        bai.descriptorSetCount=1;
        bai.pSetLayouts=&blitDescriptorSetLayout_;
        check(vkAllocateDescriptorSets(device_,&bai,&blitDescriptorSet_),"vkAllocateDescriptorSets(blit)");

        VkDescriptorSetAllocateInfo wai{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
        wai.descriptorPool=postDescriptorPool_;
        wai.descriptorSetCount=1;
        wai.pSetLayouts=&waterDescriptorSetLayout_;
        check(vkAllocateDescriptorSets(device_,&wai,&waterDescriptorSet_),"vkAllocateDescriptorSets(water)");

        for(size_t i=0;i<skyDescriptorSets_.size();++i){
            VkDescriptorSetAllocateInfo sai{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
            sai.descriptorPool=postDescriptorPool_;
            sai.descriptorSetCount=1;
            sai.pSetLayouts=&skyDescriptorSetLayout_;
            check(vkAllocateDescriptorSets(device_,&sai,&skyDescriptorSets_[i]),"vkAllocateDescriptorSets(sky)");

            VkDescriptorBufferInfo sbi{};
            sbi.buffer=skyUniformBuffers_[i].buffer;
            sbi.offset=0;
            sbi.range=sizeof(SkyUniformsGpu);
            VkWriteDescriptorSet sw{VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
            sw.dstSet=skyDescriptorSets_[i];
            sw.dstBinding=0;
            sw.descriptorCount=1;
            sw.descriptorType=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
            sw.pBufferInfo=&sbi;
            vkUpdateDescriptorSets(device_,1,&sw,0,nullptr);
        }

        std::vector<uint8_t> defaultBiome={0,0,0,0};
        waterBiomeTexture_=createTextureRgba(defaultBiome,1,1);
        waterBiomeReady_=false;

        refreshPostDescriptors();
    }

    void destroyPostProcessResources(){
        destroySkyMesh(skyMesh_);
        for(auto& b:skyUniformBuffers_)destroyBuffer(b);
        skyDescriptorSets_.fill(VK_NULL_HANDLE);
        destroyWaterMesh(waterMesh_);
        destroyBuffer(waterUniformBuffer_);
        destroyTexture(waterBiomeTexture_);
        if(postLinearSampler_)vkDestroySampler(device_,postLinearSampler_,nullptr);
        if(waterDepthSampler_)vkDestroySampler(device_,waterDepthSampler_,nullptr);
        postLinearSampler_=waterDepthSampler_=VK_NULL_HANDLE;
        if(postDescriptorPool_)vkDestroyDescriptorPool(device_,postDescriptorPool_,nullptr);
        postDescriptorPool_=VK_NULL_HANDLE;
        blitDescriptorSet_=VK_NULL_HANDLE;
        waterDescriptorSet_=VK_NULL_HANDLE;
    }

    void createGpuWorldResources() {
        terrainVB_=createBuffer(sizeof(Vertex)*static_cast<size_t>(TERRAIN_SEGMENTS+1)*(TERRAIN_SEGMENTS+1),VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
        terrainIB_=createBuffer(sizeof(uint32_t)*static_cast<size_t>(TERRAIN_SEGMENTS)*TERRAIN_SEGMENTS*6,VK_BUFFER_USAGE_INDEX_BUFFER_BIT);

        dummyInstance_=createBuffer(sizeof(InstanceGPU),VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
        InstanceGPU d{};
        d.m[0]=d.m[5]=d.m[10]=d.m[15]=1.0f;
        d.r=d.g=d.b=d.a=1.0f;
        std::memcpy(dummyInstance_.mapped,&d,sizeof(d));

        for(int i=0;i<MESH_KIND_COUNT;i++) {
            meshes_[i]=uploadMesh(buildMeshForKind(i));
            instanceBuffers_[i]=createBuffer(sizeof(InstanceGPU)*MAX_INSTANCES_PER_MESH,VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
            visible_[i].reserve(i==GRASS?MAX_INSTANCES_PER_MESH:12000);
        }

        createTerrainTextureResources();
        loadPixelTreeAssets();
        createPostProcessResources();
    }

    void uploadWorld(WorldData&& w) {
        vkDeviceWaitIdle(device_);
        const size_t vbBytes=w.terrainVertices.size()*sizeof(Vertex);
        const size_t ibBytes=w.terrainIndices.size()*sizeof(uint32_t);
        if(vbBytes>terrainVB_.size||ibBytes>terrainIB_.size) throw std::runtime_error("World terrain excedeu buffers.");
        std::memcpy(terrainVB_.mapped,w.terrainVertices.data(),vbBytes);
        std::memcpy(terrainIB_.mapped,w.terrainIndices.data(),ibBytes);
        terrainIndexCount_=static_cast<uint32_t>(w.terrainIndices.size());
        terrainHeights_.resize(w.terrainVertices.size());
        for(size_t i=0;i<w.terrainVertices.size();++i) terrainHeights_[i]=w.terrainVertices[i].py;

        uploadTerrainTexture(w.terrainTexture);
        terrainTextureOriginX_=w.terrainTextureOriginX;
        terrainTextureOriginZ_=w.terrainTextureOriginZ;

        objects_=std::move(w.objects);
        worldCenterX_=w.centerX; worldCenterZ_=w.centerZ;
        requestedCenterX_=worldCenterX_; requestedCenterZ_=worldCenterZ_;
    }

    void loadOriginalSpawn() {
        const std::wstring path=executableDir()+L"\\spawn.bin";
        auto raw=readBinary(path);
        if(raw.size()<sizeof(float)*3u) throw std::runtime_error("spawn.bin ausente ou invalido.");
        float vals[3]{};
        std::memcpy(vals,raw.data(),sizeof(vals));
        spawnX_=vals[0];spawnZ_=vals[1];spawnElevation_=vals[2];
        focus_={spawnX_,0.0f,spawnZ_};
        const int cx=static_cast<int>(std::floor((spawnX_+32.0f)/64.0f));
        const int cz=static_cast<int>(std::floor((spawnZ_+32.0f)/64.0f));
        spawnCx_=cx;spawnCz_=cz;
        logLine("SPAWN: "+std::to_string(spawnX_)+","+std::to_string(spawnZ_)+" h="+std::to_string(spawnElevation_));
    }

    float heightAt(float x,float z) const {
        const int cx=static_cast<int>(std::floor((x+32.0f)/64.0f));
        const int cz=static_cast<int>(std::floor((z+32.0f)/64.0f));
        const std::string key=std::to_string(cx)+":"+std::to_string(cz);
        auto it=exactChunks_.find(key);
        if(it==exactChunks_.end()||it->second.heights.empty()) return worldReady_?focus_.y:0.0f;
        const auto& ch=it->second;
        const int seg=ch.segments,grid=seg+1;
        const float minX=cx*64.0f-32.0f,minZ=cz*64.0f-32.0f;
        float u=(x-minX)/64.0f*seg,v=(z-minZ)/64.0f*seg;
        u=std::clamp(u,0.0f,static_cast<float>(seg)-0.001f);
        v=std::clamp(v,0.0f,static_cast<float>(seg)-0.001f);
        const int ix=static_cast<int>(std::floor(u)),iz=static_cast<int>(std::floor(v));
        const float fu=u-ix,fv=v-iz;
        const float a=ch.heights[iz*grid+ix];
        const float b=ch.heights[iz*grid+ix+1];
        const float cc=ch.heights[(iz+1)*grid+ix];
        const float d=ch.heights[(iz+1)*grid+ix+1];
        // A malha original usa diagonal b-d; usar a mesma triangulação evita câmera flutuando.
        if(fu+fv<=1.0f) return a+(b-a)*fu+(cc-a)*fv;
        return d+(cc-d)*(1.0f-fu)+(b-d)*(1.0f-fv);
    }

    Vec3 observerEye() const {
        const float viewDistance=std::max(800.0f,observerFrustumSize_*1.15f);
        const float sinP=std::sin(observerPitch_);
        const float cosP=std::cos(observerPitch_);
        const float sinY=std::sin(observerYaw_);
        const float cosY=std::cos(observerYaw_);
        return {
            focus_.x+viewDistance*sinY*cosP,
            focus_.y+viewDistance*sinP,
            focus_.z+viewDistance*cosY*cosP
        };
    }

    bool keyPressed(int vk) const {
        return input_.key(vk);
    }

    void enterFirstPersonAtFocus() {
        if(!observerMode_||transitionMode_!=0)return;
        transitionMode_=1;
        transitionTimer_=0.0f;
        transitionDuration_=1.35f;
        transitionStartPos_=observerEye();
        transitionStartLook_=focus_;

        const float ground=std::max(heightAt(focus_.x,focus_.z),0.0f);
        transitionTargetPos_={focus_.x,ground+1.75f,focus_.z};
        transitionTargetYaw_=std::atan2(focus_.x,focus_.z)+PI*0.75f;
        transitionTargetPitch_=-0.05f;
        const float fx=-std::sin(transitionTargetYaw_);
        const float fz=-std::cos(transitionTargetYaw_);
        transitionTargetLook_={
            focus_.x+fx*15.0f,
            transitionTargetPos_.y,
            focus_.z+fz*15.0f
        };
        transitionStartFov_=45.0f;
        transitionTargetFov_=75.0f;
        transitionPos_=transitionStartPos_;
        transitionLook_=transitionStartLook_;
        transitionFov_=transitionStartFov_;
        logLine("CAMERA: transition in");
    }

    void exitFirstPersonToObserver() {
        if(observerMode_||transitionMode_!=0)return;
        transitionMode_=2;
        transitionTimer_=0.0f;
        transitionDuration_=1.15f;
        transitionStartPos_={camera_.x,camera_.y+fpsBob_,camera_.z};
        const float fx=-std::sin(yaw_)*std::cos(pitch_);
        const float fy=std::sin(pitch_);
        const float fz=-std::cos(yaw_)*std::cos(pitch_);
        transitionStartLook_=transitionStartPos_+Vec3{fx,fy,fz}*15.0f;

        focus_={camera_.x,0.0f,camera_.z};
        observerVelX_=observerVelZ_=0.0f;
        transitionTargetPos_=observerEye();
        transitionTargetLook_=focus_;
        transitionStartFov_=75.0f;
        transitionTargetFov_=50.0f;
        transitionPos_=transitionStartPos_;
        transitionLook_=transitionStartLook_;
        transitionFov_=transitionStartFov_;
        logLine("CAMERA: transition out");
    }

    void updateCameraTransition(float dt){
        if(transitionMode_==0)return;
        transitionTimer_+=dt;
        const float progress=std::min(1.0f,transitionTimer_/transitionDuration_);
        const float ease=cubicEaseInOut(progress);
        transitionPos_=lerpVec(transitionStartPos_,transitionTargetPos_,ease);
        transitionPos_.y+=std::sin(progress*PI)*28.0f;

        const float safeGround=heightAt(transitionPos_.x,transitionPos_.z);
        const float minSafeY=std::max(safeGround,0.0f)+2.2f;
        if(transitionPos_.y<minSafeY)transitionPos_.y=minSafeY;

        transitionLook_=lerpVec(transitionStartLook_,transitionTargetLook_,ease);
        transitionFov_=transitionStartFov_+(transitionTargetFov_-transitionStartFov_)*ease;

        if(progress>=1.0f){
            if(transitionMode_==1){
                observerMode_=false;
                camera_=transitionTargetPos_;
                yaw_=transitionTargetYaw_;
                pitch_=transitionTargetPitch_;
                fpsVelX_=fpsVelZ_=0.0f;
                fpsBobTimer_=fpsBob_=0.0f;
                planExactStreaming(camera_.x,camera_.z,true);
                logLine("CAMERA: primeira pessoa");
            }else{
                observerMode_=true;
                camera_=observerEye();
                planExactStreaming(focus_.x,focus_.z,true);
                logLine("CAMERA: observador");
            }
            transitionMode_=0;
        }
    }

    void updateObserverControls(float dt) {
        // Wheel zoom: ObserverCamera.applyWheelZoom().
        if(input_.wheelDelta!=0.0f){
            const float zoomFactor=std::exp(input_.wheelDelta*0.0014f);
            observerTargetFrustumSize_=std::clamp(
                observerTargetFrustumSize_*zoomFactor,
                22.0f,1400.0f
            );
        }

        // Botão direito: rotação horizontal, mesma sensibilidade do original.
        if(input_.rotateDeltaX!=0.0f)
            observerTargetYaw_-=input_.rotateDeltaX*0.0048f;

        // Suavização do zoom e yaw exatamente como ObserverCamera.
        observerFrustumSize_ += (observerTargetFrustumSize_-observerFrustumSize_)
            * std::min(dt*9.0f,1.0f);
        observerYaw_ += (observerTargetYaw_-observerYaw_)
            * std::min(dt*14.0f,1.0f);

        // Teclado normalizado: WASD + setas.
        float ix=0.0f,iy=0.0f;
        if(keyPressed('W')||keyPressed(VK_UP))iy+=1.0f;
        if(keyPressed('S')||keyPressed(VK_DOWN))iy-=1.0f;
        if(keyPressed('A')||keyPressed(VK_LEFT))ix-=1.0f;
        if(keyPressed('D')||keyPressed(VK_RIGHT))ix+=1.0f;
        const float il=std::hypot(ix,iy);
        if(il>0.0f){ix/=il;iy/=il;}

        const float forwardX=-std::sin(observerYaw_);
        const float forwardZ=-std::cos(observerYaw_);
        const float rightX=std::cos(observerYaw_);
        const float rightZ=-std::sin(observerYaw_);
        float dirX=forwardX*iy+rightX*ix;
        float dirZ=forwardZ*iy+rightZ*ix;
        const float dl=std::hypot(dirX,dirZ);
        if(dl>0.0001f){dirX/=dl;dirZ/=dl;}

        const float zoomRatio=observerFrustumSize_/160.0f;
        const float speed=45.0f*std::pow(zoomRatio,0.95f);
        if(dl>0.0001f){
            observerVelX_+=dirX*speed*12.0f*dt;
            observerVelZ_+=dirZ*speed*12.0f*dt;
        }
        const float vel=std::hypot(observerVelX_,observerVelZ_);
        const float maxV=speed*1.5f;
        if(vel>maxV&&vel>0.0001f){
            observerVelX_=observerVelX_/vel*maxV;
            observerVelZ_=observerVelZ_/vel*maxV;
        }
        const float damping=std::exp(-7.0f*dt);
        observerVelX_*=damping;
        observerVelZ_*=damping;
        focus_.x+=observerVelX_*dt;
        focus_.z+=observerVelZ_*dt;

        // Pan com esquerdo/meio, mesma projeção de PlayerMovement.
        if(input_.panDeltaX!=0.0f||input_.panDeltaY!=0.0f){
            RECT rc{};GetClientRect(hwnd_,&rc);
            const float h=std::max(1L,rc.bottom-rc.top);
            const float panFactor=(observerFrustumSize_/h)*1.1f;
            const float cosY=std::cos(observerYaw_);
            const float sinY=std::sin(observerYaw_);
            const float moveX=(-input_.panDeltaX*cosY-input_.panDeltaY*sinY)*panFactor;
            const float moveZ=( input_.panDeltaX*sinY-input_.panDeltaY*cosY)*panFactor;
            focus_.x+=moveX;
            focus_.z+=moveZ;
        }
        focus_.y=0.0f;
        camera_=observerEye();
    }

    void updateFirstPersonControls(float dt) {
        // Mouse look do FirstPersonController: arrasto esquerdo.
        if(input_.lookDeltaX!=0.0f||input_.lookDeltaY!=0.0f){
            yaw_-=input_.lookDeltaX*0.0026f;
            pitch_-=input_.lookDeltaY*0.0026f;
            pitch_=std::clamp(pitch_,-1.46f,1.46f);
        }

        float ix=0.0f,iy=0.0f;
        if(keyPressed('W')||keyPressed(VK_UP))iy+=1.0f;
        if(keyPressed('S')||keyPressed(VK_DOWN))iy-=1.0f;
        if(keyPressed('A')||keyPressed(VK_LEFT))ix-=1.0f;
        if(keyPressed('D')||keyPressed(VK_RIGHT))ix+=1.0f;
        const float il=std::hypot(ix,iy);
        if(il>0.0f){ix/=il;iy/=il;}

        const float forwardX=-std::sin(yaw_);
        const float forwardZ=-std::cos(yaw_);
        const float rightX=std::cos(yaw_);
        const float rightZ=-std::sin(yaw_);
        float dirX=forwardX*iy+rightX*ix;
        float dirZ=forwardZ*iy+rightZ*ix;
        const float len=std::hypot(dirX,dirZ);
        if(len>0.0001f){dirX/=len;dirZ/=len;}

        const bool sprint=keyPressed(VK_SHIFT);
        const float baseSpeed=sprint?13.0f:6.5f;
        const float targetSpeed=len>0.0f?baseSpeed*std::min(1.0f,len):0.0f;
        const float tvx=dirX*targetSpeed,tvz=dirZ*targetSpeed;
        const float blend=std::min(dt*(len>0.0f?18.0f:9.0f),1.0f);
        fpsVelX_+=(tvx-fpsVelX_)*blend;
        fpsVelZ_+=(tvz-fpsVelZ_)*blend;

        // Mesmo anti-penetração em encostas do original.
        float stepDx=fpsVelX_*dt,stepDz=fpsVelZ_*dt;
        const float stepDist=std::hypot(stepDx,stepDz);
        if(stepDist>0.0001f){
            const float currentH=heightAt(camera_.x,camera_.z);
            const float probeDist=std::max(stepDist,0.45f);
            const float dirPX=stepDx/stepDist,dirPZ=stepDz/stepDist;
            const float probeH=heightAt(camera_.x+dirPX*probeDist,camera_.z+dirPZ*probeDist);
            const float slope=(probeH-currentH)/probeDist;
            if(slope>0.85f){
                const float eps=0.4f;
                const float hL=heightAt(camera_.x-eps,camera_.z);
                const float hR=heightAt(camera_.x+eps,camera_.z);
                const float hD=heightAt(camera_.x,camera_.z-eps);
                const float hU=heightAt(camera_.x,camera_.z+eps);
                const float gx=(hR-hL)/(2.0f*eps),gz=(hU-hD)/(2.0f*eps);
                const float gl=std::hypot(gx,gz);
                if(gl>0.001f){
                    const float tx=-gz/gl,tz=gx/gl;
                    const float d=fpsVelX_*tx+fpsVelZ_*tz;
                    fpsVelX_=tx*d*0.65f;fpsVelZ_=tz*d*0.65f;
                }else{
                    fpsVelX_=fpsVelZ_=0.0f;
                }
            }
        }

        camera_.x+=fpsVelX_*dt;
        camera_.z+=fpsVelZ_*dt;

        const float targetY=std::max(heightAt(camera_.x,camera_.z),-0.3f)+1.75f;
        if(camera_.y<targetY)camera_.y=targetY;
        else{
            camera_.y+=(targetY-camera_.y)*std::min(dt*15.0f,1.0f);
            if(camera_.y<targetY)camera_.y=targetY;
        }

        // Head bob original.
        const float currentSpeed=std::hypot(fpsVelX_,fpsVelZ_);
        if(currentSpeed>0.5f){
            fpsBobTimer_+=dt*(sprint?12.5f:8.5f);
            const float bobTarget=std::sin(fpsBobTimer_)*0.045f*(currentSpeed/6.5f);
            fpsBob_+=(bobTarget-fpsBob_)*std::min(dt*15.0f,1.0f);
        }else{
            fpsBob_+=(0.0f-fpsBob_)*std::min(dt*8.0f,1.0f);
        }
    }

    void updateCamera(float dt) {
        const bool tabNow=keyPressed(VK_TAB);
        const bool fNow=keyPressed('F');
        const bool modeNow=tabNow||fNow;
        if(modeNow&&!tabDown_&&transitionMode_==0){
            if(observerMode_)enterFirstPersonAtFocus();
            else exitFirstPersonToObserver();
        }
        tabDown_=modeNow;

        const bool escNow=keyPressed(VK_ESCAPE);
        if(escNow&&!escapeDown_&&!observerMode_&&transitionMode_==0)exitFirstPersonToObserver();
        escapeDown_=escNow;

        if(transitionMode_!=0) updateCameraTransition(dt);
        else if(observerMode_) updateObserverControls(dt);
        else updateFirstPersonControls(dt);

        input_.clearTransient();
    }

    static std::string chunkKey(int cx,int cz) {
        return std::to_string(cx)+":"+std::to_string(cz);
    }

    std::vector<ObjectSeed> decodeVegetationObjects(const VegetationCpu& src) {
        constexpr size_t stride=23;
        if(src.data.size()%stride!=0) throw std::runtime_error("Vegetation stream stride invalido.");
        std::vector<ObjectSeed> out;
        out.reserve(src.data.size()/stride);
        for(size_t o=0;o<src.data.size();o+=stride){
            const int planType=static_cast<int>(std::round(src.data[o]));
            ObjectSeed obj{};
            obj.kind=nativeKindForPlanType(planType);
            obj.planType=planType;
            for(int k=0;k<16;k++)obj.matrix[k]=src.data[o+1+k];
            obj.exactMatrix=true;
            obj.x=obj.matrix[12];obj.y=obj.matrix[13];obj.z=obj.matrix[14];
            const bool treePlan=planType>=0&&planType<=16;
            const size_t tintOff=17,leafOff=20;
            const size_t colOff=treePlan?leafOff:tintOff;
            obj.r=src.data[o+colOff+0];
            obj.g=src.data[o+colOff+1];
            obj.b=src.data[o+colOff+2];
            out.push_back(obj);
        }
        return out;
    }

    void rebuildObjectsFromVegetation() {
        size_t total=0;
        for(const auto& [k,v]:chunkVegetation_)total+=v.objects.size();
        objects_.clear();
        objects_.reserve(total);
        for(const auto& [k,v]:chunkVegetation_)
            objects_.insert(objects_.end(),v.objects.begin(),v.objects.end());
    }

    static std::string horizonKey(int level,int tx,int tz) {
        return std::to_string(level)+":"+std::to_string(tx)+":"+std::to_string(tz);
    }

    static std::string impostorKey(int tx,int tz){
        return std::to_string(tx)+":"+std::to_string(tz);
    }

    int activeViewRadius() const { return observerMode_?6:5; }

    void planExactStreaming(float x,float z,bool force=false) {
        if(!exactStreamer_||!horizonStreamer_)return;
        const int cx=static_cast<int>(std::floor((x+32.0f)/64.0f));
        const int cz=static_cast<int>(std::floor((z+32.0f)/64.0f));
        if(force||cx!=exactCenterCx_||cz!=exactCenterCz_){
            exactCenterCx_=cx;exactCenterCz_=cz;streamGeneration_++;
            const int r=activeViewRadius();
            const int viewSq=r*r+1;
            for(int dz=-r;dz<=r;dz++){
                for(int dx=-r;dx<=r;dx++){
                    const int d2=dx*dx+dz*dz;
                    if(d2>viewSq)continue;
                    const int ccx=cx+dx,ccz=cz+dz;
                    const int ring=std::max(std::abs(dx),std::abs(dz));
                    const float density=ring<=1?1.75f:1.25f;
                    const int segments=ring<=4?16:8;
                    const bool walls=(64.0f/segments)<=4.0f;
                    auto it=exactChunks_.find(chunkKey(ccx,ccz));
                    if(it!=exactChunks_.end()&&it->second.segments==segments&&std::abs(it->second.density-density)<0.001f)continue;
                    exactStreamer_->requestChunk(ccx,ccz,density,segments,walls,static_cast<double>(d2),streamGeneration_);
                }
            }

            // Vegetação original: raio 3; flora detalhada: raio 1.
            for(int dz=-3;dz<=3;dz++){
                for(int dx=-3;dx<=3;dx++){
                    const int d2=dx*dx+dz*dz;
                    if(d2>9)continue;
                    const int vcx=cx+dx,vcz=cz+dz;
                    const bool detail=d2<=1;
                    const std::string vkey=chunkKey(vcx,vcz);
                    auto vit=chunkVegetation_.find(vkey);
                    if(vit==chunkVegetation_.end()||vit->second.detail!=detail)
                        exactStreamer_->requestVegetation(vcx,vcz,detail,static_cast<double>(d2)+0.35,streamGeneration_);
                }
            }

            bool vegRemoved=false;
            for(auto it=chunkVegetation_.begin();it!=chunkVegetation_.end();){
                // parseia coordenadas guardadas no próprio primeiro objeto quando possível; para
                // chunks vazios usa a chave cx:cz.
                const auto colon=it->first.find(':');
                const int vcx=std::stoi(it->first.substr(0,colon));
                const int vcz=std::stoi(it->first.substr(colon+1));
                const int dx=vcx-cx,dz=vcz-cz;
                if(dx*dx+dz*dz>9){it=chunkVegetation_.erase(it);vegRemoved=true;}
                else ++it;
            }
            if(vegRemoved)rebuildObjectsFromVegetation();

            // Retenção igual à ideia do ChunkManager: margem de dois chunks para não regenerar
            // a cada pequena travessia de borda.
            const int keep=r+2,keepSq=keep*keep;
            bool removed=false;
            for(auto it=exactChunks_.begin();it!=exactChunks_.end();){
                const int dx=it->second.cx-cx,dz=it->second.cz-cz;
                if(dx*dx+dz*dz>keepSq){
                    if(!removed){vkDeviceWaitIdle(device_);removed=true;}
                    destroyExactChunk(it->second);
                    it=exactChunks_.erase(it);
                }else ++it;
            }
        }

        // WaterBiomeMap original: rebuild quando a câmera sai de 20% do span (307.2m).
        if(worldReady_ && (
            !waterBiomeReady_ ||
            std::hypot(x-waterBiomeRequestedX_,z-waterBiomeRequestedZ_)>1536.0f*0.20f
        )){
            waterBiomeRequestedX_=x;
            waterBiomeRequestedZ_=z;
            exactStreamer_->requestWaterBiome(x,z,4.0,streamGeneration_);
        }

        // Distant Horizons original, nível 0. O preset "integrada fraca" mantém 1 nível a 55%.
        if(worldReady_&&(force||std::hypot(x-lastHorizonPlanX_,z-lastHorizonPlanZ_)>=200.0f)){
            lastHorizonPlanX_=x;lastHorizonPlanZ_=z;
            constexpr float size=1024.0f;
            constexpr int seg=64;
            constexpr float outer=3000.0f*0.55f;
            constexpr float overlap=250.0f;
            constexpr float lower=0.8f;
            const float reach=outer+overlap;

            std::unordered_set<std::string> wanted;
            wantedImpostors_.clear();
            const int t0x=static_cast<int>(std::floor((x-reach)/size));
            const int t1x=static_cast<int>(std::floor((x+reach)/size));
            const int t0z=static_cast<int>(std::floor((z-reach)/size));
            const int t1z=static_cast<int>(std::floor((z+reach)/size));
            for(int tx=t0x;tx<=t1x;tx++){
                for(int tz=t0z;tz<=t1z;tz++){
                    const float minX=tx*size,minZ=tz*size;
                    const float nx=std::max({minX-x,0.0f,x-(minX+size)});
                    const float nz=std::max({minZ-z,0.0f,z-(minZ+size)});
                    const float nearD=std::hypot(nx,nz);
                    if(nearD>reach)continue;
                    const std::string key=horizonKey(0,tx,tz);
                    wanted.insert(key);
                    if(!horizonTiles_.contains(key))
                        horizonStreamer_->requestHorizon(0,tx,tz,minX,minZ,size,seg,lower,nearD,streamGeneration_);
                    // HorizonTerrain.requestTrees(): blocos 256m do nível 0, perto primeiro.
                    constexpr float B=256.0f;
                    constexpr float treeOuter=3000.0f*0.55f;
                    const float ox=minX+size*0.5f,oz=minZ+size*0.5f;
                    for(float bz=minZ;bz<minZ+size;bz+=B){
                        for(float bx=minX;bx<minX+size;bx+=B){
                            const float bnx=std::max({bx-x,0.0f,x-(bx+B)});
                            const float bnz=std::max({bz-z,0.0f,z-(bz+B)});
                            const float bnear=std::hypot(bnx,bnz);
                            if(bnear>treeOuter)continue;
                            const int btx=static_cast<int>(std::floor(bx/B));
                            const int btz=static_cast<int>(std::floor(bz/B));
                            const std::string ikey=impostorKey(btx,btz);
                            wantedImpostors_.insert(ikey);
                            if(!impostorBlocks_.contains(ikey))
                                horizonStreamer_->requestImpostors(
                                    btx,btz,bx,bz,B,ox,oz,
                                    300.0+bnear/10.0,streamGeneration_
                                );
                        }
                    }
                }
            }
            wantedHorizon_=std::move(wanted);

            bool impRemoved=false;
            for(auto it=impostorBlocks_.begin();it!=impostorBlocks_.end();){
                if(!wantedImpostors_.contains(it->first)){
                    if(!impRemoved){vkDeviceWaitIdle(device_);impRemoved=true;}
                    destroyImpostorBlock(it->second);
                    it=impostorBlocks_.erase(it);
                }else ++it;
            }

            bool removed=false;
            for(auto it=horizonTiles_.begin();it!=horizonTiles_.end();){
                if(!wantedHorizon_.contains(it->first)){
                    if(!removed){vkDeviceWaitIdle(device_);removed=true;}
                    destroyHorizon(it->second);
                    it=horizonTiles_.erase(it);
                }else ++it;
            }
        }
    }

    void processExactStreaming() {
        if(!exactStreamer_||!horizonStreamer_)return;
        std::string err;
        if(exactStreamer_->takeError(err))throw std::runtime_error("Chunk worker: "+err);
        if(horizonStreamer_->takeError(err))throw std::runtime_error("Horizon worker: "+err);

        // No máximo um upload pesado de chunk por quadro para não criar hitch.
        ExactStreamResult r;
        if(exactStreamer_->take(r)){
            if(auto* wb=std::get_if<WaterBiomeCpu>(&r.payload)){
                vkDeviceWaitIdle(device_);
                TextureGpu fresh=createTextureRgba(wb->rgba,wb->width,wb->height);
                destroyTexture(waterBiomeTexture_);
                waterBiomeTexture_=std::move(fresh);
                waterBiomeOriginX_=wb->originX;
                waterBiomeOriginZ_=wb->originZ;
                waterBiomeSpan_=wb->span;
                waterBiomeCenterX_=wb->originX+wb->span*0.5f;
                waterBiomeCenterZ_=wb->originZ+wb->span*0.5f;
                waterBiomeReady_=true;
                updateWaterDescriptor();
            } else if(auto* veg=std::get_if<VegetationCpu>(&r.payload)){
                const int dx=veg->cx-exactCenterCx_,dz=veg->cz-exactCenterCz_;
                if(dx*dx+dz*dz<=9){
                    ChunkVegetationNative entry{};
                    entry.detail=veg->detail;
                    entry.objects=decodeVegetationObjects(*veg);
                    chunkVegetation_[chunkKey(veg->cx,veg->cz)]=std::move(entry);
                    rebuildObjectsFromVegetation();
                }
            } else if(auto* cpu=std::get_if<ExactChunkCpu>(&r.payload)){
                const int dx=cpu->cx-exactCenterCx_,dz=cpu->cz-exactCenterCz_;
                const int keep=activeViewRadius()+2;
                if(dx*dx+dz*dz<=keep*keep){
                    const std::string key=chunkKey(cpu->cx,cpu->cz);
                    auto fresh=uploadExactChunk(std::move(*cpu));
                    auto it=exactChunks_.find(key);
                    if(it!=exactChunks_.end()){
                        vkDeviceWaitIdle(device_);
                        destroyExactChunk(it->second);
                        it->second=std::move(fresh);
                    }else exactChunks_.emplace(key,std::move(fresh));

                    if(!worldReady_&&exactChunks_.contains(chunkKey(spawnCx_,spawnCz_))){
                        worldReady_=true;
                        focus_={spawnX_,0.0f,spawnZ_};
                        camera_=observerEye();
                        logLine("APP: chunk de spawn pronto; streaming continua em background");
                    }
                }
            }
        }

        // Horizonte tem worker separado e recebe um upload por quadro.
        ExactStreamResult hr;
        if(horizonStreamer_->take(hr)){
            if(auto* imp=std::get_if<ImpostorBlockCpu>(&hr.payload)){
                const std::string key=impostorKey(imp->tx,imp->tz);
                if(wantedImpostors_.contains(key)&&!imp->indices.empty()){
                    auto fresh=uploadImpostorBlock(std::move(*imp));
                    auto it=impostorBlocks_.find(key);
                    if(it!=impostorBlocks_.end()){
                        vkDeviceWaitIdle(device_);
                        destroyImpostorBlock(it->second);
                        it->second=std::move(fresh);
                    }else impostorBlocks_.emplace(key,std::move(fresh));
                }
            }else if(auto* cpu=std::get_if<HorizonTileCpu>(&hr.payload)){
                const std::string key=horizonKey(cpu->level,cpu->tx,cpu->tz);
                if(wantedHorizon_.contains(key)){
                    const float chunkEnd=std::max(160.0f,(activeViewRadius()-0.8f)*64.0f);
                    const float hole=chunkEnd-120.0f;
                    auto fresh=uploadHorizon(std::move(*cpu),hole,3000.0f*0.55f);
                    auto it=horizonTiles_.find(key);
                    if(it!=horizonTiles_.end()){
                        vkDeviceWaitIdle(device_);
                        destroyHorizon(it->second);
                        it->second=std::move(fresh);
                    }else horizonTiles_.emplace(key,std::move(fresh));
                }
            }
        }
    }

    void updateStreaming() {
        const Vec3 anchor=transitionMode_!=0?transitionPos_:(observerMode_?focus_:camera_);
        planExactStreaming(anchor.x,anchor.z,false);
        processExactStreaming();
    }

    float objectFadeHash(float x,float z) const {
        const float px=std::floor(x*4.0f);
        const float pz=std::floor(z*4.0f);
        const float v=std::sin(px*12.9898f+pz*78.233f)*43758.5453f;
        return v-std::floor(v);
    }

    float smooth01(float a,float b,float x) const {
        const float t=std::clamp((x-a)/(b-a),0.0f,1.0f);
        return t*t*(3.0f-2.0f*t);
    }

    bool pixelTreeObjectVisible(const ObjectSeed& o,float planarDistance) const {
        // WorldEngine.updateObserverPosition(): vegetation radius=3 -> vegEnd=(3-0.8)*64=140.8.
        constexpr float vegEnd=(3.0f-0.8f)*64.0f;
        const float h=objectFadeHash(o.x,o.z);

        const bool treeFade=(o.planType>=0&&o.planType<=19);
        if(treeFade){
            constexpr float start=vegEnd-0.05f;
            const float fade=smooth01(start,vegEnd,planarDistance);
            return h<=1.0f-fade;
        }

        constexpr float start=vegEnd-90.0f;
        const float fade=smooth01(start,vegEnd,planarDistance);
        return h<=1.0f-fade;
    }

    int choosePixelTreeVariant(const ObjectSeed& o,int presetId) const {
        int count=0;
        while(pixelTreeAssets_.contains(pixelTreeAssetKey(presetId,count)))count++;
        if(count<=1)return 0;

        const uint32_t species=original::PRNG::hashString(PIXEL_TREE_PRESETS[static_cast<size_t>(presetId)]);
        const int32_t hx=static_cast<int32_t>(std::lround(o.matrix[12]*8.0f));
        const int32_t hz=static_cast<int32_t>(std::lround(o.matrix[14]*8.0f));
        const double r=original::PRNG::hash2D(
            hx,hz,
            (pixelTreeWorldSeed_^species)
        );
        return std::min(count-1,static_cast<int>(std::floor(r*count)));
    }

    InstanceGPU instanceFromObject(const ObjectSeed& o,bool white=false) const {
        InstanceGPU inst{};
        if(o.exactMatrix){
            std::memcpy(inst.m,o.matrix.data(),sizeof(inst.m));
        }else{
            const float cs=std::cos(o.rotation),sn=std::sin(o.rotation),s=o.scale;
            inst.m[0]=cs*s; inst.m[1]=0; inst.m[2]=sn*s; inst.m[3]=0;
            inst.m[4]=0; inst.m[5]=s; inst.m[6]=0; inst.m[7]=0;
            inst.m[8]=-sn*s; inst.m[9]=0; inst.m[10]=cs*s; inst.m[11]=0;
            inst.m[12]=o.x;inst.m[13]=o.y;inst.m[14]=o.z;inst.m[15]=1;
        }
        inst.r=white?1.0f:o.r;
        inst.g=white?1.0f:o.g;
        inst.b=white?1.0f:o.b;
        inst.a=1.0f;
        return inst;
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
        for(auto& v:visible_)v.clear();
        for(auto& [key,a]:pixelTreeAssets_)a.visible.clear();

        Vec3 eye{};
        Vec3 viewDir{};
        Vec3 fadeCenter{};
        if(transitionMode_!=0){
            eye=transitionPos_;
            viewDir=normalize(transitionLook_-transitionPos_);
            fadeCenter=transitionLook_;
        }else if(observerMode_){
            eye=observerEye();
            viewDir=normalize(focus_-eye);
            fadeCenter=focus_;
        }else{
            eye={camera_.x,camera_.y+fpsBob_,camera_.z};
            viewDir=normalize({
                -std::sin(yaw_)*std::cos(pitch_),
                 std::sin(pitch_),
                -std::cos(yaw_)*std::cos(pitch_)
            });
            fadeCenter=camera_;
        }

        for(const auto& o:objects_) {
            const float dx=o.x-eye.x,dy=o.y-eye.y,dz=o.z-eye.z;
            const float d=std::sqrt(dx*dx+dy*dy+dz*dz);
            const float fdx=o.x-fadeCenter.x,fdz=o.z-fadeCenter.z;
            const float planarDistance=std::hypot(fdx,fdz);

            if(d>90.0f){
                const Vec3 dir=normalize({dx,dy,dz});
                if(dot(dir,viewDir)<-0.30f)continue;
            }

            const int presetId=pixelPresetForPlanType(o.planType,o.r,o.g,o.b);
            if(presetId>=0){
                if(!pixelTreeObjectVisible(o,planarDistance))continue;
                const int variant=choosePixelTreeVariant(o,presetId);
                auto it=pixelTreeAssets_.find(pixelTreeAssetKey(presetId,variant));
                if(it==pixelTreeAssets_.end())continue;
                auto& vis=it->second.visible;
                if(vis.size()>=PIXEL_TREE_MAX_INSTANCES)continue;
                // PixelTreeAssetLibrary usa WHITE para instanceColor: a cor final já está no asset.
                vis.push_back(instanceFromObject(o,true));
                continue;
            }

            int kind=o.kind;
            if(kind<0||kind>=MESH_KIND_COUNT)continue;
            if(d>maxDistanceForKind(kind))continue;

            if(visible_[kind].size()>=MAX_INSTANCES_PER_MESH)continue;
            visible_[kind].push_back(instanceFromObject(o,false));
        }

        for(int i=0;i<MESH_KIND_COUNT;i++){
            if(!visible_[i].empty())
                std::memcpy(instanceBuffers_[i].mapped,visible_[i].data(),visible_[i].size()*sizeof(InstanceGPU));
        }

        for(auto& [key,a]:pixelTreeAssets_){
            if(!a.visible.empty())
                std::memcpy(a.instanceBuffer.mapped,a.visible.data(),a.visible.size()*sizeof(InstanceGPU));
        }
    }

    struct CameraState {
        Mat4 view{};
        Mat4 proj{};
        Mat4 viewProj{};
        Vec3 eye{};
        Vec3 forward{};
        float nearPlane=0.1f;
        float farPlane=14000.0f;
        float focusDistance=0.0f;
        bool orthographic=false;
    };

    CameraState currentCameraState(bool reflected=false) const {
        CameraState s{};
        const float aspect=static_cast<float>(swapExtent_.width)/std::max(1u,swapExtent_.height);

        if(transitionMode_!=0){
            s.eye=transitionPos_;
            s.forward=normalize(transitionLook_-transitionPos_);
            s.nearPlane=0.1f;s.farPlane=14000.0f;
            s.proj=perspectiveVulkan(transitionFov_*PI/180.0f,aspect,s.nearPlane,s.farPlane);
            s.focusDistance=length(transitionPos_-transitionLook_);
        }else if(observerMode_){
            s.eye=observerEye();
            const Vec3 target{focus_.x,focus_.y,focus_.z};
            s.forward=normalize(target-s.eye);
            s.nearPlane=0.5f;s.farPlane=3500.0f;s.orthographic=true;
            const float half=observerFrustumSize_*0.5f;
            s.proj=orthographicVulkan(-half*aspect,half*aspect,-half,half,s.nearPlane,s.farPlane);
            s.focusDistance=length(s.eye-target);
        }else{
            s.eye={camera_.x,camera_.y+fpsBob_,camera_.z};
            s.forward=normalize({
                -std::sin(yaw_)*std::cos(pitch_),
                 std::sin(pitch_),
                -std::cos(yaw_)*std::cos(pitch_)
            });
            s.nearPlane=0.2f;s.farPlane=14000.0f;
            s.proj=perspectiveVulkan(75.0f*PI/180.0f,aspect,s.nearPlane,s.farPlane);
        }

        if(reflected&&!s.orthographic){
            const Vec3 target=s.eye+s.forward*100.0f;
            s.eye.y=-s.eye.y;
            Vec3 reflectedTarget=target;
            reflectedTarget.y=-reflectedTarget.y;
            s.forward=normalize(reflectedTarget-s.eye);
            s.view=lookAt(s.eye,reflectedTarget,{0,-1,0});
        }else{
            s.view=lookAt(s.eye,s.eye+s.forward,{0,1,0});
        }
        s.viewProj=multiply(s.proj,s.view);
        return s;
    }

    PushConstants makePush(const CameraState& cam) const {
        const bool aerial=(transitionMode_!=0)||observerMode_;
        const float fogNear=aerial?std::max(180.0f,cam.focusDistance+120.0f):12.0f;
        const float fogFar=aerial?std::max(1000.0f,cam.focusDistance+700.0f):1400.0f;

        PushConstants p{};
        p.viewProj=cam.viewProj;
        p.cameraFog[0]=cam.eye.x;p.cameraFog[1]=cam.eye.y;p.cameraFog[2]=cam.eye.z;p.cameraFog[3]=fogNear;
        p.sunAmbient[0]=0.45452f;p.sunAmbient[1]=0.70711f;p.sunAmbient[2]=-0.54168f;p.sunAmbient[3]=0.34f;
        p.environment[0]=time_;p.environment[1]=fogFar;p.environment[2]=0.0f;p.environment[3]=1.0f;
        p.terrain[0]=p.terrain[1]=p.terrain[2]=p.terrain[3]=0.0f;
        return p;
    }

    void updateWaterUniforms(const CameraState& cam,const CameraState& reflectedCam){
        WaterUniformsGpu w{};

        const Vec3 anchor=transitionMode_!=0?transitionPos_:(observerMode_?focus_:camera_);
        const float snapX=std::round(anchor.x/8.0f)*8.0f;
        const float snapZ=std::round(anchor.z/8.0f)*8.0f;
        w.model=waterModelMatrix(snapX,snapZ);
        w.viewProj=cam.viewProj;
        w.reflectTextureMatrix=multiply(textureBiasMatrix(),reflectedCam.viewProj);

        w.cameraPosTime[0]=cam.eye.x;w.cameraPosTime[1]=cam.eye.y;w.cameraPosTime[2]=cam.eye.z;w.cameraPosTime[3]=time_;
        w.waterParams0[0]=0.16f;w.waterParams0[1]=1.2f;w.waterParams0[2]=1.2f;w.waterParams0[3]=0.65f;
        w.waterParams1[0]=0.8f;w.waterParams1[1]=0.785f;w.waterParams1[2]=0.92f;w.waterParams1[3]=0.16f;

        const Vec3 deep=linearHex(0x0284c7u),shallow=linearHex(0x00d2ffu);
        const Vec3 foam=linearHex(0xffffffu),crest=linearHex(0xbbf2f6u);
        w.deepColor[0]=deep.x;w.deepColor[1]=deep.y;w.deepColor[2]=deep.z;
        w.shallowColor[0]=shallow.x;w.shallowColor[1]=shallow.y;w.shallowColor[2]=shallow.z;
        w.foamColor[0]=foam.x;w.foamColor[1]=foam.y;w.foamColor[2]=foam.z;
        w.crestColor[0]=crest.x;w.crestColor[1]=crest.y;w.crestColor[2]=crest.z;

        w.lightDirMode[0]=0.45452f;w.lightDirMode[1]=0.70711f;w.lightDirMode[2]=-0.54168f;
        w.lightDirMode[3]=cam.orthographic?1.0f:0.0f;

        const bool aerial=(transitionMode_!=0)||observerMode_;
        const float fogNear=aerial?std::max(180.0f,cam.focusDistance+120.0f):12.0f;
        const float fogFar=aerial?std::max(1000.0f,cam.focusDistance+700.0f):1400.0f;
        const Vec3 fog=linearHex(0x88bce8u);
        const Vec3 corona=linearHex(0xffe69cu);
        w.fogColorNear[0]=fog.x;w.fogColorNear[1]=fog.y;w.fogColorNear[2]=fog.z;w.fogColorNear[3]=fogNear;
        w.fogSunColorFar[0]=corona.x;w.fogSunColorFar[1]=corona.y;w.fogSunColorFar[2]=corona.z;w.fogSunColorFar[3]=fogFar;
        w.fogSunDirOn[0]=0.45452f;w.fogSunDirOn[1]=0.70711f;w.fogSunDirOn[2]=-0.54168f;w.fogSunDirOn[3]=1.0f;

        w.resolutionTexel[0]=static_cast<float>(sceneTarget_.width);
        w.resolutionTexel[1]=static_cast<float>(sceneTarget_.height);
        w.resolutionTexel[2]=8.0f;
        w.resolutionTexel[3]=1.0f;

        w.biomeOriginSpanReady[0]=waterBiomeOriginX_;
        w.biomeOriginSpanReady[1]=waterBiomeOriginZ_;
        w.biomeOriginSpanReady[2]=waterBiomeSpan_;
        w.biomeOriginSpanReady[3]=waterBiomeReady_?1.0f:0.0f;

        w.cameraNearFarActive[0]=cam.nearPlane;
        w.cameraNearFarActive[1]=cam.farPlane;
        w.cameraNearFarActive[2]=0.0f;
        w.cameraNearFarActive[3]=0.0f;

        std::memcpy(waterUniformBuffer_.mapped,&w,sizeof(w));
    }

    void setDynamicViewport(VkCommandBuffer cmd,uint32_t width,uint32_t height){
        VkViewport vp{0,0,static_cast<float>(width),static_cast<float>(height),0,1};
        VkRect2D sc{{0,0},{width,height}};
        vkCmdSetViewport(cmd,0,1,&vp);
        vkCmdSetScissor(cmd,0,1,&sc);
    }

    void drawWorldGeometry(VkCommandBuffer cmd,const PushConstants& base,bool reflectionPass){
        vkCmdBindPipeline(cmd,VK_PIPELINE_BIND_POINT_GRAPHICS,pipeline_);
        VkDeviceSize off[2]={0,0};
        const float modeOffset=reflectionPass?10.0f:0.0f;

        if(!horizonTiles_.empty()){
            PushConstants p=base;
            p.environment[2]=2.0f+modeOffset;
            const float chunkEnd=std::max(160.0f,(activeViewRadius()-0.8f)*64.0f);
            p.terrain[2]=chunkEnd-120.0f;
            p.terrain[3]=3000.0f*0.55f;
            vkCmdBindDescriptorSets(cmd,VK_PIPELINE_BIND_POINT_GRAPHICS,pipelineLayout_,0,1,&descriptorSet_,0,nullptr);
            vkCmdPushConstants(cmd,pipelineLayout_,VK_SHADER_STAGE_VERTEX_BIT|VK_SHADER_STAGE_FRAGMENT_BIT,0,sizeof(p),&p);
            for(const auto& [key,h]:horizonTiles_){
                if(!h.mesh.indexCount)continue;
                VkBuffer bufs[2]={h.mesh.vb.buffer,dummyInstance_.buffer};
                vkCmdBindVertexBuffers(cmd,0,2,bufs,off);
                vkCmdBindIndexBuffer(cmd,h.mesh.ib.buffer,0,VK_INDEX_TYPE_UINT32);
                vkCmdDrawIndexed(cmd,h.mesh.indexCount,1,0,0,0);
            }
        }

        if(!impostorBlocks_.empty()){
            PushConstants pi=base;
            pi.environment[2]=4.0f+modeOffset;
            const Vec3 center=transitionMode_!=0?transitionLook_:(observerMode_?focus_:camera_);
            pi.terrain[0]=center.x;
            pi.terrain[1]=center.z;
            pi.terrain[2]=0.0f;
            pi.terrain[3]=3000.0f*0.55f;
            vkCmdBindDescriptorSets(cmd,VK_PIPELINE_BIND_POINT_GRAPHICS,pipelineLayout_,0,1,&impostorDescriptor_,0,nullptr);
            vkCmdPushConstants(cmd,pipelineLayout_,VK_SHADER_STAGE_VERTEX_BIT|VK_SHADER_STAGE_FRAGMENT_BIT,0,sizeof(pi),&pi);
            for(const auto& [key,b]:impostorBlocks_){
                if(!b.mesh.indexCount)continue;
                VkBuffer bufs[2]={b.mesh.vb.buffer,dummyInstance_.buffer};
                vkCmdBindVertexBuffers(cmd,0,2,bufs,off);
                vkCmdBindIndexBuffer(cmd,b.mesh.ib.buffer,0,VK_INDEX_TYPE_UINT32);
                vkCmdDrawIndexed(cmd,b.mesh.indexCount,1,0,0,0);
            }
        }

        for(const auto& [key,ch]:exactChunks_){
            if(!ch.mesh.indexCount)continue;
            PushConstants p=base;
            p.environment[2]=1.0f+modeOffset;
            p.environment[3]=ch.density;
            p.terrain[0]=ch.cx*64.0f-32.0f;
            p.terrain[1]=ch.cz*64.0f-32.0f;
            p.terrain[2]=64.0f;
            p.terrain[3]=std::max(160.0f,(activeViewRadius()-0.8f)*64.0f);
            vkCmdBindDescriptorSets(cmd,VK_PIPELINE_BIND_POINT_GRAPHICS,pipelineLayout_,0,1,&ch.descriptor,0,nullptr);
            vkCmdPushConstants(cmd,pipelineLayout_,VK_SHADER_STAGE_VERTEX_BIT|VK_SHADER_STAGE_FRAGMENT_BIT,0,sizeof(p),&p);
            VkBuffer bufs[2]={ch.mesh.vb.buffer,dummyInstance_.buffer};
            vkCmdBindVertexBuffers(cmd,0,2,bufs,off);
            vkCmdBindIndexBuffer(cmd,ch.mesh.ib.buffer,0,VK_INDEX_TYPE_UINT32);
            vkCmdDrawIndexed(cmd,ch.mesh.indexCount,1,0,0,0);
        }

        for(const auto& [assetKey,asset]:pixelTreeAssets_){
            if(asset.visible.empty())continue;
            for(const auto& part:asset.parts){
                if(!part.mesh.indexCount)continue;
                PushConstants pt=base;
                pt.environment[2]=3.0f+modeOffset;
                pt.environment[3]=1.0f;
                pt.terrain[0]=part.repeatX;
                pt.terrain[1]=part.repeatY;
                pt.terrain[2]=part.alphaTest;
                pt.terrain[3]=part.flipY?1.0f:0.0f;
                vkCmdBindDescriptorSets(cmd,VK_PIPELINE_BIND_POINT_GRAPHICS,pipelineLayout_,0,1,&part.descriptor,0,nullptr);
                vkCmdPushConstants(cmd,pipelineLayout_,VK_SHADER_STAGE_VERTEX_BIT|VK_SHADER_STAGE_FRAGMENT_BIT,0,sizeof(pt),&pt);
                VkBuffer bufs[2]={part.mesh.vb.buffer,asset.instanceBuffer.buffer};
                vkCmdBindVertexBuffers(cmd,0,2,bufs,off);
                vkCmdBindIndexBuffer(cmd,part.mesh.ib.buffer,0,VK_INDEX_TYPE_UINT32);
                vkCmdDrawIndexed(cmd,part.mesh.indexCount,static_cast<uint32_t>(asset.visible.size()),0,0,0);
            }
        }

        PushConstants p=base;
        p.environment[2]=0.0f+modeOffset;
        p.environment[3]=1.0f;
        vkCmdBindDescriptorSets(cmd,VK_PIPELINE_BIND_POINT_GRAPHICS,pipelineLayout_,0,1,&descriptorSet_,0,nullptr);
        vkCmdPushConstants(cmd,pipelineLayout_,VK_SHADER_STAGE_VERTEX_BIT|VK_SHADER_STAGE_FRAGMENT_BIT,0,sizeof(p),&p);
        for(int i=0;i<MESH_KIND_COUNT;i++){
            if(visible_[i].empty())continue;
            VkBuffer bufs[2]={meshes_[i].vb.buffer,instanceBuffers_[i].buffer};
            vkCmdBindVertexBuffers(cmd,0,2,bufs,off);
            vkCmdBindIndexBuffer(cmd,meshes_[i].ib.buffer,0,VK_INDEX_TYPE_UINT32);
            vkCmdDrawIndexed(cmd,meshes_[i].indexCount,static_cast<uint32_t>(visible_[i].size()),0,0,0);
        }
    }

    void beginScenePass(
        VkCommandBuffer cmd,
        const SceneTargetGpu& target,
        const VkClearColorValue& clearColor
    ){
        VkClearValue clear[2]{};
        clear[0].color=clearColor;
        clear[1].depthStencil={1.0f,0};
        VkRenderPassBeginInfo ri{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
        ri.renderPass=renderPass_;
        ri.framebuffer=target.framebuffer;
        ri.renderArea.extent={target.width,target.height};
        ri.clearValueCount=2;
        ri.pClearValues=clear;
        vkCmdBeginRenderPass(cmd,&ri,VK_SUBPASS_CONTENTS_INLINE);
        setDynamicViewport(cmd,target.width,target.height);
    }

    void record(VkCommandBuffer cmd,uint32_t imageIndex) {
        VkCommandBufferBeginInfo bi{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        check(vkBeginCommandBuffer(cmd,&bi),"vkBeginCommandBuffer");

        const CameraState cam=currentCameraState(false);
        const CameraState reflectedCam=currentCameraState(true);
        const PushConstants mainPush=makePush(cam);
        const VkClearColorValue skyClear{{0.144f,0.394f,0.823f,1.0f}};

        // Passo 1 do original: reflexão planar só em primeira pessoa e em frequência reduzida.
        const bool shouldReflect=!observerMode_&&transitionMode_==0&&
            (!reflectionValid_||(time_-lastReflectionUpdate_)>=0.20f);
        if(shouldReflect){
            beginScenePass(cmd,reflectionTarget_,skyClear);
            PushConstants reflectedPush=makePush(reflectedCam);
            drawWorldGeometry(cmd,reflectedPush,true);
            vkCmdEndRenderPass(cmd);
            reflectionValid_=true;
            lastReflectionUpdate_=time_;
        }else if(!reflectionValid_){
            const VkClearColorValue black{{0,0,0,1}};
            beginScenePass(cmd,reflectionTarget_,black);
            vkCmdEndRenderPass(cmd);
            reflectionValid_=true;
        }

        // Passo 2: mundo opaco sem água, com depth amostrável.
        beginScenePass(cmd,sceneTarget_,skyClear);
        drawWorldGeometry(cmd,mainPush,false);
        vkCmdEndRenderPass(cmd);

        updateWaterUniforms(cam,reflectedCam);

        // Passos 3/4: blit da cena opaca para o canvas e WaterShader original por cima.
        VkClearValue presentClear{};
        presentClear.color={{0,0,0,1}};
        VkRenderPassBeginInfo pri{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
        pri.renderPass=presentRenderPass_;
        pri.framebuffer=framebuffers_[imageIndex];
        pri.renderArea.extent=swapExtent_;
        pri.clearValueCount=1;
        pri.pClearValues=&presentClear;
        vkCmdBeginRenderPass(cmd,&pri,VK_SUBPASS_CONTENTS_INLINE);
        setDynamicViewport(cmd,swapExtent_.width,swapExtent_.height);

        vkCmdBindPipeline(cmd,VK_PIPELINE_BIND_POINT_GRAPHICS,blitPipeline_);
        vkCmdBindDescriptorSets(cmd,VK_PIPELINE_BIND_POINT_GRAPHICS,blitPipelineLayout_,0,1,&blitDescriptorSet_,0,nullptr);
        vkCmdDraw(cmd,3,1,0,0);

        if(waterMesh_.indexCount){
            vkCmdBindPipeline(cmd,VK_PIPELINE_BIND_POINT_GRAPHICS,waterPipeline_);
            vkCmdBindDescriptorSets(cmd,VK_PIPELINE_BIND_POINT_GRAPHICS,waterPipelineLayout_,0,1,&waterDescriptorSet_,0,nullptr);
            VkDeviceSize off=0;
            vkCmdBindVertexBuffers(cmd,0,1,&waterMesh_.vb.buffer,&off);
            vkCmdBindIndexBuffer(cmd,waterMesh_.ib.buffer,0,VK_INDEX_TYPE_UINT32);
            vkCmdDrawIndexed(cmd,waterMesh_.indexCount,1,0,0,0);
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
        int propDraws=0;
        for(const auto& v:visible_){visibleTotal+=v.size();if(!v.empty())propDraws++;}
        size_t pixelTrees=0;int pixelDraws=0;
        for(const auto& [k,a]:pixelTreeAssets_){
            pixelTrees+=a.visible.size();
            if(!a.visible.empty())pixelDraws+=static_cast<int>(a.parts.size());
        }
        std::wostringstream ss;
        ss<<L"Pixel Island Native | Vulkan | "
          <<deviceProps_.deviceName
          <<L" | "<<static_cast<int>(fps)<<L" FPS"
          <<L" | "<<static_cast<int>(ms*10.0)/10.0<<L" ms"
          <<L" | "<<(observerMode_?L"OBSERVADOR":L"FPS")
          <<L" | Chunks "<<exactChunks_.size()
          <<L" | Horizon "<<horizonTiles_.size()
          <<L" | Impostors "<<impostorBlocks_.size()
          <<L" | Fila "<<(exactStreamer_?exactStreamer_->pendingCount():0)
          <<L"/"<<(horizonStreamer_?horizonStreamer_->pendingCount():0)
          <<L" | PixelTree "<<pixelTrees
          <<L" | Props "<<visibleTotal
          <<L" | Draws "<<(exactChunks_.size()+horizonTiles_.size()+impostorBlocks_.size()+propDraws+pixelDraws)
          <<L" | TAB modo";
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

            // Mesmo durante a tela de carregamento os workers continuam entregando chunks.
            updateStreaming();
            if(!worldReady_) {
                SetWindowTextW(hwnd_,L"Pixel Island Native | Gerando chunk central...");
                InvalidateRect(hwnd_,nullptr,FALSE);
                Sleep(8);
                continue;
            }

            updateCamera(dt);
            // A câmera pode ter cruzado a borda de um chunk neste mesmo quadro.
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
        for(auto f:framebuffers_)if(f)vkDestroyFramebuffer(device_,f,nullptr);
        framebuffers_.clear();

        destroySceneTarget(sceneTarget_);
        destroySceneTarget(reflectionTarget_);

        if(pipeline_)vkDestroyPipeline(device_,pipeline_,nullptr);
        pipeline_=VK_NULL_HANDLE;
        if(blitPipeline_)vkDestroyPipeline(device_,blitPipeline_,nullptr);
        blitPipeline_=VK_NULL_HANDLE;
        if(waterPipeline_)vkDestroyPipeline(device_,waterPipeline_,nullptr);
        waterPipeline_=VK_NULL_HANDLE;

        if(renderPass_)vkDestroyRenderPass(device_,renderPass_,nullptr);
        renderPass_=VK_NULL_HANDLE;
        if(presentRenderPass_)vkDestroyRenderPass(device_,presentRenderPass_,nullptr);
        presentRenderPass_=VK_NULL_HANDLE;

        for(auto v:swapViews_)if(v)vkDestroyImageView(device_,v,nullptr);
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
        if(postDescriptorPool_)refreshPostDescriptors();
    }

    void cleanup() {
        if(device_!=VK_NULL_HANDLE) {
            for(auto& [k,ch]:exactChunks_)destroyExactChunk(ch);
            exactChunks_.clear();
            for(auto& [k,h]:horizonTiles_)destroyHorizon(h);
            horizonTiles_.clear();
            for(auto& [k,b]:impostorBlocks_)destroyImpostorBlock(b);
            impostorBlocks_.clear();

            destroyPostProcessResources();
            destroyPixelTreeAssets();
            for(int i=0;i<MESH_KIND_COUNT;i++){destroyMesh(meshes_[i]);destroyBuffer(instanceBuffers_[i]);}
            destroyBuffer(dummyInstance_);
            destroyBuffer(terrainVB_);destroyBuffer(terrainIB_);
            for(int i=0;i<MAX_FRAMES_IN_FLIGHT;i++) {
                if(imageAvailable_[i])vkDestroySemaphore(device_,imageAvailable_[i],nullptr);
                if(renderFinished_[i])vkDestroySemaphore(device_,renderFinished_[i],nullptr);
                if(inFlight_[i])vkDestroyFence(device_,inFlight_[i],nullptr);
            }
            destroyTexture(impostorAtlasTexture_);
            destroyTexture(fallbackTexture_);
            destroyTexture(wallTexture_);
            destroyBuffer(impostorInfoBuffer_);
            if(pixelRepeatSampler_)vkDestroySampler(device_,pixelRepeatSampler_,nullptr);
            if(pixelClampSampler_)vkDestroySampler(device_,pixelClampSampler_,nullptr);
            if(wallTextureSampler_)vkDestroySampler(device_,wallTextureSampler_,nullptr);
            if(terrainTextureSampler_)vkDestroySampler(device_,terrainTextureSampler_,nullptr);
            if(terrainTextureView_)vkDestroyImageView(device_,terrainTextureView_,nullptr);
            if(terrainTextureImage_)vkDestroyImage(device_,terrainTextureImage_,nullptr);
            if(terrainTextureMemory_)vkFreeMemory(device_,terrainTextureMemory_,nullptr);
            if(descriptorPool_)vkDestroyDescriptorPool(device_,descriptorPool_,nullptr);

            if(commandPool_)vkDestroyCommandPool(device_,commandPool_,nullptr);
            cleanupSwapchain();

            if(waterPipelineLayout_)vkDestroyPipelineLayout(device_,waterPipelineLayout_,nullptr);
            if(blitPipelineLayout_)vkDestroyPipelineLayout(device_,blitPipelineLayout_,nullptr);
            if(pipelineLayout_)vkDestroyPipelineLayout(device_,pipelineLayout_,nullptr);
            if(waterDescriptorSetLayout_)vkDestroyDescriptorSetLayout(device_,waterDescriptorSetLayout_,nullptr);
            if(blitDescriptorSetLayout_)vkDestroyDescriptorSetLayout(device_,blitDescriptorSetLayout_,nullptr);
            if(descriptorSetLayout_)vkDestroyDescriptorSetLayout(device_,descriptorSetLayout_,nullptr);
            vkDestroyDevice(device_,nullptr);
            device_=VK_NULL_HANDLE;
        }
        if(surface_)vkDestroySurfaceKHR(instance_,surface_,nullptr);
        if(instance_)vkDestroyInstance(instance_,nullptr);
        if(hwnd_&&IsWindow(hwnd_))DestroyWindow(hwnd_);
    }

private:
    HWND hwnd_=nullptr;
    NativeInput input_{};
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
    VkRenderPass presentRenderPass_=VK_NULL_HANDLE;
    VkFormat sceneColorFormat_=VK_FORMAT_R8G8B8A8_UNORM;
    SceneTargetGpu sceneTarget_{};
    SceneTargetGpu reflectionTarget_{};
    VkDescriptorSetLayout descriptorSetLayout_=VK_NULL_HANDLE;
    VkDescriptorSetLayout blitDescriptorSetLayout_=VK_NULL_HANDLE;
    VkDescriptorSetLayout waterDescriptorSetLayout_=VK_NULL_HANDLE;
    VkDescriptorPool descriptorPool_=VK_NULL_HANDLE;
    VkDescriptorSet descriptorSet_=VK_NULL_HANDLE;
    VkPipelineLayout pipelineLayout_=VK_NULL_HANDLE;
    VkPipeline pipeline_=VK_NULL_HANDLE;
    VkPipelineLayout blitPipelineLayout_=VK_NULL_HANDLE;
    VkPipeline blitPipeline_=VK_NULL_HANDLE;
    VkPipelineLayout waterPipelineLayout_=VK_NULL_HANDLE;
    VkPipeline waterPipeline_=VK_NULL_HANDLE;
    VkImage depthImage_=VK_NULL_HANDLE;
    VkDeviceMemory depthMemory_=VK_NULL_HANDLE;
    VkImageView depthView_=VK_NULL_HANDLE;
    std::vector<VkFramebuffer> framebuffers_;

    VkImage terrainTextureImage_=VK_NULL_HANDLE;
    VkDeviceMemory terrainTextureMemory_=VK_NULL_HANDLE;
    VkImageView terrainTextureView_=VK_NULL_HANDLE;
    VkSampler terrainTextureSampler_=VK_NULL_HANDLE;
    VkSampler wallTextureSampler_=VK_NULL_HANDLE;
    VkSampler pixelClampSampler_=VK_NULL_HANDLE;
    VkSampler pixelRepeatSampler_=VK_NULL_HANDLE;
    TextureGpu fallbackTexture_{};
    TextureGpu wallTexture_{};
    TextureGpu impostorAtlasTexture_{};
    VkDescriptorSet impostorDescriptor_=VK_NULL_HANDLE;
    Buffer impostorInfoBuffer_{};

    WaterMeshGpu waterMesh_{};
    Buffer waterUniformBuffer_{};
    TextureGpu waterBiomeTexture_{};
    bool waterBiomeReady_=false;
    float waterBiomeOriginX_=0.0f,waterBiomeOriginZ_=0.0f,waterBiomeSpan_=1536.0f;
    float waterBiomeCenterX_=1e9f,waterBiomeCenterZ_=1e9f;
    float waterBiomeRequestedX_=1e9f,waterBiomeRequestedZ_=1e9f;
    VkSampler postLinearSampler_=VK_NULL_HANDLE;
    VkSampler waterDepthSampler_=VK_NULL_HANDLE;
    VkDescriptorPool postDescriptorPool_=VK_NULL_HANDLE;
    VkDescriptorSet blitDescriptorSet_=VK_NULL_HANDLE;
    VkDescriptorSet waterDescriptorSet_=VK_NULL_HANDLE;
    bool reflectionValid_=false;
    float lastReflectionUpdate_=-1e9f;
    bool terrainTextureInitialized_=false;
    float terrainTextureOriginX_=0.0f;
    float terrainTextureOriginZ_=0.0f;

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
    std::unordered_map<uint32_t,PixelTreeAssetGpu> pixelTreeAssets_;
    uint32_t pixelTreeWorldSeed_=0;
    std::vector<ObjectSeed> objects_;
    std::vector<float> terrainHeights_;

    Vec3 camera_{0,20,-160};
    Vec3 focus_{0,0,0};
    float yaw_=0.0f,pitch_=-0.05f;
    bool observerMode_=true;
    bool worldReady_=false;
    bool tabDown_=false;
    bool escapeDown_=false;

    // ObserverCamera + PlayerMovement originais.
    float observerPitch_=50.0f*PI/180.0f;
    float observerYaw_=42.0f*PI/180.0f;
    float observerTargetYaw_=42.0f*PI/180.0f;
    float observerFrustumSize_=160.0f;
    float observerTargetFrustumSize_=160.0f;
    float observerVelX_=0.0f,observerVelZ_=0.0f;

    // FirstPersonController original.
    float fpsVelX_=0.0f,fpsVelZ_=0.0f;
    float fpsBobTimer_=0.0f,fpsBob_=0.0f;

    // PlayerController transition camera.
    int transitionMode_=0; // 1 in, 2 out
    float transitionTimer_=0.0f,transitionDuration_=1.0f;
    Vec3 transitionStartPos_{},transitionTargetPos_{},transitionPos_{};
    Vec3 transitionStartLook_{},transitionTargetLook_{},transitionLook_{};
    float transitionStartFov_=45.0f,transitionTargetFov_=75.0f,transitionFov_=45.0f;
    float transitionTargetYaw_=0.0f,transitionTargetPitch_=0.0f;

    float fogFar_=720.0f;
    float time_=0.0f;
    int worldCenterX_=0,worldCenterZ_=0;
    int requestedCenterX_=0,requestedCenterZ_=0;
    std::unique_ptr<WorldStreamer> streamer_; // legado, não usado pelo pipeline exato
    std::unique_ptr<ExactStreamingWorker> exactStreamer_;
    std::unique_ptr<ExactStreamingWorker> horizonStreamer_;
    std::unordered_map<std::string,ExactChunkGpu> exactChunks_;
    std::unordered_map<std::string,ChunkVegetationNative> chunkVegetation_;
    std::unordered_map<std::string,HorizonGpu> horizonTiles_;
    std::unordered_map<std::string,ImpostorBlockGpu> impostorBlocks_;
    std::unordered_set<std::string> wantedHorizon_;
    std::unordered_set<std::string> wantedImpostors_;
    int exactCenterCx_=999999,exactCenterCz_=999999;
    float lastHorizonPlanX_=1e9f,lastHorizonPlanZ_=1e9f;
    uint64_t streamGeneration_=1;
    float spawnX_=0.0f,spawnZ_=0.0f,spawnElevation_=0.0f;
    int spawnCx_=0,spawnCz_=0;
};

} // namespace

int WINAPI wWinMain(HINSTANCE hInstance,HINSTANCE,LPWSTR,int) {
    initLog();
    try {
        logLine("APP: inicio");
        VulkanApp app;
        app.run(hInstance);
        logLine("APP: encerramento normal");
        return 0;
    } catch(const std::exception& e) {
        logLine(std::string("FATAL: ")+e.what());
        MessageBoxA(nullptr,e.what(),"Pixel Island Native - erro",MB_OK|MB_ICONERROR);
        return 1;
    }
}
