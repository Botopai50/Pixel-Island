#include "js_world.hpp"
#include <cmath>
#include <filesystem>
#include <iostream>
#include <stdexcept>

int main(int argc,char** argv){
    if(argc<2) throw std::runtime_error("Uso: PixelIslandWorldSmoke <world.bundle.js>");
    JsWorldRuntime js(std::filesystem::path(argv[1]));

    auto terrain=js.generateTerrain("Avalon",0.0,0.0,16,64.0);
    const size_t expected=17u*17u*12u;
    if(terrain.size()!=expected) throw std::runtime_error("Terrain buffer size incorreto.");

    double minH=1e30,maxH=-1e30;
    for(size_t i=0;i<terrain.size();++i){
        if(!std::isfinite(terrain[i])) throw std::runtime_error("Terrain buffer contem NaN/Inf.");
    }
    for(size_t i=0;i<17u*17u;i++){
        const float h=terrain[i*12u+1u];
        minH=std::min(minH,static_cast<double>(h));
        maxH=std::max(maxH,static_cast<double>(h));
    }

    auto vegetation=js.generateVegetation("Avalon",0,0,64.0,true);
    if(vegetation.size()%23u!=0) throw std::runtime_error("Vegetation buffer stride incorreto.");
    for(float v:vegetation){
        if(!std::isfinite(v)) throw std::runtime_error("Vegetation buffer contem NaN/Inf.");
    }

    std::cout<<"OK terrainFloats="<<terrain.size()
             <<" height=["<<minH<<","<<maxH<<"]"
             <<" vegetationInstances="<<(vegetation.size()/23u)
             <<"\n";
    return 0;
}
