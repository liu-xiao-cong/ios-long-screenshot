/** Layout in export pixels; shared by the scaled preview and final PNG. */
export function watermarkLayout(width, height, options, measureText) {
  const text = Array.from(String(options.text || '').replace(/[\r\n\t]/g,' ').trim()).slice(0,40).join('');
  if (!options.enabled || !text || width <= 0 || height <= 0) return null;
  const margin = Math.min(width * .035, height * .12);
  let size = Math.max(.1, Math.min((Number(options.size) || 28) * width / 900, height * .55));
  const maxTextWidth = Math.max(1,width-margin*2), measured = measureText(text,size);
  if (measured > maxTextWidth) size *= maxTextWidth / measured;
  const textWidth = Math.min(maxTextWidth,measureText(text,size));
  const opacity = Math.max(0,Math.min(1,Number(options.opacity) || 0));
  const color = /^#[0-9a-f]{6}$/i.test(options.color) ? options.color : '#334155';
  const points = [], position = options.position || 'bottom-right';
  if (position === 'tile') {
    const dx = Math.max(textWidth + margin * 2, width * .55), dy = Math.max(size * 6, width * .25);
    for (let row=0,y=Math.min(height/2,dy/2);y<height;y+=dy,row++) {
      for(let x=width*.25+(row%2)*width*.1;x<width;x+=dx)points.push({x,y,angle:-Math.PI/9});
    }
  } else {
    const left=margin+textWidth/2,right=width-margin-textWidth/2;
    const top=margin+size*.65,bottom=height-margin-size*.65;
    points.push({x:position.endsWith('left')?left:position.endsWith('right')?right:width/2,
      y:position.startsWith('top')?top:position.startsWith('bottom')?bottom:height/2,angle:0});
  }
  return {text,size,color,opacity,points};
}
export function drawWatermark(ctx,width,height,options) {
  ctx.save();
  const font = size => `600 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif`;
  const layout = watermarkLayout(width,height,options,(text,size)=>{ctx.font=font(size);return ctx.measureText(text).width;});
  if (layout) {
    ctx.font=font(layout.size);ctx.fillStyle=layout.color;ctx.globalAlpha=layout.opacity;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.shadowColor=layout.color==='#ffffff'?'rgba(0,0,0,.4)':'rgba(255,255,255,.55)';
    ctx.shadowBlur=Math.max(.5,width/900);ctx.shadowOffsetY=width/900;
    for(const point of layout.points){ctx.save();ctx.translate(point.x,point.y);ctx.rotate(point.angle);ctx.fillText(layout.text,0,0);ctx.restore();}
  }
  ctx.restore();
}
