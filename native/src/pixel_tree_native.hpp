#pragma once
#include <cstdint>
#include <filesystem>
#include <string>
#include <unordered_map>
#include <vector>

struct PixelTreeCpuPart {
    std::string name;
    uint32_t flags=0;
    float repeatX=1.0f,repeatY=1.0f;
    float alphaTest=0.0f;
    float materialR=1.0f,materialG=1.0f,materialB=1.0f;
    uint32_t texW=1,texH=1;
    std::vector<float> positions;
    std::vector<float> normals;
    std::vector<float> uvs;
    std::vector<float> colors;
    std::vector<uint32_t> indices;
    std::vector<uint8_t> rgba;
};

struct PixelTreeCpuAsset {
    uint16_t presetId=0;
    uint16_t variant=0;
    std::vector<PixelTreeCpuPart> parts;
};

class PixelTreeCpuLibrary {
public:
    void load(const std::filesystem::path& path);
    const PixelTreeCpuAsset* find(uint16_t presetId,uint16_t variant) const;
    int variantCount(uint16_t presetId) const;
    uint32_t worldSeed() const { return worldSeed_; }
    size_t assetCount() const { return assets_.size(); }

private:
    static uint32_t key(uint16_t presetId,uint16_t variant){
        return (static_cast<uint32_t>(presetId)<<16)|variant;
    }
    uint32_t worldSeed_=0;
    std::unordered_map<uint32_t,PixelTreeCpuAsset> assets_;
    std::unordered_map<uint16_t,int> variantCounts_;
};
