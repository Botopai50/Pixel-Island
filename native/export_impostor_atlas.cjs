const fs=require('fs');
const path=require('path');
const { chromium }=(()=>{try{return require('playwright-core')}catch{return {}}})();
const puppeteer=require('puppeteer-core');
const { createCanvas, loadImage }=require('@napi-rs/canvas');

(async()=>{
  const candidates=[
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  const exe=candidates.find(p=>fs.existsSync(p));
  if(!exe) throw new Error('Chrome nao encontrado para exportar impostores.');

  const browser=await puppeteer.launch({
    executablePath:exe,
    headless:true,
    args:['--disable-gpu-sandbox','--no-sandbox','--use-angle=swiftshader','--use-gl=angle','--enable-webgl']
  });
  const page=await browser.newPage();
  page.on('console',msg=>console.log('[browser]',msg.text()));
  page.on('pageerror',e=>console.error('[pageerror]',e.stack||e.message));
  await page.goto('http://127.0.0.1:5173/native/impostor_export.html',{waitUntil:'networkidle0',timeout:120000});
  await page.waitForFunction(()=>window.__IMPOSTOR_EXPORT__&&window.__IMPOSTOR_EXPORT__.png,{timeout:120000});
  const result=await page.evaluate(()=>window.__IMPOSTOR_EXPORT__);
  await browser.close();

  const png=Buffer.from(result.png.split(',')[1],'base64');
  fs.writeFileSync('native/tree_impostor_atlas.png',png);

  const img=await loadImage(png);
  const canvas=createCanvas(result.width,result.height);
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,result.width,result.height);
  ctx.drawImage(img,0,0,result.width,result.height);
  const rgba=ctx.getImageData(0,0,result.width,result.height).data;

  const header=Buffer.alloc(24+result.info.length*12);
  header.writeUInt32LE(0x50494d50,0); // PIMP
  header.writeUInt32LE(1,4);
  header.writeUInt32LE(result.width,8);
  header.writeUInt32LE(result.height,12);
  header.writeUInt32LE(result.cols,16);
  header.writeUInt32LE(result.rows,20);
  let o=24;
  for(const v of result.info){
    header.writeFloatLE(v[0],o);header.writeFloatLE(v[1],o+4);header.writeFloatLE(v[2],o+8);o+=12;
  }
  fs.writeFileSync('native/tree_impostor_atlas.bin',Buffer.concat([header,Buffer.from(rgba.buffer,rgba.byteOffset,rgba.byteLength)]));
  fs.writeFileSync('native/tree_impostor_info.json',JSON.stringify(result,null,2));
  console.log('Impostor atlas exportado:',result.width+'x'+result.height,'tipos=',result.info.length);
})().catch(e=>{console.error(e);process.exit(1)});
