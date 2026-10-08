import { drawWatermark } from './watermark.js';
const $ = id => document.getElementById(id);
const state = { sources: [], videoURL: null, worker: null, aborted: false, busy: false, result: [], masks: [], exports: [], width: 0, height: 0, masking: false, warning: '', installed: false };
const MAX_SOURCES = 30, MAX_FRAMES = 120, MAX_HEIGHT = 40000, PAGE_HEIGHT = 8000;
let toastTimer;
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6500); }
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));
function checkCancel() { if (state.aborted) throw new DOMException('已取消', 'AbortError'); }
function begin(title) { state.busy = true; state.aborted = false; $('busy-title').textContent = title; $('busy-detail').textContent = '内容只在你的设备上处理'; $('progress').value = 0; $('busy').hidden = false; }
function progress(text, value) { $('busy-detail').textContent = text; $('progress').value = value; }
function end() { state.busy = false; $('busy').hidden = true; state.worker?.terminate(); state.worker = null; }
function errorToast(error) { if (error.name !== 'AbortError') toast(error.message || '处理失败，请尝试更少的图片。'); }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; if (!c.getContext('2d')) throw new Error('浏览器无法创建画布，请减少图片数量后重试。'); return c; }
function release(c) { c.width = 1; c.height = 1; }
function blobFrom(c, type = 'image/jpeg', quality = .94) { return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('图片生成失败，可能超出浏览器内存限制。')), type, quality)); }
async function imageFrom(blob) {
  const url = URL.createObjectURL(blob), img = new Image();
  try { await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('无法读取图片。请使用 PNG、JPG 或 WebP。')); img.src = url; }); return img; }
  finally { URL.revokeObjectURL(url); }
}
async function sourceFrom(drawable, width, height, name) {
  if (width < 32 || height < 32 || width * height > 50000000) throw new Error('图片尺寸不受支持，请使用普通手机截图。');
  const ratio = Math.min(1, 900 / width, 4096 / height);
  const c = canvas(Math.round(width * ratio), Math.round(height * ratio));
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(drawable, 0, 0, c.width, c.height);
  const blob = await blobFrom(c);
  const thumb = canvas(100, Math.max(1, Math.round(c.height * 100 / c.width)));
  thumb.getContext('2d').drawImage(c, 0, 0, thumb.width, thumb.height);
  const thumbnail = URL.createObjectURL(await blobFrom(thumb, 'image/jpeg', .7));
  const result = { blob, thumbnail, name, width: c.width, height: c.height };
  release(c); release(thumb); return result;
}
function disposeSources(sources) { for (const source of sources) URL.revokeObjectURL(source.thumbnail); }
function disposeResults() {
  for (const page of state.result) URL.revokeObjectURL(page.url);
  for (const exp of state.exports) URL.revokeObjectURL(exp.url);
  state.result = []; state.exports = []; state.masks = [];
  $('preview-pages').replaceChildren(); $('downloads').replaceChildren();
}
function dropVideo() { $('video').pause(); $('video').removeAttribute('src'); $('video').load(); if (state.videoURL) URL.revokeObjectURL(state.videoURL); state.videoURL = null; }
function switchStep(step) {
  for (const [id, n] of [['step-import',1],['step-edit',2],['step-export',3]]) $(id).classList.toggle('current', n === step);
  $('source-panel').hidden = step !== 1; $('editor').hidden = step !== 2; $('export-panel').hidden = step !== 3;
}
function showWorkspace() { $('welcome').hidden = true; $('benefits').hidden = true; $('workspace').hidden = false; switchStep(1); }
function reset() {
  disposeSources(state.sources); state.sources = []; dropVideo(); disposeResults();
  $('workspace').hidden = true; $('welcome').hidden = false; $('benefits').hidden = false;
  $('images-input').value = ''; $('video-input').value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function cropFractions() { return { top: +$('crop-top').value / 100, bottom: +$('crop-bottom').value / 100 }; }
function renderSources() {
  $('source-list').replaceChildren(); $('video-panel').hidden = !state.videoURL; $('add-images').hidden = !!state.videoURL;
  $('source-title').textContent = state.videoURL ? '已选滚动录屏' : '按从上到下的顺序排列';
  $('source-count').textContent = state.videoURL ? '本地视频' : `${state.sources.length} 张 / ${MAX_SOURCES} 张`;
  for (const [index, source] of state.sources.entries()) {
    const item = document.createElement('article'); item.className = 'source-item';
    const wrap = document.createElement('div'); wrap.className = 'thumb-wrap'; wrap.style.aspectRatio = `${source.width} / ${source.height}`;
    const img = new Image(); img.src = source.thumbnail; img.alt = `第 ${index + 1} 张：${source.name}`;
    const crop = document.createElement('div'); crop.className = 'crop-window';
    const number = document.createElement('span'); number.className = 'thumb-num'; number.textContent = index + 1;
    wrap.append(img, crop, number);
    const label = document.createElement('p'); label.className = 'source-name'; label.textContent = source.name;
    const controls = document.createElement('div'); controls.className = 'source-controls';
    for (const [text, action, disabled] of [['↑',-1,index === 0],['↓',1,index === state.sources.length - 1],['×',0,false]]) {
      const button = document.createElement('button'); button.textContent = text; button.disabled = disabled;
      button.setAttribute('aria-label', `${action === 0 ? '删除' : action < 0 ? '前移' : '后移'}第 ${index + 1} 张`);
      button.onclick = () => { if (action === 0) { disposeSources([state.sources[index]]); state.sources.splice(index, 1); }
        else { [state.sources[index],state.sources[index+action]] = [state.sources[index+action],state.sources[index]]; }
        renderSources(); };
      controls.append(button);
    }
    item.append(wrap,label,controls); $('source-list').append(item);
  }
  updateSourceCrop(); $('generate').disabled = !state.videoURL && !state.sources.length;
}
function updateSourceCrop() {
  const { top, bottom } = cropFractions(); $('top-label').textContent = `${Math.round(top * 100)}%`; $('bottom-label').textContent = `${Math.round(bottom * 100)}%`;
  document.querySelectorAll('.crop-window').forEach(el => { el.style.top = `${top * 100}%`; el.style.bottom = `${bottom * 100}%`; });
}
async function importImages(files) {
  if (!files.length) return;
  if (state.videoURL && !confirm('改为导入截图？当前视频选择会被清除。')) return;
  if (state.sources.length + files.length > MAX_SOURCES) { toast(`一次最多 ${MAX_SOURCES} 张，请减少选择数量。`); return; }
  begin('正在读取截图'); const added = [];
  try {
    for (const [index, file] of files.entries()) {
      checkCancel(); if (file.size > 30000000) throw new Error(`${file.name} 大于 30 MB，请先压缩。`);
      const img = await imageFrom(file); added.push(await sourceFrom(img, img.naturalWidth, img.naturalHeight, file.name)); img.src = '';
      progress(`已读取 ${index + 1} / ${files.length} 张`, (index + 1) / files.length * 100); await yieldUI();
    }
    checkCancel(); dropVideo(); state.sources.push(...added); disposeResults(); showWorkspace(); renderSources();
  } catch(error) { disposeSources(added); errorToast(error); } finally { end(); $('images-input').value = ''; }
}
function eventOnce(element, event, action, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('视频读取超时，请使用较短的 MP4 / H.264 录屏。')), timeout);
    const success = () => done(); const failure = () => done(new Error('浏览器无法解码这段视频。请尝试 MP4 / H.264 格式。'));
    function done(error) { clearTimeout(timer); element.removeEventListener(event, success); element.removeEventListener('error', failure); error ? reject(error) : resolve(); }
    element.addEventListener(event, success, { once:true }); element.addEventListener('error', failure, { once:true });
    try { action(); } catch(error) { done(error); }
  });
}
async function importVideo(file) {
  if (!file) return;
  if (file.size > 300000000) { toast('请选取小于 300 MB 的视频，或先在相册中裁短。'); return; }
  if (state.sources.length && !confirm('改为导入录屏？当前截图选择会被清除。')) return;
  begin('正在读取录屏');
  try {
    dropVideo(); state.videoURL = URL.createObjectURL(file);
    await eventOnce($('video'), 'loadedmetadata', () => { $('video').src = state.videoURL; $('video').load(); });
    checkCancel(); const v = $('video');
    if (!Number.isFinite(v.duration) || v.duration <= 0 || !v.videoWidth) throw new Error('无法识别录屏时长或尺寸。');
    disposeSources(state.sources); state.sources = []; disposeResults();
    $('video-start').value = '0'; $('video-end').value = Math.min(v.duration, 60).toFixed(1);
    $('video-start').max = v.duration; $('video-end').max = v.duration;
    $('crop-top').value = 12; $('crop-bottom').value = 8; $('mode').value = 'auto';
    showWorkspace(); renderSources();
  } catch(error) { dropVideo(); renderSources(); errorToast(error); } finally { end(); $('video-input').value = ''; }
}
async function seekVideo(time) {
  const v = $('video'); checkCancel();
  if (v.readyState >= 2 && Math.abs(v.currentTime - time) < .001) return;
  await eventOnce(v, 'seeked', () => { v.currentTime = time; });
  if (v.readyState < 2) await eventOnce(v, 'loadeddata', () => {});
  checkCancel();
}
async function extractFrames() {
  const start = +$('video-start').value, finish = +$('video-end').value, v = $('video');
  if (!Number.isFinite(start) || !Number.isFinite(finish) || start < 0 || finish <= start || finish > v.duration + .1 || finish - start > 60.01)
    throw new Error('请选择视频内的一段有效起止时间，最长 60 秒。');
  v.pause(); const frames = [], count = Math.min(MAX_FRAMES, Math.max(2, Math.ceil((finish - start) * 2)));
  try {
    for (let i = 0; i < count; i++) {
      const time = Math.min(v.duration - .02, start + (finish - start) * i / count);
      await seekVideo(Math.max(0, time));
      frames.push(await sourceFrom(v, v.videoWidth, v.videoHeight, `${time.toFixed(1)} 秒`));
      progress(`提取画面 ${i + 1} / ${count}`, (i + 1) / count * 40); await yieldUI();
    }
    return frames;
  } catch(error) { disposeSources(frames); throw error; }
}
async function croppedCanvas(source, width) {
  const image = await imageFrom(source.blob), {top,bottom} = cropFractions();
  const sy = Math.floor(source.height * top), sh = Math.floor(source.height * (1 - top - bottom));
  const c = canvas(width, Math.round(sh * width / source.width));
  c.getContext('2d').drawImage(image, 0, sy, source.width, sh, 0, 0, c.width, c.height); image.src = ''; return c;
}
function grayscale(image, height) {
  const c = canvas(72, height), ctx = c.getContext('2d', { willReadFrequently:true }); ctx.drawImage(image, 0, 0, c.width, height);
  const rgba = ctx.getImageData(0, 0, c.width, height).data, pixels = new Uint8Array(c.width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.round(rgba[i*4]*.299 + rgba[i*4+1]*.587 + rgba[i*4+2]*.114);
  release(c); return { width:72, height, pixels };
}
function fingerprint(c) { return { coarse: grayscale(c, Math.min(384, c.height)), fine: grayscale(c, c.height) }; }
async function findMatch(previous, current) {
  checkCancel();
  if (!state.worker) state.worker = new Worker(new URL('./match-worker.js', import.meta.url), { type:'module' });
  return new Promise((resolve, reject) => {
    const worker = state.worker;
    const timer = setTimeout(() => { worker.terminate(); state.worker = null; finish(new Error('拼接计算超时，请减少图片数量。')); }, 20000);
    const finish = (error, value) => { clearTimeout(timer); clearInterval(cancelTimer); worker.onmessage = null; worker.onerror = null; error ? reject(error) : resolve(value); };
    const cancelTimer = setInterval(() => { if (state.aborted) { worker.terminate(); finish(new DOMException('已取消','AbortError')); } }, 100);
    worker.onmessage = ({data}) => finish(data?.failure ? new Error(data.failure) : null, data);
    worker.onerror = () => finish(new Error('无法启动本地拼接，请使用现代 Safari / Chrome 并通过 HTTP(S) 打开。'));
    worker.postMessage({ previous, current });
  });
}
async function buildPages(sources) {
  const width = Math.min(...sources.map(s => s.width)), mode = $('mode').value;
  let previous = null, used = 0, total = 0, page = canvas(width, PAGE_HEIGHT), ctx = page.getContext('2d'), pages = [], warning = '';
  async function flush() {
    if (!used) return;
    const output = canvas(width, used); output.getContext('2d').drawImage(page, 0, 0, width, used, 0, 0, width, used);
    const blob = await blobFrom(output, 'image/png');
    pages.push({ blob, url:URL.createObjectURL(blob), width, height:used, offset:total-used });
    release(output); release(page); page = canvas(width, PAGE_HEIGHT); ctx = page.getContext('2d'); used = 0;
  }
  try {
    for (let i = 0; i < sources.length; i++) {
      checkCancel(); const c = await croppedCanvas(sources[i], width);
      try {
        const current = mode === 'auto' ? fingerprint(c) : null;
        let added = c.height;
        if (previous && mode === 'auto') {
          const match = await findMatch(previous, current);
          if (!match) { warning = `第 ${i + 1} 个画面无法可靠衔接，已在此停止，后续内容未包含。请返回调整顺序、裁掉固定栏或选择直接拼接。`; break; }
          added = match.shift;
          if (added <= 1) { progress(`跳过停留画面 ${i + 1} / ${sources.length}`, 40 + (i + 1) / sources.length * 60); continue; }
        }
        if (total + added > MAX_HEIGHT) { warning = '已达到 40,000 像素长度上限，后续内容未包含，请分批处理。'; break; }
        let y = c.height - added;
        while (added > 0) {
          const part = Math.min(added, PAGE_HEIGHT - used);
          ctx.drawImage(c, 0, y, width, part, 0, used, width, part);
          y += part; added -= part; used += part; total += part;
          if (used === PAGE_HEIGHT) await flush();
        }
        previous = current;
      } finally { release(c); }
      progress(`正在拼接 ${i + 1} / ${sources.length}`, 40 + (i + 1) / sources.length * 60); await yieldUI();
    }
    checkCancel(); await flush();
    if (!pages.length) throw new Error('没有可生成的内容，请调整范围。');
    return { pages, width, height:total, warning };
  } catch(error) { for (const p of pages) URL.revokeObjectURL(p.url); throw error; } finally { release(page); }
}
async function generate() {
  begin('正在拼接你的长图'); let extracted;
  try {
    const sources = state.videoURL ? (extracted = await extractFrames()) : state.sources;
    if (!sources.length) throw new Error('请先导入截图或录屏。');
    const result = await buildPages(sources); checkCancel(); disposeResults();
    state.result = result.pages; state.width = result.width; state.height = result.height; state.warning = result.warning;
    $('trim-top').value = '0'; $('trim-bottom').value = '0'; state.masking = false;
    renderPreview(); switchStep(2); window.scrollTo({top:0,behavior:'smooth'});
  } catch(error) { errorToast(error); } finally { if (extracted) disposeSources(extracted); end(); }
}
function trimBounds() { return { start:Math.floor(state.height * +$('trim-top').value / 100), end:Math.floor(state.height * (1 - +$('trim-bottom').value / 100)) }; }
function renderPreview() {
  $('dimensions').textContent = `${state.width} × ${state.height.toLocaleString()} px`;
  $('notice').textContent = state.warning; $('notice').hidden = !state.warning; $('preview-pages').replaceChildren();
  for (const [index,page] of state.result.entries()) {
    const wrap = document.createElement('div'); wrap.className = 'preview-page'; wrap.dataset.index = index;
    const img = new Image(); img.src = page.url; img.alt = `长图预览，第 ${index + 1} 段`;
    const overlay = canvas(450, Math.round(page.height * 450 / page.width)); overlay.className = 'mask-layer'; overlay.setAttribute('aria-label','在此拖动以涂黑隐私区域');
    const shadeTop = document.createElement('div'); shadeTop.className = 'trim-shade top';
    const shadeBottom = document.createElement('div'); shadeBottom.className = 'trim-shade bottom';
    const watermark = canvas(450, Math.round(page.height * 450 / page.width)); watermark.className = 'watermark-layer'; watermark.setAttribute('aria-hidden','true');
    wrap.append(img,overlay,watermark,shadeTop,shadeBottom); $('preview-pages').append(wrap); attachMask(overlay,index);
  }
  updateTrim(); updateMaskUI();
}
function updateTrim() {
  $('trim-top-label').textContent = `${$('trim-top').value}%`; $('trim-bottom-label').textContent = `${$('trim-bottom').value}%`;
  const {start,end} = trimBounds();
  document.querySelectorAll('.preview-page').forEach((el,index) => {
    const page = state.result[index];
    el.querySelector('.top').style.height = `${Math.min(1, Math.max(0, (start - page.offset) / page.height)) * 100}%`;
    el.querySelector('.bottom').style.height = `${Math.min(1, Math.max(0, (page.offset + page.height - end) / page.height)) * 100}%`;
  });
  updateWatermark();
}
function watermarkOptions() {
  return {enabled:$('watermark-enabled').checked, text:$('watermark-text').value,
    position:$('watermark-position').value, size:+$('watermark-size').value,
    opacity:+$('watermark-opacity').value / 100, color:$('watermark-color').value};
}
function updateWatermark() {
  const options = watermarkOptions();
  $('watermark-options').hidden = !options.enabled;
  $('watermark-size-label').textContent = options.size;
  $('watermark-opacity-label').textContent = `${Math.round(options.opacity * 100)}%`;
  const {start,end} = trimBounds();
  document.querySelectorAll('.watermark-layer').forEach((c,index) => {
    const page = state.result[index], ctx = c.getContext('2d');
    ctx.clearRect(0,0,c.width,c.height);
    const sy = Math.max(0,start-page.offset), ey = Math.min(page.height,end-page.offset);
    if (ey <= sy) return;
    ctx.save(); ctx.scale(c.width/page.width,c.height/page.height);
    ctx.beginPath(); ctx.rect(0,sy,page.width,ey-sy); ctx.clip(); ctx.translate(0,sy);
    drawWatermark(ctx,page.width,ey-sy,options); ctx.restore();
  });
}
function updateMaskUI() {
  $('mask').setAttribute('aria-pressed', state.masking); $('mask').textContent = state.masking ? '✓ 正在框选 · 点此结束' : '▧ 涂黑隐私区域';
  $('preview-pages').classList.toggle('masking', state.masking); $('undo').disabled = !state.masks.length;
  document.querySelectorAll('.mask-layer').forEach((c,index) => drawMasks(c,index));
}
function drawMasks(c, pageIndex, draft = null) {
  const ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); ctx.fillStyle = '#000';
  for (const mask of state.masks.filter(m => m.page === pageIndex)) ctx.fillRect(mask.x*c.width,mask.y*c.height,mask.w*c.width,mask.h*c.height);
  if (draft) { ctx.globalAlpha = .45; ctx.fillRect(draft.x*c.width,draft.y*c.height,draft.w*c.width,draft.h*c.height); ctx.globalAlpha = 1; }
}
function attachMask(c, page) {
  let anchor = null, draft = null;
  const point = e => { const r = c.getBoundingClientRect(); return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}; };
  c.onpointerdown = e => { if (!state.masking) return; anchor = point(e); draft = null; c.setPointerCapture(e.pointerId); e.preventDefault(); };
  c.onpointermove = e => { if (!anchor) return; const p = point(e); draft = { page,x:Math.min(p.x,anchor.x),y:Math.min(p.y,anchor.y),w:Math.abs(p.x-anchor.x),h:Math.abs(p.y-anchor.y) }; drawMasks(c,page,draft); };
  c.onpointerup = () => { if (draft && draft.w > .005 && draft.h > .0001) state.masks.push(draft); anchor = null; draft = null; updateMaskUI(); };
  c.onpointercancel = () => { anchor = null; draft = null; updateMaskUI(); };
}
async function prepareExport() {
  begin('正在准备可保存的图片'); const exports = [];
  try {
    const {start,end:finish} = trimBounds(), watermark = watermarkOptions();
    for (const [index,page] of state.result.entries()) {
      checkCancel(); const sy = Math.max(0,start-page.offset), ey = Math.min(page.height,finish-page.offset); if (ey <= sy) continue;
      const c = canvas(page.width,ey-sy), ctx = c.getContext('2d'), image = await imageFrom(page.blob);
      ctx.drawImage(image,0,sy,page.width,ey-sy,0,0,page.width,ey-sy); image.src = ''; ctx.fillStyle = '#000';
      for (const mask of state.masks.filter(m => m.page === index)) ctx.fillRect(Math.floor(mask.x*page.width),Math.floor(mask.y*page.height)-sy,Math.ceil(mask.w*page.width)+1,Math.ceil(mask.h*page.height)+1);
      drawWatermark(ctx,page.width,ey-sy,watermark);
      const blob = await blobFrom(c,'image/png'); release(c);
      const name = `Cong的长截图-${exports.length+1}.png`, file = new File([blob],name,{type:'image/png'});
      exports.push({file,url:URL.createObjectURL(blob),name});
      progress(`已准备 ${exports.length} 张图片`,(index+1)/state.result.length*100); await yieldUI();
    }
    checkCancel(); for (const e of state.exports) URL.revokeObjectURL(e.url); state.exports = exports; renderExports(); switchStep(3); window.scrollTo({top:0,behavior:'smooth'});
  } catch(error) { for (const e of exports) URL.revokeObjectURL(e.url); errorToast(error); } finally { end(); }
}
function renderExports() {
  $('downloads').replaceChildren();
  $('export-description').textContent = `共 ${state.exports.length} 张 PNG 图片 · 裁剪和遮挡已应用${watermarkOptions().enabled && watermarkOptions().text.trim() ? ' · 已添加水印' : ''} · 本地生成`;
  for (const item of state.exports) {
    const line = document.createElement('div'); const download = document.createElement('a'); download.href = item.url; download.download = item.name; download.textContent = `下载第 ${state.exports.indexOf(item)+1} 张`;
    const open = document.createElement('a'); open.href = item.url; open.target = '_blank'; open.rel = 'noopener'; open.textContent = '打开图片'; open.style.marginLeft = '20px'; line.append(download,open); $('downloads').append(line);
  }
  const files = state.exports.map(e => e.file); $('share').hidden = !(navigator.canShare && navigator.canShare({files}));
}
async function share() {
  try { await navigator.share({files:state.exports.map(e=>e.file),title:'Cong的长截图'}); }
  catch(error) { if(error.name !== 'AbortError') toast('分享未完成，请使用下方的下载或打开图片。'); }
}
async function demo() {
  if ((state.sources.length || state.videoURL) && !confirm('使用演示内容替换当前素材？')) return;
  begin('正在准备演示内容'); const sources = [];
  try {
    const full = canvas(600,3600), ctx = full.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,600,3600);
    ctx.fillStyle = '#4664ed'; ctx.fillRect(0,0,600,320); ctx.fillStyle = '#fff'; ctx.font = 'bold 42px sans-serif'; ctx.fillText('把灵感，留长一点。',36,105); ctx.font = '22px sans-serif'; ctx.fillText('一份关于日常小事的收藏清单',36,157); ctx.font = '14px sans-serif'; ctx.fillText('THE LITTLE THINGS / VOL. 01',36,255);
    const titles = ['清晨的第一杯咖啡','走一条没走过的小路','读到喜欢的一段话','把天空装进口袋','记录今天的小确幸','留一些时间给自己','周末去逛一家书店','给生活留一点空白','慢一点，也没有关系','把值得记住的都留下'];
    for (let i=0;i<10;i++) {
      const y=350+i*320; ctx.fillStyle = `hsl(${(i*43+150)%360} 28% 94%)`; ctx.fillRect(30,y,540,285);
      ctx.fillStyle='#4664ed'; ctx.font='15px sans-serif'; ctx.fillText(String(i+1).padStart(2,'0')+' / NOTES',52,y+40);
      ctx.fillStyle='#27334d'; ctx.font='bold 28px sans-serif'; ctx.fillText(titles[i],52,y+91);
      ctx.font='18px sans-serif'; ctx.fillStyle='#7d879d'; ctx.fillText('那些看似普通的瞬间，也值得被好好珍藏。',52,y+136);
      ctx.fillText(`今天的灵感编号：${(i+1)*137+56}。`,52,y+170);
      // Irregular decorations make the sample visually and mathematically unambiguous.
      for(let x=0;x<12;x++){ctx.fillStyle=`hsl(${(i*51+x*19)%360} 28% ${65+x%4*5}%)`;ctx.fillRect(52+x*38,y+210+((i*7+x*11)%23),24,8+((i+x*3)%16));}
    }
    for (let y=0;y<=2400;y+=300) {
      checkCancel(); const piece=canvas(600,1200);piece.getContext('2d').drawImage(full,0,y,600,1200,0,0,600,1200);sources.push(await sourceFrom(piece,600,1200,`演示截图 ${sources.length+1}`));release(piece);await yieldUI();
    }
    release(full); checkCancel(); disposeSources(state.sources);dropVideo();disposeResults();state.sources=sources;$('crop-top').value=0;$('crop-bottom').value=0;$('mode').value='auto';showWorkspace();renderSources();
  } catch(error) {disposeSources(sources);errorToast(error);} finally {end();}
}
$('pick-images').onclick = $('add-images').onclick = () => $('images-input').click();
$('pick-video').onclick = () => $('video-input').click();
$('images-input').onchange = e => importImages([...e.target.files]); $('video-input').onchange = e => importVideo(e.target.files[0]);
$('demo').onclick = demo; $('generate').onclick = generate;
$('crop-top').oninput = $('crop-bottom').oninput = updateSourceCrop;
$('trim-top').oninput = $('trim-bottom').oninput = updateTrim;
$('mask').onclick = () => {state.masking=!state.masking;updateMaskUI();};
$('undo').onclick = () => {state.masks.pop();updateMaskUI();};
for (const id of ['watermark-enabled','watermark-text','watermark-position','watermark-size','watermark-opacity','watermark-color']) $(id).addEventListener('input',updateWatermark);
$('prepare-export').onclick = prepareExport; $('share').onclick = share;
$('back').onclick = () => {switchStep(1);window.scrollTo({top:0,behavior:'smooth'});};
$('continue-edit').onclick = () => switchStep(2);
$('reset').onclick = () => {if(confirm('清空本次素材和编辑？请先保存需要的结果。'))reset();};
$('cancel').onclick = () => {state.aborted=true;$('busy-detail').textContent='正在取消，请稍候…';};
$('install').onclick = $('help').onclick = () => $('help-dialog').showModal(); $('close-help').onclick = () => $('help-dialog').close();
$('help-dialog').onclick = e => {if(e.target===$('help-dialog')) {const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}};
window.addEventListener('beforeunload',e=>{if(state.sources.length||state.videoURL){e.preventDefault();e.returnValue='';}});
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).then(async registration => {
    registration.update().catch(() => {});
    await navigator.serviceWorker.ready;
    $('offline-status').textContent='离线缓存已准备好。首次从主屏幕打开时请保持联网，之后可离线使用。';
    state.installed=true;
  }).catch(()=>{$('offline-status').textContent='离线缓存未启用，当前仍可在线使用。请确认部署使用 HTTPS。';});
}
