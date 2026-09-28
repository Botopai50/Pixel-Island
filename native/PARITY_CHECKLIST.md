# Pixel-Island Native Vulkan — 1:1 Parity Gate

Este arquivo é o contrato de aceitação do port nativo.

**Regra:** nenhum ZIP pode ser chamado de "1:1" enquanto existir qualquer item `PARTIAL` ou `MISSING`.
O objetivo é o mesmo Pixel-Island, com o mesmo resultado visual/procedural/comportamental, trocando apenas a infraestrutura por C++20 + Vulkan + threads/cache.

## Mundo procedural

| Sistema | Fonte original | Estado |
|---|---|---|
| Seed / PRNG | seedManager.ts, prng.ts | DONE |
| TerrainGenerator | terrainGenerator.ts | DONE |
| Macro geography | macroGeography.ts | DONE |
| Canyon | canyonGenerator.ts | DONE |
| Volcano generator | volcanoGenerator.ts | DONE |
| Geothermal generator | geothermalGenerator.ts | DONE |
| Hydrology | hydrology.ts | DONE |
| Biomes | biomes.ts | DONE |
| Chunk geometry | chunkGeometry.ts | DONE |
| Chunk 64x64 streaming | chunkManager.ts | DONE |
| Chunk LOD / morph | chunk.ts, terrainShader.ts | PARTIAL |
| Terrain Texture Forge topTex | terrainTextureForge.ts | DONE |
| Terrain Texture Forge topDarkTex | terrainTextureForge.ts | DONE |
| Wall A/B/C/D | terrainTextureForge.ts | DONE |
| Terrain shader completo | terrainShader.ts | PARTIAL |
| Distant Horizons geometry | horizonGeometry.ts | DONE |
| Distant Horizons streaming | horizonTerrain.ts | PARTIAL |
| Horizon pixel shader | horizonTerrain.ts | PARTIAL |
| Horizon tree impostors | horizonTrees.ts | MISSING |
| Water biome map | waterBiomeMap.ts | MISSING |

## Vegetação

| Sistema | Fonte original | Estado |
|---|---|---|
| Vegetation planner | vegetationPlanner.ts | DONE |
| Transformações por chunk | vegetationPlanner.ts | DONE |
| Vegetation radius/detail radius | chunkManager.ts | DONE |
| Pixel_Tree geometria real | pixelTreeAdapter.ts / Pixel_Tree | MISSING |
| Pixel_Tree folhas/atlas real | pixelTreeAdapter.ts | MISSING |
| Pixel_Tree materiais finais | pixelTreeAdapter.ts | MISSING |
| Botanical geometry | botanicalGeometryFactory.ts | MISSING |
| Grass sprites | grassSprites.ts | MISSING |
| Vegetation textures | vegetationTextures.ts | MISSING |
| Instance pooling | instancePool.ts | MISSING |
| Vegetation culling | vegetationManager.ts | MISSING |
| Shadow participation | vegetationManager.ts | MISSING |

## Água / lava / gelo / mundo especial

| Sistema | Fonte original | Estado |
|---|---|---|
| Ocean geometry | waterGeometry.ts | MISSING |
| Pixel water shader | waterShader.ts | MISSING |
| Scene color refraction | main.ts | MISSING |
| Depth texture shoreline | main.ts | MISSING |
| Foam / shoreline | waterShader.ts | MISSING |
| Ripples | worldEngine.ts / waterShader.ts | MISSING |
| Planar reflection | main.ts | MISSING |
| Water presets | waterShader.ts | MISSING |
| Inland water | inlandWaterManager.ts | MISSING |
| Lava shader | lavaShader.ts | MISSING |
| Lava fluid manager | lavaFluidManager.ts | MISSING |
| Glacial ice | glacialIceManager.ts | MISSING |
| Geothermal features | geothermalManager.ts | MISSING |
| Cave features | caveFeatureManager.ts | MISSING |
| Coral reefs | coralReefManager.ts | MISSING |
| Landmarks | landmarkManager.ts | MISSING |

## Atmosfera / iluminação / sombras

| Sistema | Fonte original | Estado |
|---|---|---|
| Atmospheric fog equations | atmosphericFog.ts | PARTIAL |
| SkyAtmosphere timing/colors | skyAtmosphere.ts | MISSING |
| Skybox | skybox.ts | MISSING |
| Sun direction/color | skyAtmosphere.ts | PARTIAL |
| Ambient color | skyAtmosphere.ts | PARTIAL |
| Shadow clipmap | shadowClipmap.ts | MISSING |
| SMSR / current shadow path | vegetationManager.ts / shadow path | MISSING |
| Scene shadow refresh policy | main.ts | MISSING |

## Câmera / controles

| Sistema | Fonte original | Estado |
|---|---|---|
| InputManager keyboard | inputManager.ts | DONE |
| Mouse pan | inputManager.ts | DONE |
| Mouse observer rotation | inputManager.ts | DONE |
| Wheel zoom | inputManager.ts | DONE |
| PlayerMovement inertia | playerMovement.ts | DONE |
| ObserverCamera values | observerCamera.ts | DONE |
| FirstPerson movement | firstPersonController.ts | DONE |
| FirstPerson mouse look | firstPersonController.ts | DONE |
| Sprint | firstPersonController.ts | DONE |
| Steep slope collision | firstPersonController.ts | DONE |
| Head bob | firstPersonController.ts | DONE |
| Cinematic transition in/out | playerController.ts | DONE |
| Exact safe spawn | worldEngine.ts | DONE |
| Terrain raycaster | terrainRaycaster.ts | MISSING |
| Pegman drop workflow | pegmanWidget.ts | MISSING |
| Drop reticle | dropReticle.ts | MISSING |
| Pointer-lock behavior | firstPersonController.ts | PARTIAL |
| Touch controls | touchControlsWidget.ts | MISSING |

## Render pipeline

| Sistema | Fonte original | Estado |
|---|---|---|
| Vulkan swapchain | native | DONE |
| Depth buffer | main.ts equivalent | DONE |
| Pixel render scale | main.ts | MISSING |
| Pixelation toggle | main.ts | MISSING |
| FXAA pass | main.ts | MISSING |
| Scene render target | main.ts | MISSING |
| Water multipass ordering | main.ts | MISSING |
| Reflection render target | main.ts | MISSING |
| Quality presets | quality.ts | PARTIAL |
| Adaptive quality | quality.ts | MISSING |
| Resize behavior | main.ts/playerController.ts | PARTIAL |

## UI / ferramentas / áudio

| Sistema | Fonte original | Estado |
|---|---|---|
| Pegman UI | pegmanWidget.ts | MISSING |
| First-person exit UI | pegmanWidget.ts | MISSING |
| Texture Forge UI | textureForgeWidget.ts | MISSING |
| Touch UI | touchControlsWidget.ts | MISSING |
| Seed parameter / reseed flow | main.ts/worldEngine.ts | PARTIAL |
| Ambient sound | ambientSound.ts | MISSING |

## Gate de entrega

Um build só pode receber o nome **Pixel-Island Native 1:1** quando:

1. todos os itens acima estiverem `DONE`;
2. a mesma seed produzir o mesmo terreno, hidrologia, biomas e placements;
3. screenshots pareadas usarem mesma seed, posição, câmera, hora e preset;
4. controles forem comparados com os mesmos valores do TypeScript;
5. streaming for contínuo sem borda finita de mundo;
6. Distant Horizons e impostores funcionarem;
7. água/reflexos/refração/ripples baterem visualmente;
8. Pixel_Tree real substituir todas as malhas provisórias;
9. sombras/SMSR e atmosfera estiverem portados;
10. CI compilar, executar smoke tests e testes de paridade sem erro.

Até esse gate ficar verde, o executável deve ser tratado apenas como **build de desenvolvimento**, nunca como 1:1 final.
