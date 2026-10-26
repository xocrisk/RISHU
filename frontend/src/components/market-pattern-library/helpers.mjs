// Pure helpers shared by React, the offline preview and validation.
export function filterPatterns(patterns, query = '', category = 'all', bias = 'all') {
  const needle = query.trim().toLowerCase();
  return patterns.filter(p => (category === 'all' || p.category === category)
    && (bias === 'all' || p.bias === bias)
    && [p.name, ...p.aliases, p.overview, p.context, p.type].join(' ').toLowerCase().includes(needle));
}
export function diagramNodes(d) {
  const values = d.kind === 'candles' ? d.bars.flat() : d.values;
  const lo = Math.min(...values), hi = Math.max(...values), span = Math.max(hi - lo, 1);
  const y = value => 154 - ((value - lo) / span) * 120;
  const nodes = [
    ['rect', {x:0,y:0,width:360,height:200,rx:10,fill:'#f5f8fc'}],
    ['line', {x1:30,y1:164,x2:335,y2:164,stroke:'#64748b'}],
    ['text', {x:180,y:190,textAnchor:'middle',fontSize:11,fill:'#475569'}, 'Earlier  →  Later'],
    ['text', {x:12,y:20,fontSize:11,fill:'#475569'}, 'Illustrative price']
  ];
  if (d.kind === 'candles') {
    const step = 280 / (d.bars.length + 1), width = Math.min(28, step * .6);
    d.bars.forEach(([o,h,l,c],i) => {
      const x = 40 + step * (i+1), color = c >= o ? '#006b55' : '#a72e44';
      nodes.push(['line',{x1:x,x2:x,y1:y(h),y2:y(l),stroke:color,strokeWidth:2}]);
      nodes.push(['rect',{x:x-width/2,y:Math.min(y(o),y(c)),width,height:Math.max(Math.abs(y(o)-y(c)),2),fill:c>=o?'#ffffff':color,stroke:color,strokeWidth:2}]);
    });
  } else {
    const x = i => 40 + i * 280 / Math.max(d.values.length-1,1);
    for(const [a,b,c,e] of d.guides) nodes.push(['line',{x1:x(a),y1:y(b),x2:x(c),y2:y(e),stroke:'#64748b',strokeWidth:1.5,strokeDasharray:'5 4'}]);
    nodes.push(['polyline',{points:d.values.map((v,i)=>`${x(i)},${y(v)}`).join(' '),fill:'none',stroke:'#2757ae',strokeWidth:2.5,strokeLinejoin:'round'}]);
  }
  return nodes;
}
export function escapeHtml(value) {
 return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function diagramSvg(d) {
 const attr = key => key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 200" role="img" aria-label="${escapeHtml(d.label)}"><title>${escapeHtml(d.label)}</title>`
   + diagramNodes(d).map(([tag,attrs,txt])=>`<${tag} ${Object.entries(attrs).map(([k,v])=>`${attr(k)}="${escapeHtml(v)}"`).join(' ')}>${txt ? escapeHtml(txt) : ''}</${tag}>`).join('')+'</svg>';
}
