cmake_minimum_required(VERSION 3.24)
project(PixelIslandNative LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Vulkan REQUIRED)

add_executable(PixelIslandNative WIN32
    src/main.cpp
)

target_compile_definitions(PixelIslandNative PRIVATE
    VK_USE_PLATFORM_WIN32_KHR
    NOMINMAX
    WIN32_LEAN_AND_MEAN
    UNICODE
    _UNICODE
)

target_link_libraries(PixelIslandNative PRIVATE
    Vulkan::Vulkan
    user32
    gdi32
    shell32
)

if(MSVC)
    target_compile_options(PixelIslandNative PRIVATE /W4 /O2 /permissive-)
    target_link_options(PixelIslandNative PRIVATE /SUBSYSTEM:WINDOWS)
else()
    target_compile_options(PixelIslandNative PRIVATE -Wall -Wextra -O3)
endif()
