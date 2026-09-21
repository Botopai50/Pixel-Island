import puppeteer from 'file:///C:/Users/julia/.gemini/antigravity/scratch/procedural-island-explorer/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/julia/.gemini/antigravity/brain/40dbf106-75ff-492e-8c3f-30ec0fe98531';
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('Iniciando verificação do Pegman e Modo Primeira Pessoa...');

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  await sleep(3500);

  // 1. Captura com o Pegman repousado na HUD no canto inferior direito
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'pegman_hud_resting.png') });
  console.log('✓ Salvo pegman_hud_resting.png');

  // 2. Simula o arrasto do Pegman sobre o mapa
  const pegmanBox = await page.evaluate(() => {
    const el = document.querySelector('.pegman-character');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });

  if (!pegmanBox) {
    throw new Error('Elemento do Pegman não encontrado na DOM!');
  }

  // Pressiona o botão do mouse sobre o Pegman
  await page.mouse.move(pegmanBox.x, pegmanBox.y);
  await page.mouse.down();
  await sleep(200);

  // Move o mouse para o centro do terreno (x: 820, y: 520)
  await page.mouse.move(820, 520, { steps: 20 });
  await sleep(600);

  // Captura do Pegman sendo arrastado com a mira 3D projetada no terreno
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'pegman_dragging_reticle.png') });
  console.log('✓ Salvo pegman_dragging_reticle.png');

  // 3. Solta o Pegman para iniciar o mergulho cinemático para 1ª Pessoa
  await page.mouse.up();
  console.log('Pegman solto no terreno. Aguardando mergulho cinemático...');
  await sleep(2200); // Aguarda o término da animação de swoop (1.35s)

  const isFP = await page.evaluate(() => {
    return window.__PLAYER__.isFirstPerson();
  });
  console.log(`Estado Primeira Pessoa ativo: ${isFP}`);

  // Simula caminhar um pouco em primeira pessoa com a tecla W
  await page.keyboard.down('KeyW');
  await sleep(1500);
  await page.keyboard.up('KeyW');
  await sleep(500);

  // Captura a visão imersiva em Primeira Pessoa ao nível dos olhos
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'pegman_first_person_view.png') });
  console.log('✓ Salvo pegman_first_person_view.png');

  // 4. Clica no botão flutuante de saída ou pressiona ESC para voltar à visão aérea
  console.log('Pressionando ESC para retornar à visão panorâmica...');
  await page.keyboard.press('Escape');
  await sleep(2000); // Aguarda a ascensão cinemática (1.15s)

  const isObserverAgain = await page.evaluate(() => {
    return window.__PLAYER__.getMode() === 'OBSERVER';
  });
  console.log(`Retornou com sucesso ao modo aéreo: ${isObserverAgain}`);

  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'pegman_returned_to_aerial.png') });
  console.log('✓ Salvo pegman_returned_to_aerial.png');

  await browser.close();
  console.log('=== Verificação concluída com sucesso! ===');
}

runTest().catch((err) => {
  console.error('Erro na verificação:', err);
  process.exit(1);
});
