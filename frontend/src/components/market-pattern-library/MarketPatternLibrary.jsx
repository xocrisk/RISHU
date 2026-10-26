'use client';

import React, { useId, useState } from 'react';
import library from './patterns.json';
import { filterPatterns, diagramNodes } from './helpers.mjs';

const h = React.createElement;
const styles = `
.mpl{font-family:system-ui,sans-serif;color:#17263b;background:#f6f8fb;padding:clamp(16px,4vw,40px);line-height:1.65;border-radius:16px;max-width:1200px;margin:auto;color-scheme:light}
.mpl *{box-sizing:border-box}.mpl h1{font-size:clamp(27px,4vw,42px);line-height:1.15;letter-spacing:-.035em}.mpl h2{font-size:23px;line-height:1.3}.mpl h3{font-size:18px}.mpl h4{font-size:15px;margin:18px 0 5px}.mpl p{margin:8px 0 16px}.mpl a{color:#244fa0}.mpl .mpl-note{padding:14px 18px;background:#e8edf5;border-radius:10px}.mpl .mpl-controls{display:flex;flex-wrap:wrap;gap:14px;margin:24px 0}.mpl label{display:flex;flex-direction:column;gap:4px;flex:1;min-width:160px;font-size:14px;font-weight:600}.mpl input,.mpl select{font:inherit;background:#fff;color:#17263b;padding:11px 12px;border:1px solid #8190a5;border-radius:7px;width:100%}.mpl :focus-visible{outline:3px solid #1b63c5;outline-offset:4px}.mpl .mpl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:18px}.mpl article{background:#fff;border:1px solid #d5dde8;border-radius:12px;padding:22px;min-width:0}.mpl .mpl-meta{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#50617a}.mpl details{border-top:1px solid #dce3ee;padding-top:12px;margin-top:12px}.mpl summary{cursor:pointer;font-weight:650;color:#244a82}.mpl ul{padding-left:22px}.mpl li{margin:6px 0}.mpl figure{margin:16px 0}.mpl svg{display:block;width:100%;height:auto}.mpl figcaption{font-size:12px;color:#4b5e76;margin-top:6px}.mpl .mpl-lessons{margin:24px 0}.mpl .mpl-lessons details{background:#fff;padding:16px;border:1px solid #d5dde8;border-radius:8px}.mpl .mpl-empty{padding:24px;background:#fff}.mpl .mpl-count{font-size:14px;color:#435570}
`;
function list(items) { return h('ul',null,...items.map((text,i)=>h('li',{key:i},text))); }
export function Diagram({drawing}) {
  return h('figure',null,
    h('svg',{viewBox:'0 0 360 200',role:'img','aria-label':drawing.label},
      h('title',null,drawing.label),...diagramNodes(drawing).map(([tag,attrs,text],i)=>h(tag,{...attrs,key:i},text))),
    h('figcaption',null,`${drawing.label}. ${drawing.note}`));
}
function Card({pattern:p}) {
 return h('article',null,
  h('div',{className:'mpl-meta'},`${p.category} · ${p.type} · ${p.bias}`),
  h('h3',null,p.name),h('p',null,p.overview),h(Diagram,{drawing:p.illustrations[0]}),
  h('details',null,h('summary',null,'Recognition, confirmation and limitations'),
   h('h4',null,'Context'),h('p',null,p.context),
   h('h4',null,'Recognition'),list(p.recognition),
   h('h4',null,'Confirmation to study'),h('p',null,p.confirmation),
   h('h4',null,'What weakens the scenario'),h('p',null,p.invalidation),
   h('h4',null,'Target framework'),h('p',null,p.targetMethod),
   h('h4',null,'Common mistakes and limitations'),list(p.cautions),
   p.aliases.length>0?h('p',null,`Also called: ${p.aliases.join(', ')}`):null,
   p.variants.length>0?list(p.variants):null,
   ...p.illustrations.slice(1).map((drawing,i)=>h(Diagram,{drawing,key:i})),
   h('p',null,p.timeframeNote),h('p',{className:'mpl-count'},p.reliability.status)));
}
export default function MarketPatternLibrary() {
 const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[bias,setBias]=useState('all');
 const uid=useId();
 const visible=filterPatterns(library.patterns,query,category,bias);
 function select(label,value,onChange,options,id){
  return h('label',{htmlFor:id},label,h('select',{id,value,onChange:e=>onChange(e.target.value)},...options.map(([v,t])=>h('option',{value:v,key:v},t))));
 }
 return h('section',{className:'mpl','aria-labelledby':uid+'-title'},
  h('style',null,styles),h('div',{className:'mpl-meta'},'Learn price structure'),
  h('h1',{id:uid+'-title'},library.title),h('p',null,library.description),h('p',{className:'mpl-note'},library.notice),
  h('details',{className:'mpl-lessons'},h('summary',null,'Start here: 7 short foundations'),
   ...library.lessons.map(l=>h('details',{key:l.id},h('summary',null,l.title),h('p',null,l.body),list(l.points)))),
  h('div',{className:'mpl-controls'},
   h('label',{htmlFor:uid+'-search'},'Search patterns',h('input',{id:uid+'-search',type:'search',value:query,placeholder:'Try hammer, gap, inverse...',onChange:e=>setQuery(e.target.value)})),
   select('Category',category,setCategory,[['all','All categories'],['candlestick','Candlesticks'],['chart','Chart patterns']],uid+'-category'),
   select('Interpretation',bias,setBias,[['all','All interpretations'],['bullish','Bullish'],['bearish','Bearish'],['neutral','Neutral'],['conditional','Depends on variant']],uid+'-bias')),
  h('p',{className:'mpl-count',role:'status','aria-live':'polite'},`${visible.length} of ${library.patterns.length} patterns`),
  visible.length?h('div',{className:'mpl-grid'},...visible.map(p=>h(Card,{pattern:p,key:p.id}))):h('p',{className:'mpl-empty'},'No matches. Clear the search or change the filters.'),
  h('details',null,h('summary',null,'References and content notes'),h('p',null,library.rightsNote),
   h('ul',null,...library.references.map(r=>h('li',{key:r.url},h('a',{href:r.url,target:'_blank',rel:'noreferrer'},r.title),` — ${r.purpose}`)))));
}
