# Pixel Island Native — C++20 + Vulkan

Protótipo nativo criado para medir se uma arquitetura C++/Vulkan consegue entregar um ganho real de desempenho antes de portar o jogo inteiro.

## O que já existe

- executável Windows nativo, sem navegador e sem Node.js;
- Vulkan 1.0 + swapchain Win32;
- terreno procedural por seed;
- geração do mundo em thread separada;
- streaming por células de 256 m;
- milhares de árvores procedurais distribuídas de forma determinística;
- árvores renderizadas com instancing;
- três LODs de árvore;
- culling por distância e direção;
- fog para esconder o corte agressivo de distância;
- iluminação toon simples;
- profundidade real;
- no máximo quatro draws principais por frame:
  - terreno;
  - árvores LOD0;
  - árvores LOD1;
  - árvores LOD2;
- métricas no título da janela: GPU, FPS, frame time, árvores e LODs.

## Objetivo

Este não é ainda o port completo do Pixel-Island.

A ideia é testar no hardware alvo se o núcleo nativo realmente vale a migração. Se esse protótipo já rodar muito melhor que a versão Three.js, o próximo passo é portar por etapas:

1. sistema de chunks/clipmap de terreno;
2. assets reais do Pixel_Tree;
3. GPU culling e indirect drawing;
4. água;
5. sombras;
6. biomas;
7. landmarks;
8. gameplay.

## Controles

- W / A / S / D: mover;
- Espaço: subir;
- Ctrl: descer;
- Shift: movimento rápido;
- Setas esquerda/direita: girar;
- Setas cima/baixo: inclinar câmera;
- Esc: sair.

## Rodar

Extraia o ZIP e execute:

`INICIAR.bat`

ou diretamente:

`PixelIslandNative.exe`

Os arquivos `.spv` precisam permanecer dentro da pasta `shaders`.

## Requisito de runtime

É necessário um driver de vídeo com Vulkan instalado. Em GPUs Intel isso normalmente vem junto do driver gráfico atual.

Se aparecer a mensagem "Nenhuma GPU com Vulkan encontrada", atualize o driver Intel antes de concluir que a GPU não suporta o protótipo.

## Compilar do fonte no Windows

Requisitos:

- Visual Studio 2022 com "Desktop development with C++";
- CMake;
- vcpkg;
- glslangValidator ou shaders `.spv` já compilados.

Defina:

`VCPKG_ROOT=C:\vcpkg`

Depois execute:

`build_windows.bat`

O projeto usa apenas Vulkan-Headers/Vulkan-Loader como dependência de renderização. A janela e input usam Win32 diretamente.
