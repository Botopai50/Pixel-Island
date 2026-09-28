# Pixel Island Native — C++20 + Vulkan

Esta branch é a migração nativa do Pixel-Island. O runtime final não usa HTML, Three.js, navegador ou Node.js.

## Sistemas já portados

- Vulkan + Win32 nativo;
- mundo procedural determinístico por seed;
- massas continentais/ilhas em grade;
- relevo macro + detalhes;
- praias e oceano;
- rio principal e lago interior;
- cânions;
- vulcão, cratera e lava;
- temperatura e umidade;
- biomas verdes, deserto, pântano e neve;
- árvores com três LODs;
- rochas;
- arbustos;
- grama;
- flores;
- cactos;
- gelo;
- cavernas;
- geotermia/geysers;
- landmarks;
- streaming do mundo em worker thread;
- instancing Vulkan para todas as classes de props;
- culling por distância/direção;
- fog para esconder o corte agressivo de LOD;
- água e lava animadas em um único passe;
- modo observador ortográfico;
- modo primeira pessoa;
- métricas no título da janela.

## Arquitetura

O gerador produz apenas dados do mundo. O renderer não cria um objeto C++ por árvore.

Exemplo:

seed -> WorldData -> buffers -> instancing -> LOD/culling -> Vulkan

Uma classe de objeto usa uma malha compartilhada e um único buffer de instâncias.

## Controles

### Geral

- TAB: alternar Observador / Primeira Pessoa
- 1: alcance baixo (520 m)
- 2: alcance médio (720 m)
- 3: alcance alto (980 m)
- Esc: sair

### Observador

- W/A/S/D: mover pelo mundo
- Setas esquerda/direita: girar
- Q/E: afastar/aproximar zoom
- Shift: movimento rápido

### Primeira pessoa

- W/A/S/D: andar
- Setas: olhar
- Shift: correr

## Performance

A versão nativa evita os custos mais pesados da antiga arquitetura:

- sem DOM;
- sem WebGL/Three.js;
- sem reflection pass duplicando a cena;
- sem milhares de objetos de cena;
- sem um material por árvore;
- geração procedural fora do render loop;
- poucos draws por classe de objeto;
- LOD agressivo;
- grama apenas perto;
- fog adaptado ao alcance.

## O que ainda não é uma cópia visual pixel-a-pixel da versão Three.js

A lógica estrutural do mundo está sendo portada, mas alguns sistemas visuais ainda usam equivalentes nativos mais baratos:

- árvores usam malhas Vulkan low-poly próprias nesta versão, não o asset final exportado do Pixel_Tree;
- água não usa a reflexão planar antiga;
- o SMSR ainda não foi reimplementado integralmente;
- recifes e gelo avançado ainda usam representação simplificada;
- UI de Texture Forge/Pegman ainda não foi portada;
- áudio ainda não está no runtime nativo.

Isso é intencional nesta etapa: primeiro manter o jogo funcional e rápido; depois substituir cada representação simplificada pelo equivalente visual final sem mudar a arquitetura.

## Executar

Extraia o pacote e execute `INICIAR.bat` ou `PixelIslandNative.exe`.

Requisito: driver de vídeo com Vulkan.

## Compilar

Requisitos:

- Visual Studio 2022/2026 com Desktop development with C++;
- CMake;
- vcpkg.

Defina `VCPKG_ROOT` e execute `build_windows.bat`.

O build usa Vulkan-Headers/Vulkan-Loader. Shaders GLSL são compilados para SPIR-V no pipeline.
