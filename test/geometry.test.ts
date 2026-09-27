import test from 'node:test';
import assert from 'node:assert/strict';
import {createFlatPatternDocument} from '../src/geometry/flatPattern.ts';
import {signedArea} from '../src/geometry/math.ts';
import {exportFlatPatternSvg} from '../src/export/svg.ts';
import {exportFlatPatternDxf} from '../src/export/dxf.ts';
const square=(x:number)=>[{x,y:0},{x:x+20,y:0},{x:x+20,y:20},{x,y:20}];
test('shared edges are deduplicated and winding is normalized',()=>{
 const doc=createFlatPatternDocument('two','',[{id:'A',color:'#ff0000',outline:square(0).reverse()},{id:'B',color:'#00ff00',outline:square(20)}],1);
 assert.equal(doc.seams.length,7);assert.equal(doc.panels.length,2);
 assert.ok(doc.panels.every(p=>signedArea(p.centerlineOutline)>0));
 assert.ok(doc.panels[0].glassCutOutline.every(p=>p.x>=1&&p.x<=19&&p.y>=1&&p.y<=19));
});
test('degenerate input creates no fake glass panels',()=>{
 const doc=createFlatPatternDocument('empty','',[{id:'A',color:'#fff',outline:[{x:0,y:0},{x:1,y:1}]}],1);
 assert.equal(doc.panels.length,0);
});
test('SVG escapes imported labels and preserves edited color',()=>{
 const doc=createFlatPatternDocument('<script>','',[{id:'A"<&',color:'#123456',outline:square(0)}],1);
 const svg=exportFlatPatternSvg(doc);
 assert.ok(svg.includes('fill="#123456"'));assert.ok(svg.includes('A&quot;&lt;&amp;'));assert.ok(!svg.includes('<script>'));
});
test('DXF contains separate cut and seam layers',()=>{
 const doc=createFlatPatternDocument('one','',[{id:'A',color:'#123456',outline:square(0)}],1);
 const dxf=exportFlatPatternDxf(doc);assert.ok(dxf.includes('GLASS_CUT'));assert.ok(dxf.includes('SEAM_CENTERLINE'));assert.ok(dxf.includes('EOF'));
});
