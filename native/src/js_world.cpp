#include "js_world.hpp"

extern "C" {
#include <quickjs.h>
}

#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>

static std::string readTextFile(const std::filesystem::path& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("Nao foi possivel abrir world.bundle.js.");
    std::ostringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

JsWorldRuntime::JsWorldRuntime(const std::filesystem::path& scriptPath) {
    rt_ = JS_NewRuntime();
    if (!rt_) throw std::runtime_error("JS_NewRuntime falhou.");
    ctx_ = JS_NewContext(rt_);
    if (!ctx_) {
        JS_FreeRuntime(rt_);
        rt_ = nullptr;
        throw std::runtime_error("JS_NewContext falhou.");
    }

    const std::string src = readTextFile(scriptPath);
    JSValue result = JS_Eval(
        ctx_,
        src.data(),
        src.size(),
        "world.bundle.js",
        JS_EVAL_TYPE_GLOBAL
    );

    if (JS_IsException(result)) {
        JS_FreeValue(ctx_, result);
        throwJsException("avaliando world.bundle.js");
    }
    JS_FreeValue(ctx_, result);
}

JsWorldRuntime::~JsWorldRuntime() {
    if (ctx_) JS_FreeContext(ctx_);
    if (rt_) JS_FreeRuntime(rt_);
}

[[noreturn]] void JsWorldRuntime::throwJsException(const char* context) {
    JSValue exc = JS_GetException(ctx_);
    const char* msg = JS_ToCString(ctx_, exc);
    std::string text = "QuickJS: ";
    text += context;
    text += ": ";
    text += msg ? msg : "(erro sem mensagem)";
    if (msg) JS_FreeCString(ctx_, msg);

    JSValue stack = JS_GetPropertyStr(ctx_, exc, "stack");
    if (!JS_IsUndefined(stack)) {
        const char* s = JS_ToCString(ctx_, stack);
        if (s) {
            text += "\n";
            text += s;
            JS_FreeCString(ctx_, s);
        }
    }
    JS_FreeValue(ctx_, stack);
    JS_FreeValue(ctx_, exc);
    throw std::runtime_error(text);
}

std::vector<uint8_t> JsWorldRuntime::callByteBuffer(
    const char* functionName,
    const std::vector<std::string>& stringArgs,
    const std::vector<double>& numberArgs
) {
    JSValue global = JS_GetGlobalObject(ctx_);
    JSValue fn = JS_GetPropertyStr(ctx_, global, functionName);
    if (!JS_IsFunction(ctx_, fn)) {
        JS_FreeValue(ctx_, fn);
        JS_FreeValue(ctx_, global);
        throw std::runtime_error(std::string("Funcao QuickJS ausente: ") + functionName);
    }

    std::vector<JSValue> args;
    args.reserve(stringArgs.size() + numberArgs.size());
    for (const auto& s : stringArgs) args.push_back(JS_NewStringLen(ctx_, s.data(), s.size()));
    for (double n : numberArgs) args.push_back(JS_NewFloat64(ctx_, n));

    JSValue ret = JS_Call(
        ctx_, fn, global,
        static_cast<int>(args.size()),
        args.data()
    );

    for (JSValue& v : args) JS_FreeValue(ctx_, v);
    JS_FreeValue(ctx_, fn);
    JS_FreeValue(ctx_, global);

    if (JS_IsException(ret)) {
        JS_FreeValue(ctx_, ret);
        throwJsException(functionName);
    }

    size_t byteSize = 0;
    uint8_t* bytes = JS_GetArrayBuffer(ctx_, &byteSize, ret);
    if (!bytes) {
        JS_FreeValue(ctx_, ret);
        throw std::runtime_error(std::string(functionName) + " nao retornou ArrayBuffer.");
    }

    std::vector<uint8_t> out(byteSize);
    if (byteSize) std::memcpy(out.data(), bytes, byteSize);
    JS_FreeValue(ctx_, ret);
    return out;
}

std::vector<float> JsWorldRuntime::callFloatBuffer(
    const char* functionName,
    const std::vector<std::string>& stringArgs,
    const std::vector<double>& numberArgs
) {
    auto bytes = callByteBuffer(functionName, stringArgs, numberArgs);
    if (bytes.size() % sizeof(float) != 0) {
        throw std::runtime_error(std::string(functionName) + " retornou buffer Float32 invalido.");
    }
    std::vector<float> out(bytes.size() / sizeof(float));
    if (!bytes.empty()) std::memcpy(out.data(), bytes.data(), bytes.size());
    return out;
}

std::vector<float> JsWorldRuntime::generateTerrain(
    const std::string& seed,
    double centerX,
    double centerZ,
    int segments,
    double size
) {
    return callFloatBuffer(
        "pixelGenerateTerrain",
        { seed },
        { centerX, centerZ, static_cast<double>(segments), size }
    );
}

std::vector<float> JsWorldRuntime::generateVegetation(
    const std::string& seed,
    int chunkX,
    int chunkZ,
    double chunkSize,
    bool detail
) {
    return callFloatBuffer(
        "pixelGenerateVegetation",
        { seed },
        {
            static_cast<double>(chunkX),
            static_cast<double>(chunkZ),
            chunkSize,
            detail ? 1.0 : 0.0
        }
    );
}


std::vector<uint8_t> JsWorldRuntime::generateChunkTexture(
    const std::string& seed,
    double minWorldX,
    double minWorldZ,
    double chunkSize,
    double density
) {
    return callByteBuffer(
        "pixelGenerateChunkTexture",
        { seed },
        { minWorldX, minWorldZ, chunkSize, density }
    );
}
