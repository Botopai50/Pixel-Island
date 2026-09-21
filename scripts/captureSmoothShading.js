import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\julia\\.gemini\\antigravity\\brain\\40dbf106-75ff-492e-8c3f-30ec0fe98531';

async function run() {
  console.log('=== Iniciando Capturas do Shade Smooth (Abordagem A) ===');

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: [
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[Browser ERROR]: ${msg.text()}`);
  });

  // 1. Captura da Ilha em Visão Aérea (Relevo Suave & Transições de Biomas)
  console.log('Navegando para o mundo procedural...');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 6000));

  await page.waitForFunction(() => !!window.__WORLD__ && !!window.__PLAYER__);

  // Ajusta câmera aérea para visão ampla e limpa
  await page.evaluate(() => {
    const cam = window.__PLAYER__.observerCamera;
    if (cam) {
      cam.targetFrustumSize = 850;
      cam.frustumSize = 850;
      cam.updateProjection();
    }
  });

  // Aguarda processamento de chunks
  for (let i = 0; i < 8; i++) {
    const qLen = await page.evaluate(() => window.__WORLD__?.chunkManager?.buildQueue?.length || 0);
    console.log(`Fila de chunks: ${qLen}`);
    if (qLen === 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 2000));

  const aerialPath = path.join(ARTIFACT_DIR, 'smooth_island_aerial.png');
  await page.screenshot({ path: aerialPath });
  console.log(`✓ Visão Aérea salva em: ${aerialPath}`);

  // 2. Busca um ponto ideal em Floresta Temperada para 1ª Pessoa
  const forestPoint = await page.evaluate(() => {
    const world = window.__WORLD__;
    for (let r = 20; r < 250; r += 5) {
      for (let angle = 0; angle < Math.PI * 2; angle += 0.25) {
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        const pt = world.queryPoint(x, z);
        if (!pt.isWater && pt.height > 6.0 && pt.slope < 0.25 && pt.biome.type.includes('Floresta')) {
          return { x, z, height: pt.height, biome: pt.biome.type };
        }
      }
    }
    return { x: 50, z: 50, height: 10, biome: 'Default' };
  });
  console.log('Ponto de Floresta selecionado:', forestPoint);

  // Transiciona para 1ª pessoa no bosque
  await page.evaluate((pos) => {
    const player = window.__PLAYER__;
    const world = window.__WORLD__;
    player.setPosition(pos.x, pos.z);
    world.updateObserverPosition(pos.x, pos.z);
    player.transitionToFirstPerson(pos.x, pos.z, world.getTerrainGenerator());
  }, forestPoint);

  await new Promise((r) => setTimeout(r, 3500));

  // Ajusta levemente a inclinação para ver o chão suave e as árvores
  await page.evaluate(() => {
    const fp = window.__PLAYER__.firstPersonController;
    if (fp) {
      fp.pitch = -0.08;
      fp.yaw = 0.6;
    }
  });
  await new Promise((r) => setTimeout(r, 1000));

  const forestShotPath = path.join(ARTIFACT_DIR, 'smooth_forest_firstperson.png');
  await page.screenshot({ path: forestShotPath });
  console.log(`✓ Primeira pessoa (Floresta) salva em: ${forestShotPath}`);

  // 3. Busca um ponto ideal de Praia / Orla para 1ª Pessoa
  const beachPoint = await page.evaluate(() => {
    const world = window.__WORLD__;
    for (let r = 100; r < 500; r += 6) {
      for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        const pt = world.queryPoint(x, z);
        if (!pt.isWater && pt.height >= 1.5 && pt.height <= 3.2 && pt.biome.type.includes('Praia')) {
          return { x, z, height: pt.height, biome: pt.biome.type };
        }
      }
    }
    return null;
  });
  console.log('Ponto de Praia selecionado:', beachPoint);

  if (beachPoint) {
    await page.evaluate((pos) => {
      const player = window.__PLAYER__;
      const world = window.__WORLD__;
      player.firstPersonController.setPosition(pos.x, pos.z, world.getTerrainGenerator());
      world.updateObserverPosition(pos.x, pos.z);
    }, beachPoint);

    await new Promise((r) => setTimeout(r, 3000));

    // Ajusta o olhar da praia para a água e coqueiros
    await page.evaluate(() => {
      const fp = window.__PLAYER__.firstPersonController;
      if (fp) {
        fp.pitch = -0.04;
        fp.yaw += 1.2;
      }
    });
    await new Promise((r) => setTimeout(r, 1000));

    const beachShotPath = path.join(ARTIFACT_DIR, 'smooth_beach_firstperson.png');
    await page.screenshot({ path: beachShotPath });
    console.log(`✓ Primeira pessoa (Praia) salva em: ${beachShotPath}`);
  }

  // 4. Showcase: Carvalho Adulto com Shade Smooth
  console.log('Navegando para Showcase (Carvalho Adulto)...');
  await page.goto('http://localhost:5173/showcase.html?item=oak', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const oakShot = path.join(ARTIFACT_DIR, 'smooth_showcase_oak.png');
  await page.screenshot({ path: oakShot });
  console.log(`✓ Showcase Carvalho salvo em: ${oakShot}`);

  // 5. Showcase: Rocha Arredondada (Boulder) com Shade Smooth
  console.log('Navegando para Showcase (Rocha Boulder)...');
  await page.goto('http://localhost:5173/showcase.html?item=rock_boulder', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const rockShot = path.join(ARTIFACT_DIR, 'smooth_showcase_rock.png');
  await page.screenshot({ path: rockShot });
  console.log(`✓ Showcase Rocha Boulder salvo em: ${rockShot}`);

  // 6. Showcase: Coqueiro com Shade Smooth
  console.log('Navegando para Showcase (Coqueiro)...');
  await page.goto('http://localhost:5173/showcase.html?item=palm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const palmShot = path.join(ARTIFACT_DIR, 'smooth_showcase_palm.png');
  await page.screenshot({ path: palmShot });
  console.log(`✓ Showcase Coqueiro salvo em: ${palmShot}`);

  await browser.close();
  console.log('=== Todas as capturas de validação do Shade Smooth foram concluídas com sucesso! ===');
}

run().catch((err) => {
  console.error('Erro na execução:', err);
  process.exit(1);
});
