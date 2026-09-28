#pragma once
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

struct JSRuntime;
struct JSContext;
struct JSValue;

class JsWorldRuntime {
public:
    explicit JsWorldRuntime(const std::filesystem::path& scriptPath);
    ~JsWorldRuntime();

    JsWorldRuntime(const JsWorldRuntime&) = delete;
    JsWorldRuntime& operator=(const JsWorldRuntime&) = delete;

    std::vector<float> generateTerrain(
        const std::string& seed,
        double centerX,
        double centerZ,
        int segments,
        double size
    );

    std::vector<float> generateVegetation(
        const std::string& seed,
        int chunkX,
        int chunkZ,
        double chunkSize,
        bool detail
    );

    std::vector<uint8_t> generateChunkTexture(
        const std::string& seed,
        double minWorldX,
        double minWorldZ,
        double chunkSize,
        double density
    );

private:
    std::vector<uint8_t> callByteBuffer(
        const char* functionName,
        const std::vector<std::string>& stringArgs,
        const std::vector<double>& numberArgs
    );

    std::vector<float> callFloatBuffer(
        const char* functionName,
        const std::vector<std::string>& stringArgs,
        const std::vector<double>& numberArgs
    );

    [[noreturn]] void throwJsException(const char* context);
    JSRuntime* rt_ = nullptr;
    JSContext* ctx_ = nullptr;
};
