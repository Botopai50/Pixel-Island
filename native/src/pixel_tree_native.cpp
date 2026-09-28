#include "pixel_tree_native.hpp"

#include <cstring>
#include <fstream>
#include <stdexcept>

namespace {
struct Reader {
    std::vector<uint8_t> bytes;
    size_t o=0;

    explicit Reader(const std::filesystem::path& path){
        std::ifstream f(path,std::ios::binary);
        if(!f)throw std::runtime_error("pixel_tree_assets.bin nao encontrado.");
        f.seekg(0,std::ios::end);
        const auto n=f.tellg();
        f.seekg(0,std::ios::beg);
        bytes.resize(static_cast<size_t>(n));
        if(!bytes.empty())f.read(reinterpret_cast<char*>(bytes.data()),static_cast<std::streamsize>(bytes.size()));
    }
    void need(size_t n)const{
        if(o+n>bytes.size())throw std::runtime_error("pixel_tree_assets.bin truncado.");
    }
    uint16_t u16(){need(2);uint16_t v;std::memcpy(&v,bytes.data()+o,2);o+=2;return v;}
    uint32_t u32(){need(4);uint32_t v;std::memcpy(&v,bytes.data()+o,4);o+=4;return v;}
    float f32(){need(4);float v;std::memcpy(&v,bytes.data()+o,4);o+=4;return v;}
    std::string str(size_t n){
        need(n);std::string s(reinterpret_cast<const char*>(bytes.data()+o),n);o+=n;
        o=(o+3u)&~size_t(3u);
        return s;
    }
    template<class T> std::vector<T> array(size_t count){
        const size_t n=count*sizeof(T);need(n);
        std::vector<T> out(count);
        if(n)std::memcpy(out.data(),bytes.data()+o,n);
        o+=n;return out;
    }
};
}

void PixelTreeCpuLibrary::load(const std::filesystem::path& path){
    Reader r(path);
    if(r.u32()!=0x41544950u)throw std::runtime_error("pixel_tree_assets.bin magic invalido.");
    if(r.u32()!=1u)throw std::runtime_error("pixel_tree_assets.bin versao invalida.");
    const uint32_t assetCount=r.u32();
    const uint32_t presetCount=r.u32();
    worldSeed_=r.u32();
    (void)presetCount;

    assets_.clear();
    variantCounts_.clear();

    for(uint32_t a=0;a<assetCount;a++){
        PixelTreeCpuAsset asset{};
        asset.presetId=r.u16();
        asset.variant=r.u16();
        const uint16_t partCount=r.u16();
        (void)r.u16();

        asset.parts.reserve(partCount);
        for(uint16_t p=0;p<partCount;p++){
            PixelTreeCpuPart part{};
            const uint32_t nameLen=r.u32();
            const uint32_t vertexCount=r.u32();
            const uint32_t indexCount=r.u32();
            part.texW=r.u32();
            part.texH=r.u32();
            part.flags=r.u32();
            part.repeatX=r.f32();
            part.repeatY=r.f32();
            part.alphaTest=r.f32();
            part.materialR=r.f32();
            part.materialG=r.f32();
            part.materialB=r.f32();
            part.name=r.str(nameLen);
            part.positions=r.array<float>(static_cast<size_t>(vertexCount)*3u);
            part.normals=r.array<float>(static_cast<size_t>(vertexCount)*3u);
            part.uvs=r.array<float>(static_cast<size_t>(vertexCount)*2u);
            part.colors=r.array<float>(static_cast<size_t>(vertexCount)*3u);
            part.indices=r.array<uint32_t>(indexCount);
            part.rgba=r.array<uint8_t>(static_cast<size_t>(part.texW)*part.texH*4u);
            asset.parts.push_back(std::move(part));
        }

        variantCounts_[asset.presetId]=std::max(
            variantCounts_[asset.presetId],
            static_cast<int>(asset.variant)+1
        );
        assets_.emplace(key(asset.presetId,asset.variant),std::move(asset));
    }

    if(assets_.empty())throw std::runtime_error("Pixel_Tree asset library vazia.");
}

const PixelTreeCpuAsset* PixelTreeCpuLibrary::find(uint16_t presetId,uint16_t variant) const{
    auto it=assets_.find(key(presetId,variant));
    return it==assets_.end()?nullptr:&it->second;
}

int PixelTreeCpuLibrary::variantCount(uint16_t presetId) const{
    auto it=variantCounts_.find(presetId);
    return it==variantCounts_.end()?0:it->second;
}
