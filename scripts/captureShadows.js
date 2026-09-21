import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\julia\\.gemini\\antigravity\\brain\\40dbf106-75ff-492e-8c3f-30ec0fe98531';

async function run() {
  console.log('=== Iniciando Verificacao Visual de Iluminacao e Sombras ===');

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

  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('[Browser ERROR]:', msg.text());
      errors.push(msg.text());
    }
  });

  console.log('Carregando aplicacao no Vite...');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 6000));

  await page.waitForFunction(() => !!window.__WORLD__ && !!window.__PLAYER__ && !!window.__ATMOSPHERE__);

  console.log('Aguardando geracao de chunks...');
  for (let i = 0; i < 10; i++) {
    const qLen = await page.evaluate(() => window.__WORLD__?.chunkManager?.buildQueue?.length || 0);
    console.log('Fila de chunks:', qLen);
    if (qLen === 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 2000));

  await page.evaluate(() => {
    const cam = window.__PLAYER__.observerCamera;
    if (cam) {
      cam.targetFrustumSize = 800;
      cam.frustumSize = 800;
      cam.updateProjection();
    }
  });
  await new Promise((r) => setTimeout(r, 1500));

  const aerialPath = path.join(ARTIFACT_DIR, 'shadows_island_aerial.png');
  await page.screenshot({ path: aerialPath });
  console.log('Visao Aerea salva em:', aerialPath);

  // 2. Localiza árvore (Carvalho/Bétula) no mundo para primeiro plano com sombra
  const forestTarget = await page.evaluate(() => {
    const world = window.__WORLD__;
    let found = null;
    world.scene.traverse((obj) => {
      if (found) return;
      if (obj.isInstancedMesh && obj.count > 0 && obj.instanceMatrix) {
        const arr = obj.instanceMatrix.array;
        for (let i = 0; i < Math.min(obj.count, 40); i++) {
          const x = arr[i * 16 + 12];
          const y = arr[i * 16 + 13];
          const z = arr[i * 16 + 14];
          const pt = world.queryPoint(x, z);
          if (!pt.isWater && pt.slope < 0.20 && pt.height > 6.0 && pt.biome.type.includes('Floresta')) {
            found = { x, y, z };
            return;
          }
        }
      }
    });
    return found || { x: 30, y: 12, z: 30 };
  });
  console.log('Alvo arbóreo na floresta:', forestTarget);

  // Posiciona a câmera 9 metros ao sul do carvalho, olhando para o norte (em direção à árvore e sua sombra)
  await page.evaluate((target) => {
    const player = window.__PLAYER__;
    const world = window.__WORLD__;
    const camX = target.x - 3;
    const camZ = target.z + 9;
    player.setPosition(camX, camZ);
    world.updateObserverPosition(camX, camZ);
    player.transitionToFirstPerson(camX, camZ, world.getTerrainGenerator());
  }, forestTarget);

  await new Promise((r) => setTimeout(r, 4000));

  await page.evaluate((target) => {
    const fp = window.__PLAYER__.firstPersonController;
    if (fp) {
      const dx = target.x - fp.position.x;
      const dz = target.z - fp.position.z;
      fp.yaw = Math.atan2(-dx, -dz);
      fp.pitch = -0.05;
    }
  }, forestTarget);
  await new Promise((r) => setTimeout(r, 1500));

  const forestShotPath = path.join(ARTIFACT_DIR, 'shadows_forest_firstperson.png');
  await page.screenshot({ path: forestShotPath });
  console.log('Floresta com sombras salva em:', forestShotPath);

  // 3. Localiza Coqueiro na Praia para primeiro plano com sombra na areia
  const palmTarget = await page.evaluate(() => {
    const world = window.__WORLD__;
    let found = null;
    world.scene.traverse((obj) => {
      if (found) return;
      if (obj.isInstancedMesh && obj.count > 0 && obj.instanceMatrix) {
        const arr = obj.instanceMatrix.array;
        for (let i = 0; i < obj.count; i++) {
          const x = arr[i * 16 + 12];
          const y = arr[i * 16 + 13];
          const z = arr[i * 16 + 14];
          const pt = world.queryPoint(x, z);
          if (!pt.isWater && pt.height >= 1.5 && pt.height <= 4.0 && pt.biome.type === 'Praia Arenosa') {
            found = { x, y, z };
            return;
          }
        }
      }
    });
    return found;
  });
  console.log('Alvo de Coqueiro na praia:', palmTarget);

  if (palmTarget) {
    await page.evaluate((target) => {
      const player = window.__PLAYER__;
      const world = window.__WORLD__;
      const camX = target.x - 3.5;
      const camZ = target.z + 7.5;
      player.firstPersonController.setPosition(camX, camZ, world.getTerrainGenerator());
      world.updateObserverPosition(camX, camZ);
    }, palmTarget);

    await new Promise((r) => setTimeout(r, 3500));

    await page.evaluate((target) => {
      const fp = window.__PLAYER__.firstPersonController;
      if (fp) {
        const dx = target.x - fp.position.x;
        const dz = target.z - fp.position.z;
        fp.yaw = Math.atan2(-dx, -dz);
        fp.pitch = 0.05;
      }
    }, palmTarget);
    await new Promise((r) => setTimeout(r, 1500));

    const beachShotPath = path.join(ARTIFACT_DIR, 'shadows_beach_firstperson.png');
    await page.screenshot({ path: beachShotPath });
    console.log('Praia com sombras salva em:', beachShotPath);
  }

  console.log('Aplicando preset Sunset...');
  await page.evaluate(() => {
    const atmosphere = window.__ATMOSPHERE__;
    if (atmosphere) {
      atmosphere.applyPreset({
        name: 'Por do Sol Dourado',
        sunElevation: 14,
        sunAzimuth: 250,
        sunColor: '#ff9c50',
        ambientColor: '#543b59',
        fogColor: '#b06568',
        skyColor: '#f78361'
      });
    }
    const fp = window.__PLAYER__.firstPersonController;
    if (fp) {
      fp.pitch = -0.10;
      fp.yaw = 1.1;
    }
  });

  await new Promise((r) => setTimeout(r, 2500));

  const sunsetShotPath = path.join(ARTIFACT_DIR, 'shadows_sunset_golden.png');
  await page.screenshot({ path: sunsetShotPath });
  console.log('Sunset salvo em:', sunsetShotPath);

  await browser.close();

  if (errors.length > 0) {
    console.error('Erros no console:', errors.length);
  } else {
    console.log('=== Sucesso absoluto! Zero erros de WebGL ou console! ===');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
