// CI parity entrypoint
#include "original_world.hpp"
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

int main(int argc,char** argv){
    std::string seedText=argc>1?argv[1]:"Avalon";
    uint32_t seed=original::PRNG::hashString(seedText);
    original::TerrainCore world(seed);

    const std::vector<std::pair<double,double>> pts={
        {0,0},{32,64},{-64,32},{128,-96},{256,256},{-256,-256},
        {400,120},{-420,330},{700,-540},{-800,640},{1000,0},
        {0,1000},{-1000,0},{0,-1000},{1450,720},{-1300,900},
        {2200,-1750},{-2400,1900},{3200,0},{0,3200},{-3200,-3200},
        {77.25,-19.5},{511.5,511.5},{-613.125,204.875}
    };

    std::cout<<std::setprecision(17);
    for(const auto& [x,z]:pts){
        auto v=world.volcano().query(x,z);
        auto c=world.canyon().query(x,z,world.getDryHeight(x,z));
        auto g=world.geothermal().query(x,z,world.getDryHeight(x,z));
        std::cout<<x<<","<<z<<","<<world.getDryHeight(x,z)<<","
                 <<world.polarLatitudeZ(x,z)<<","<<v.influence<<","
                 <<c.influence<<","<<g.influence<<"\n";
    }
    return 0;
}
