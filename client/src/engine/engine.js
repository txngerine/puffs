// Rendering + audio engine: WebGL field, Canvas 2D particles, HUD, capture.
// Ported from the original single-file version; module-level state, one engine per page.
import { toast as say, store, ui } from '../lib/store.js';

export const TAU=Math.PI*2, LOOP=5, NB=64;
const qs=new URLSearchParams(location.search);
let glc, cv, ctx, hv, hctx;

function parseSeed(v){
  if(v===null) return 1337;
  if(v==='random') return (Math.random()*4294967296)>>>0;
  const n=parseInt(v,10);
  return isFinite(n)?n>>>0:1337;
}
let seed=parseSeed(qs.get('seed'));
export const hex=n=>n.toString(16).padStart(8,'0');
export const pick=(...a)=>a[Math.floor(Math.random()*a.length)];
export function num(v){
  const a=Math.abs(v);
  const r=a>=1000?Math.round(v):a>=1?Math.round(v*100)/100:+v.toPrecision(3);
  return String(r);
}

let W=0,H=0,DPR=1,SC=1,HS=1,FX=0,FW=0;
let elapsed=0, last=performance.now(), tl=0, paused=false, settle=0;
const motionParam=qs.get('motion');
const reduced = motionParam==='0' ? true
  : motionParam==='1' ? false
  : matchMedia('(prefers-reduced-motion: reduce)').matches;
const ph=n=>TAU*(tl/LOOP)*n;
// while paused the scene is not redrawn; invalidate() re-renders a few frames so trails settle
function invalidate(){ settle=Math.max(settle,30); }
/* ===== audio ===== */
let bands=new Float32Array(NB), energy=0, bass=0, mid=0, treble=0;
let boost=1;
// set by the speech module: drives the visual while the assistant talks
export const voice={env:0,speaking:false};
function bandAt(x){ let i=(x*(NB-1))|0; if(i<0)i=0; if(i>NB-1)i=NB-1; return bands[i]; }

let actx=null, analyser=null, sink=null, recDest=null, freqData=null, binMap=null;
let source='synth', prevReal=null, audioEl=null, elNode=null, micStream=null, micNode=null;

export function ensureCtx(){
  if(!actx){
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC){ say('Web Audio unavailable'); return; }
    actx=new AC();
    analyser=actx.createAnalyser();
    // 4096 keeps bins ~11.7 Hz wide at 48 kHz; narrower bands interpolate between bins
    analyser.fftSize=4096;
    analyser.smoothingTimeConstant=0.6;
    sink=actx.createGain(); sink.gain.value=0;
    analyser.connect(sink); sink.connect(actx.destination);
    if(actx.createMediaStreamDestination) recDest=actx.createMediaStreamDestination();
    freqData=new Uint8Array(analyser.frequencyBinCount);
    buildBins();
  }
  if(actx.state==='suspended') actx.resume();
}
function buildBins(){
  const res=(actx.sampleRate/2)/analyser.frequencyBinCount;
  const maxBin=analyser.frequencyBinCount-1;
  binMap=[];
  for(let i=0;i<NB;i++){
    const f0=20*Math.pow(800,i/NB), f1=20*Math.pow(800,(i+1)/NB), fc=20*Math.pow(800,(i+0.5)/NB);
    let b0=Math.max(1,Math.round(f0/res)), b1=Math.min(maxBin,Math.round(f1/res));
    let fcb=fc/res; if(fcb>maxBin-1) fcb=maxBin-1;
    binMap.push({b0,b1,fc:fcb,wide:b1-b0>=2});
  }
}
function stopMic(){
  if(micNode){ try{micNode.disconnect();}catch(e){ /* already disconnected */ } micNode=null; }
  if(micStream){ micStream.getTracks().forEach(t=>t.stop()); micStream=null; }
}
export async function toMic(){
  ensureCtx(); if(!actx) return false;
  if(source==='mic'&&micStream) return true;
  stopMic();
  if(audioEl) audioEl.pause();
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){ say('mic not available'); return false; }
  say('REQUESTING MIC…',8000);
  try{
    const s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    micStream=s;
    micNode=actx.createMediaStreamSource(s);
    micNode.connect(analyser);
    source='mic'; prevReal='mic';
    say('MIC ON — live input');
    return true;
  }catch(e){
    if(source==='mic') source=(audioEl&&audioEl.src)?'file':'synth';
    say('mic unavailable ('+(e.name||'error')+')');
    return false;
  }
}
export function loadFile(file){
  if(!file) return;
  ensureCtx(); if(!actx) return;
  if(!/^audio\//.test(file.type) && !/\.(mp3|wav|ogg|m4a|flac|aac|webm)$/i.test(file.name)){
    say('not an audio file'); return;
  }
  try{
    if(!audioEl){
      audioEl=new Audio(); audioEl.loop=true;
      elNode=actx.createMediaElementSource(audioEl);
      elNode.connect(analyser); elNode.connect(actx.destination);
      if(recDest) elNode.connect(recDest);
    }
    stopMic();
    const old=(audioEl.src||'').startsWith('blob:')?audioEl.src:null;
    audioEl.src=URL.createObjectURL(file);
    if(old) URL.revokeObjectURL(old);
    audioEl.play().catch(()=>say('press [Space] to play'));
    source='file'; prevReal='file';
    say('PLAYING '+file.name.slice(0,42));
  }catch(e){ say('could not play that file'); }
}
// hand the microphone back after the assistant borrowed it
export function releaseMic(){
  if(source!=='mic') return;
  stopMic();
  if(prevReal==='file'&&audioEl){ source='file'; audioEl.play().catch(()=>{}); say('file on'); }
  else source='synth';
}
export function audioOff(){
  stopMic(); if(audioEl) audioEl.pause();
  source='synth'; say('AUDIO OFF — synthetic driver');
}
export function toggleAudio(){
  if(source==='synth'){
    if(prevReal==='mic') toMic();
    else if(prevReal==='file'&&audioEl){ ensureCtx(); audioEl.play().catch(()=>{}); source='file'; say('file on'); }
    else say('no source yet — [M] mic or [F] file');
  }else if(source==='file'&&audioEl&&audioEl.paused){
    ensureCtx(); audioEl.play().catch(()=>say('playback blocked — press [Space] again'));
  }else audioOff();
}
function readAudio(){
  if(source!=='synth'&&analyser){
    analyser.getByteFrequencyData(freqData);
    for(let i=0;i<NB;i++){
      const b=binMap[i]; let v;
      if(b.wide){
        let s=0; for(let k=b.b0;k<b.b1;k++) s+=freqData[k];
        v=s/((b.b1-b.b0)*255);
      }else{
        const k=Math.floor(b.fc), fr=b.fc-k;
        v=(freqData[k]*(1-fr)+freqData[k+1]*fr)/255;
      }
      v=Math.pow(v,0.7)*1.5; if(v>1)v=1;
      const t=bands[i];
      bands[i]=t+(v-t)*(v>t?0.55:0.14);
    }
  }else synthBands();
  if(boost!==1){ for(let i=0;i<NB;i++){ const v=bands[i]*boost; bands[i]=v>1?1:v; } }
  let e=0,b=0,m=0,tr=0;
  for(let i=0;i<NB;i++){
    const v=bands[i]; e+=v;
    if(i<8)b+=v; else if(i<32)m+=v; else tr+=v;
  }
  energy=e/NB; bass=b/8; mid=m/24; treble=tr/32;
  if(voice.speaking||voice.env>0.002) voiceFx();
}
function voiceFx(){
  const v=voice.env>1?1:voice.env;
  if(v<=0) return;
  const t=performance.now()/1000;
  const f1=9+7*Math.sin(t*4.7)+4*Math.sin(t*2.1);
  for(let i=0;i<NB;i++){
    const a=Math.exp(-Math.pow((i-f1)/4.2,2));
    const b=Math.exp(-Math.pow((i-f1*0.42-3)/3.4,2));
    const g=(a*0.9+b*0.55)*v;
    if(g>bands[i]) bands[i]=g>1?1:g;
  }
  energy=Math.min(1,energy+0.22*v);
  mid=Math.min(1,mid+0.2*v);
  treble=Math.min(1,treble+0.15*v);
}
function synthBands(){
  const p1=ph(1), p3=ph(3);
  const kick=Math.pow(Math.max(0,Math.sin(ph(6))),6);
  const snare=Math.pow(Math.max(0,Math.sin(ph(6)+Math.PI)),8);
  const hat=Math.pow(Math.max(0,Math.sin(ph(12)+0.9)),14);
  const swell=0.5+0.5*Math.sin(ph(2));
  for(let i=0;i<NB;i++){
    const f=i/(NB-1);
    let v=0.11+0.05*Math.sin(i*0.9+p1)+0.04*Math.sin(i*2.3-p3);
    v/=(1.0+f*1.7);
    v+=kick*Math.exp(-f*7.0)*0.72;
    v+=hat*Math.exp(-(1.0-f)*9.0)*0.45;
    v+=snare*Math.exp(-Math.abs(f-0.42)*7.0)*0.30;
    v+=swell*0.10*Math.exp(-Math.pow((f-0.30-0.15*Math.sin(p1))*4.0,2.0));
    if(v<0)v=0; if(v>1)v=1;
    bands[i]+=(v-bands[i])*0.35;
  }
}
/* ===== rings (seeded, batched by alpha tier) ===== */
const NR=36, TIERS=6, TIERF=[];
for(let t=0;t<TIERS;t++) TIERF[t]=0.35+0.75*((t+0.5)/TIERS);
let rings=[];

function buildRings(){
  let x=(seed||1)>>>0;
  const rnd=()=>{ x=(x*1664525+1013904223)>>>0; return x/4294967296; };
  rings=[];
  for(let r=0;r<NR;r++){
    const q=r/(NR-1);
    const count=210+(r%5)*23;
    const tiers=[]; for(let t=0;t<TIERS;t++) tiers.push([]);
    const b1=r*0.16, b2=r;
    for(let i=0;i<count;i++){
      const a=i/count*TAU;
      const n=rnd()*2-1, z=rnd();
      const g1=a*2.1;
      const A1=g1*1.73+b1*2.11, A2=g1*4.31-b1*0.91, A3=g1*9.7+b1*0.37;
      const g2=a*5;
      const B1=g2*1.73+b2*2.11, B2=g2*4.31-b2*0.91, B3=g2*9.7+b2*0.37;
      const p={
        ca:Math.cos(a), sa:Math.sin(a), n, z,
        w:[Math.sin(A1),Math.cos(A1),Math.sin(A2),Math.cos(A2),Math.sin(A3),Math.cos(A3)],
        w2:[Math.sin(B1),Math.cos(B1),Math.sin(B2),Math.cos(B2),Math.sin(B3),Math.cos(B3)],
        bs:Math.sin(a*3), bc:Math.cos(a*3),
        ns:Math.sin(z*8), nc:Math.cos(z*8),
        sz:(0.35+1.5*z)*(1+0.9*q)
      };
      tiers[Math.min(TIERS-1,(z*TIERS)|0)].push(p);
    }
    rings.push({q,tiers,count});
  }
}
buildRings();

/* ===== spectrogram waterfall (phase-locked ring buffer) ===== */
const SW=240, SH=64, STEP=LOOP/SW;
const hist=new Uint8Array(SW*SH);
const specOff=document.createElement('canvas'); specOff.width=SW; specOff.height=SH;
const specCtx=specOff.getContext('2d');
const specImg=specCtx.createImageData(SW,SH);
let lastStep=-1;

function writeCol(c){
  const o=c*SH;
  for(let i=0;i<NB;i++) hist[o+(SH-1-i)]=(bands[i]*255)|0;
}
function updateSpec(){
  if(lastStep<0){
    for(let c=0;c<SW;c++) writeCol(c);
    lastStep=(tl/STEP)|0;
    return;
  }
  const cur=(tl/STEP)|0;
  if(cur===lastStep) return;
  let s=lastStep, guard=0;
  while(s!==cur&&guard++<SW){ s=(s+1)%SW; writeCol(s); }
  lastStep=cur;
}
function drawSpec(){
  const d=specImg.data, cur=lastStep;
  for(let x=0;x<SW;x++){
    const src=((cur+1+x)%SW)*SH;
    for(let y=0;y<SH;y++){
      const o=(y*SW+x)*4, v=hist[src+y];
      d[o]=255; d[o+1]=255; d[o+2]=255; d[o+3]=v;
    }
  }
  specCtx.putImageData(specImg,0,0);
  const x=FX+FW*0.08, y=H*0.045, w=FW*0.84, h=H*0.085;
  hctx.globalAlpha=0.92;
  hctx.drawImage(specOff,x,y,w,h);
  hctx.globalAlpha=1;
  hctx.strokeStyle='#2c2c2c'; hctx.lineWidth=1;
  hctx.strokeRect(x+0.5,y+0.5,w-1,h-1);
  hctx.fillStyle='#585858';
  hctx.font=(7*HS)+'px ui-monospace,SFMono-Regular,Menlo,monospace';
  hctx.textBaseline='top'; hctx.textAlign='left';
  hctx.fillText('SPECTRUM 20 Hz - 16 kHz',x,y+h+4);
  hctx.textAlign='right';
  hctx.fillText('240 COLS / 5.0 s LOOP',x+w,y+h+4);
  hctx.textAlign='left';
}
/* ===== webgl field ===== */
let gl=null, prog=null, U={}, tex=null, texData=new Uint8Array(NB*4), glOK=false;

function compile(g,type,src){
  const s=g.createShader(type);
  g.shaderSource(s,src); g.compileShader(s);
  if(!g.getShaderParameter(s,g.COMPILE_STATUS)){ console.warn(g.getShaderInfoLog(s)); return null; }
  return s;
}
function initGL(){
  try{
    const o={alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true};
    gl=glc.getContext('webgl',o)||glc.getContext('experimental-webgl',o);
  }catch(e){ gl=null; }
  if(!gl) return false;
  const vs='attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}';
  const fs=[
  '#ifdef GL_FRAGMENT_PRECISION_HIGH','precision highp float;','#else','precision mediump float;','#endif',
  'uniform vec2 uRes;uniform float uT;uniform float uSeed;uniform float uPass;',
  'uniform float uEnergy;uniform float uTreble;uniform sampler2D uBands;',
  'const float TAU=6.28318530718;const float LOOP=5.0;',
  'float h11(float p){p=fract(p*0.1031);p*=p+33.33;p*=p+p;return fract(p);}',
  'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);',
  ' float a=h11(i.x+i.y*57.0),b=h11(i.x+1.0+i.y*57.0),c=h11(i.x+(i.y+1.0)*57.0),d=h11(i.x+1.0+(i.y+1.0)*57.0);',
  ' return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}',
  'float bd(float x){return texture2D(uBands,vec2((clamp(x,0.0,1.0)*63.0+0.5)/64.0,0.5)).r;}',
  'void main(){',
  // pass 0: multiplicative trail fade; pass 1: subtract one 8-bit step so faded trails reach true black
  ' if(uPass<0.5){gl_FragColor=vec4(0.0,0.0,0.0,0.24);return;}',
  ' if(uPass<1.5){gl_FragColor=vec4(vec3(1.0/255.0),0.0);return;}',
  ' vec2 p=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);',
  ' float sc=min(uRes.x/720.0,uRes.y/900.0);',
  ' vec2 d=(p-vec2(uRes.x*0.5,uRes.y*0.505))/(245.0*sc);',
  ' d.y*=1.0752688;', // 1/0.93, matches the 2D layers' vertical squash
  ' float r=length(d),ang=atan(d.y,d.x);',
  ' float ph1=TAU*uT/LOOP,ph3=ph1*3.0;',
  ' vec3 col=vec3(0.0);',
  ' float aa=ang-0.03*sin(ph1);',
  ' float fi=fract(aa/TAU+0.5)*150.0;',
  ' float id=floor(fi),f=fract(fi);',
  ' float hs=h11(id*1.7+uSeed*0.013);',
  ' float pulse=(0.5+0.5*sin(ph3+id*0.47+uSeed*0.0009));',
  ' pulse*=0.40+1.15*bd(fract(id*0.0137+0.11));',
  ' float r1=0.63+0.12*sin(id*0.71+ph1+hs*TAU);',
  ' float r2=1.05+0.34*pulse*(0.75+0.5*uTreble);',
  ' float lw=0.05+0.06*pulse;',
  ' float line=1.0-smoothstep(0.0,lw,abs(f-0.5));',
  ' float msk=smoothstep(r1,r1+0.06,r)*(1.0-smoothstep(r2-0.15,r2,r));',
  ' col+=vec3(1.0)*line*msk*(0.014+0.032*clamp(pulse,0.0,1.6));',
  ' float q=(r-0.23)/0.82;',
  ' float bnd=bd(q);',
  ' float dust=vn(vec2(ang*7.0+uSeed*0.31,r*16.0-ph1*0.35));',
  ' float rm=smoothstep(0.14,0.34,r)*(1.0-smoothstep(0.90,1.20,r));',
  ' col+=vec3(1.0)*bnd*rm*(0.020+0.055*dust)*(0.55+0.90*uEnergy);',
  ' float sm=vn(vec2(ang*3.0+ph1*0.5,r*5.0+uSeed*0.07));',
  ' col+=vec3(1.0)*(0.008+0.022*uTreble)*smoothstep(0.95,1.30,r)*(1.0-smoothstep(1.30,1.60,r))*sm;',
  ' col*=smoothstep(0.30,0.62,r);',
  ' col+=(h11(gl_FragCoord.x+gl_FragCoord.y*1919.0+uT*7.0)-0.5)*0.007;',
  ' gl_FragColor=vec4(max(col,vec3(0.0)),1.0);',
  '}'].join('\n');

  const v=compile(gl,gl.VERTEX_SHADER,vs), f=compile(gl,gl.FRAGMENT_SHADER,fs);
  if(!v||!f) return false;
  prog=gl.createProgram(); gl.attachShader(prog,v); gl.attachShader(prog,f); gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){ console.warn(gl.getProgramInfoLog(prog)); return false; }
  gl.useProgram(prog);
  const buf=gl.createBuffer(); fbuf=buf;
  gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const loc=gl.getAttribLocation(prog,'a'); aField=loc;
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  ['uRes','uT','uSeed','uPass','uEnergy','uTreble','uBands'].forEach(k=>U[k]=gl.getUniformLocation(prog,k));
  tex=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,NB,1,0,gl.RGBA,gl.UNSIGNED_BYTE,texData);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.uniform1i(U.uBands,0);
  gl.clearColor(0,0,0,1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return true;
}
/* ----- GPU particles: positions computed in the vertex shader from static per-particle data
   plus 36 per-ring uniforms, so the CPU does ~40 updates per frame instead of ~9,000. ----- */
let pprog=null, PU={}, PA={}, pbuf=null, fbuf=null, aField=0, pcount=0, gpuParticles=false;
const PSTRIDE=22;
const PVS=[
  'attribute vec4 aP;attribute vec4 aW;attribute vec4 aX;attribute vec4 aV;attribute vec4 aB;attribute vec2 aS;',
  'uniform vec4 uRA['+NR+'];uniform vec4 uRB['+NR+'];',
  'uniform vec4 uK1;uniform vec4 uK2;uniform vec4 uM1;uniform vec2 uM2;uniform vec4 uView;',
  'uniform float uBase;uniform float uSC;uniform float uDPR;',
  'varying float vA;varying float vPs;varying float vRows;',
  'void main(){',
  ' int r=int(aS.y+0.5);',
  ' vec4 A=uRA[r];vec4 B=uRB[r];',          // A: rr*wob, cw, sw, bnd   B: bcos, bsin, ringA, q
  ' float q=B.w;',
  ' float wave=0.48*(aW.x*uK1.x+aW.y*uK1.y)+0.28*(aW.z*uK1.z+aW.w*uK1.w)+0.16*(aX.y*uK2.x+aX.x*uK2.y);',
  ' float u=aB.x*B.x+aB.y*B.y;',
  ' float bu=u>0.0?u*u*u*u*u:0.0;',
  ' float rad=A.x+uBase*(0.022*wave+0.045*aP.z*(uK2.z*aB.w+uK2.w*aB.z)+0.08*bu*q*(0.5+1.2*A.w));',
  ' if(q>0.72){',
  '  float n2=0.48*(aX.z*uM1.x+aX.w*uM1.y)+0.28*(aV.x*uM1.z+aV.y*uM1.w)+0.16*(aV.w*uM2.x+aV.z*uM2.y);',
  '  rad+=uBase*0.055*n2;',
  ' }',
  ' float x=(aP.x*A.y-aP.y*A.z)*rad;',
  ' float y=(aP.x*A.z+aP.y*A.y)*rad*0.93;',
  ' float sz=aS.x*uSC;',
  ' float h=max(0.45,sz*0.34);',
  ' vec2 c=uView.xy+vec2(x+sz*0.5,y+h*0.5);',
  ' gl_Position=vec4(c.x/uView.z*2.0-1.0,1.0-c.y/uView.w*2.0,0.0,1.0);',
  // the CPU path draws a flat sz x h rectangle: whole-pixel point, lit only on its middle rows
  ' float ps=max(1.0,floor(sz*uDPR+0.5));',
  ' gl_PointSize=ps;',
  ' float rows=clamp(floor(h*uDPR+0.5),1.0,ps);',
  ' vPs=ps;vRows=rows;',
  ' float tier=min(5.0,floor(aP.w*6.0));',
  ' float a=B.z*(0.35+0.75*((tier+0.5)/6.0));',
  ' vA=a<0.004?0.0:a*(sz*h*uDPR*uDPR)/(ps*rows);', // keep the same total light as the rectangle
  '}'].join('\n');
const PFS=[
  'precision mediump float;',
  'varying float vA;varying float vPs;varying float vRows;',
  'void main(){',
  ' float row=floor(gl_PointCoord.y*vPs);',
  ' float first=floor((vPs-vRows)*0.5);',
  ' if(vA<=0.0||row<first||row>=first+vRows)discard;',
  ' gl_FragColor=vec4(vec3(vA+1.0/255.0),1.0);',  // repays the field layer\'s per-frame trail floor
  '}'].join('\n');
function initParticlesGL(){
  if(qs.get('particles')==='cpu') return false;
  const v=compile(gl,gl.VERTEX_SHADER,PVS), f=compile(gl,gl.FRAGMENT_SHADER,PFS);
  if(!v||!f) return false;
  pprog=gl.createProgram(); gl.attachShader(pprog,v); gl.attachShader(pprog,f); gl.linkProgram(pprog);
  if(!gl.getProgramParameter(pprog,gl.LINK_STATUS)){ console.warn(gl.getProgramInfoLog(pprog)); return false; }
  ['aP','aW','aX','aV','aB','aS'].forEach(k=>PA[k]=gl.getAttribLocation(pprog,k));
  ['uRA','uRB','uK1','uK2','uM1','uM2','uView','uBase','uSC','uDPR'].forEach(k=>PU[k]=gl.getUniformLocation(pprog,k));
  pbuf=gl.createBuffer();
  uploadParticles();
  return true;
}
function uploadParticles(){
  if(!pbuf) return;
  let n=0; for(const R of rings) n+=R.count;
  const d=new Float32Array(n*PSTRIDE); let o=0;
  rings.forEach((R,ri)=>{
    for(const tier of R.tiers) for(const p of tier){
      d.set([p.ca,p.sa,p.n,p.z, p.w[0],p.w[1],p.w[2],p.w[3], p.w[4],p.w[5],p.w2[0],p.w2[1],
        p.w2[2],p.w2[3],p.w2[4],p.w2[5], p.bs,p.bc,p.ns,p.nc, p.sz,ri],o);
      o+=PSTRIDE;
    }
  });
  gl.bindBuffer(gl.ARRAY_BUFFER,pbuf);
  gl.bufferData(gl.ARRAY_BUFFER,d,gl.STATIC_DRAW);
  pcount=n;
}
const RA=new Float32Array(NR*4), RB=new Float32Array(NR*4);
function drawParticlesGL(){
  for(let r=0;r<NR;r++){
    const S=RS[r];
    RA[r*4]=S.rr*S.wob; RA[r*4+1]=S.cw; RA[r*4+2]=S.sw; RA[r*4+3]=S.bnd;
    RB[r*4]=S.bcos; RB[r*4+1]=S.bsin; RB[r*4+2]=S.ringA; RB[r*4+3]=rings[r].q;
  }
  gl.disableVertexAttribArray(aField);
  gl.useProgram(pprog);
  gl.uniform4fv(PU.uRA,RA); gl.uniform4fv(PU.uRB,RB);
  gl.uniform4f(PU.uK1,PK.k1c,PK.k1s,PK.k2c,PK.k2s);
  gl.uniform4f(PU.uK2,PK.k3c,PK.k3s,PK.S1,PK.C1);
  gl.uniform4f(PU.uM1,PK.m1c,PK.m1s,PK.m2c,PK.m2s);
  gl.uniform2f(PU.uM2,PK.m3c,PK.m3s);
  gl.uniform4f(PU.uView,W*0.5,H*0.505,W,H);
  gl.uniform1f(PU.uBase,245*SC); gl.uniform1f(PU.uSC,SC); gl.uniform1f(PU.uDPR,DPR);
  gl.bindBuffer(gl.ARRAY_BUFFER,pbuf);
  const F=4, sizes={aP:4,aW:4,aX:4,aV:4,aB:4,aS:2}; let off=0;
  for(const k of ['aP','aW','aX','aV','aB','aS']){
    gl.enableVertexAttribArray(PA[k]);
    gl.vertexAttribPointer(PA[k],sizes[k],gl.FLOAT,false,PSTRIDE*F,off*F);
    off+=sizes[k];
  }
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.ONE,gl.ONE);
  gl.drawArrays(gl.POINTS,0,pcount);
  for(const k of ['aP','aW','aX','aV','aB','aS']) gl.disableVertexAttribArray(PA[k]);
  // restore the field program's quad for the next frame
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER,fbuf);
  gl.enableVertexAttribArray(aField);
  gl.vertexAttribPointer(aField,2,gl.FLOAT,false,0,0);
}

function drawGL(){
  gl.viewport(0,0,glc.width,glc.height);
  gl.enable(gl.BLEND);
  gl.useProgram(prog);
  gl.uniform2f(U.uRes,glc.width,glc.height);
  gl.uniform1f(U.uT,tl);
  gl.uniform1f(U.uSeed,seed%65536);
  gl.uniform1f(U.uEnergy,energy);
  gl.uniform1f(U.uTreble,treble);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D,tex);
  for(let i=0;i<NB;i++){
    texData[i*4]=(bands[i]*255)|0;
    texData[i*4+1]=(bass*255)|0;
    texData[i*4+2]=(treble*255)|0;
    texData[i*4+3]=255;
  }
  gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,NB,1,gl.RGBA,gl.UNSIGNED_BYTE,texData);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.ZERO,gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1f(U.uPass,0);
  gl.drawArrays(gl.TRIANGLES,0,3);
  gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
  gl.blendFunc(gl.ONE,gl.ONE);
  gl.uniform1f(U.uPass,1);
  gl.drawArrays(gl.TRIANGLES,0,3);
  gl.blendEquation(gl.FUNC_ADD);
  gl.uniform1f(U.uPass,2);
  gl.drawArrays(gl.TRIANGLES,0,3);
  if(gpuParticles) drawParticlesGL();
}
/* ===== 2d layers ===== */
const LV=16, MAXA=0.32;
const bk=[]; for(let i=0;i<LV;i++) bk.push(new Uint16Array(NR*TIERS*2));
const bn=new Uint16Array(LV), lva=new Float32Array(LV);
const RS=[]; for(let r=0;r<NR;r++) RS.push({rr:0,wob:0,cw:1,sw:0,bcos:1,bsin:0,bnd:0,ringA:0});

function drawStreaks2D(){
  const base=245*SC;
  for(let i=0;i<150;i++){
    const a=(i/150)*TAU+Math.sin(ph(1))*0.03;
    let pulse=0.5+0.5*Math.sin(ph(3)+i*0.47);
    pulse*=0.45+1.1*bandAt((i*0.0137+0.11)%1);
    const r1=base*(0.63+0.12*Math.sin(i*0.71+ph(1)));
    const r2=base*(1.05+0.34*pulse*(0.75+0.5*treble));
    const x1=Math.cos(a)*r1, y1=Math.sin(a)*r1*0.93;
    const x2=Math.cos(a)*r2, y2=Math.sin(a)*r2*0.93;
    ctx.strokeStyle='rgba(255,255,255,'+(0.014+0.03*Math.min(1.6,pulse)).toFixed(4)+')';
    ctx.lineWidth=0.45*SC;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  }
}

// per-frame phase terms shared by the CPU and GPU particle paths
const PK={k1c:1,k1s:0,k2c:1,k2s:0,k3c:1,k3s:0,m1c:1,m1s:0,m2c:1,m2s:0,m3c:1,m3s:0,S1:0,C1:1};
function computeRings(){
  const base=245*SC;
  const p1=ph(1), c2=p1+2.7;
  PK.k1c=Math.cos(p1); PK.k1s=Math.sin(p1);
  PK.k2c=Math.cos(p1*1.7); PK.k2s=Math.sin(p1*1.7);
  PK.k3c=Math.cos(p1*0.7); PK.k3s=Math.sin(p1*0.7);
  PK.m1c=Math.cos(c2); PK.m1s=Math.sin(c2);
  PK.m2c=Math.cos(c2*1.7); PK.m2s=Math.sin(c2*1.7);
  PK.m3c=Math.cos(c2*0.7); PK.m3s=Math.sin(c2*0.7);
  PK.S1=Math.sin(p1); PK.C1=Math.cos(p1);
  for(let r=0;r<NR;r++){
    const q=rings[r].q;
    const bnd=bandAt(q);
    const aw=0.018*Math.sin(p1+r*0.13);
    const bp=-ph(2)+r*0.07;
    const S=RS[r];
    S.ringA=(0.035+0.11*Math.pow(q,0.55))*(0.5+0.95*bnd+0.35*energy);
    S.rr=base*(0.23+q*0.82)*(1+0.06*bnd+0.03*bass);
    S.wob=1+0.055*Math.sin(ph(2)+r*0.37)+0.035*Math.sin(ph(4)-r*0.19);
    S.cw=Math.cos(aw); S.sw=Math.sin(aw);
    S.bcos=Math.cos(bp); S.bsin=Math.sin(bp);
    S.bnd=bnd;
  }
}

// CPU fallback (no WebGL, or ?particles=cpu): batched fillRect by quantized alpha
function drawParticles(){
  const base=245*SC;
  const {k1c,k1s,k2c,k2s,k3c,k3s,m1c,m1s,m2c,m2s,m3c,m3s,S1,C1}=PK;
  bn.fill(0);
  for(let r=0;r<NR;r++){
    const ringA=RS[r].ringA;
    for(let t=0;t<TIERS;t++){
      const a=ringA*TIERF[t];
      if(a<0.004) continue;
      let lv=(Math.sqrt(a/MAXA)*16)|0; if(lv>15)lv=15;
      const arr=bk[lv], n=bn[lv];
      arr[n]=r; arr[n+1]=t; bn[lv]=n+2;
      lva[lv]=a;
    }
  }

  for(let lv=0;lv<LV;lv++){
    const n=bn[lv]; if(!n) continue;
    ctx.fillStyle='rgba(255,255,255,'+lva[lv].toFixed(4)+')';
    const arr=bk[lv];
    for(let k=0;k<n;k+=2){
      const r=arr[k], t=arr[k+1];
      const R=RS[r], pts=rings[r].tiers[t], q=rings[r].q;
      const outer=q>0.72;
      for(let j=0;j<pts.length;j++){
        const p=pts[j], w=p.w, w2=p.w2;
        const wave=0.48*(w[0]*k1c+w[1]*k1s)+0.28*(w[2]*k2c+w[3]*k2s)+0.16*(w[5]*k3c+w[4]*k3s);
        const u=p.bs*R.bcos+p.bc*R.bsin;
        const bu=u>0?u*u*u*u*u:0;
        let rad=R.rr*R.wob+base*(0.022*wave+0.045*p.n*(S1*p.nc+C1*p.ns)+0.08*bu*q*(0.5+1.2*R.bnd));
        if(outer){
          const n2=0.48*(w2[0]*m1c+w2[1]*m1s)+0.28*(w2[2]*m2c+w2[3]*m2s)+0.16*(w2[5]*m3c+w2[4]*m3s);
          rad+=base*0.055*n2;
        }
        const x=(p.ca*R.cw-p.sa*R.sw)*rad;
        const y=(p.ca*R.sw+p.sa*R.cw)*rad*0.93;
        const sz=p.sz*SC;
        ctx.fillRect(x,y,sz,Math.max(0.45,sz*0.34));
      }
    }
  }
}

function drawCenter(base){
  const g=ctx.createRadialGradient(0,0,0,0,0,base*0.58);
  g.addColorStop(0,'rgba(0,0,0,0.98)');
  g.addColorStop(0.38,'rgba(0,0,0,0.82)');
  g.addColorStop(0.7,'rgba(0,0,0,0.18)');
  g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.globalCompositeOperation='source-over';
  ctx.fillStyle=g;
  ctx.beginPath(); ctx.arc(0,0,base*0.6,0,TAU); ctx.fill();
}
function drawPetals(base){
  ctx.save();
  ctx.rotate(0.12*Math.sin(ph(1)));
  ctx.globalCompositeOperation='source-over';
  for(let k=0;k<9;k++){
    const len=base*(0.22+0.16*(0.5+0.5*Math.sin(ph(1)+k*1.7)))*(0.85+0.55*bass);
    ctx.rotate(TAU/9);
    ctx.fillStyle='rgba(0,0,0,0.78)';
    ctx.beginPath(); ctx.moveTo(0,0);
    ctx.quadraticCurveTo(len*0.32,-len*0.2,len,0);
    ctx.quadraticCurveTo(len*0.3,len*0.13,0,0);
    ctx.fill();
  }
  ctx.restore();
}
function drawInnerRing(base){
  ctx.globalCompositeOperation='lighter';
  for(let i=0;i<260;i++){
    const a=i/260*TAU;
    const r=base*(0.34+0.018*Math.sin(i*0.67+ph(4)));
    const len=base*(0.035+0.065*(0.5+0.5*Math.sin(i*0.43-ph(3))))*(0.6+0.8*treble);
    const al=(0.04+0.08*(i%7===0?1:0))*(0.55+0.7*mid);
    ctx.strokeStyle='rgba(255,255,255,'+al.toFixed(4)+')';
    ctx.lineWidth=0.5*SC;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r*0.93);
    ctx.lineTo(Math.cos(a)*(r+len),Math.sin(a)*(r+len)*0.93);
    ctx.stroke();
  }
}
/* ===== hud: part of the artwork, so it lands in exports (transient UI lives in the DOM) ===== */
function drawMeter(g,x,y,v){
  const w=56*HS, h=8*HS;
  g.strokeStyle='#555'; g.lineWidth=1;
  g.strokeRect(x+0.5,y+0.5,w-1,h-1);
  const bw=13*HS;
  let bx=w*0.536+(v-0.5)*24*HS-bw/2;
  if(bx<1)bx=1; if(bx>w-1-bw)bx=w-1-bw;
  g.fillStyle='#fff';
  g.fillRect(x+bx,y+1,bw,h-2);
}
function drawMark(g){
  g.font='900 '+(24*HS)+'px Arial,Helvetica,sans-serif';
  g.fillStyle='#eee';
  g.textAlign='center'; g.textBaseline='middle';
  g.save();
  g.translate(W*0.5,H-H*0.023-20*HS);
  g.transform(1,0,Math.tan(-4*Math.PI/180),1,0,0);
  g.fillText('EVE',0,0);
  g.restore();
}
function drawHUD(){
  const g=hctx;
  const narrow=(W/H)<=0.8;
  g.textBaseline='top'; g.textAlign='left';
  g.fillStyle='#eee';
  g.font=(10*HS)+'px ui-monospace,SFMono-Regular,Menlo,monospace';
  g.fillText(energy.toFixed(3),FX+FW*0.182,H*0.164);
  const value=tl*370+45*Math.sin(ph(2))+25*bass;
  g.fillText(value.toFixed(3),FX+FW*0.197,H*0.826);
  drawMeter(g,FX+FW*0.462,H*0.164,bass);
  drawMeter(g,FX+FW*0.462,H*0.826,treble);
  g.fillStyle='#d8d8d8';
  g.font=((narrow?7:8)*HS)+'px Arial,Helvetica,sans-serif';
  g.textAlign=narrow?'right':'left';
  const capX=narrow?FX+FW*0.91:FX+FW*0.736;
  g.fillText('Realtime audio spectrogram',capX,H*0.747);
  g.fillText('WebGL + Canvas, in the browser',capX,H*0.747+18*HS);
  g.textAlign='left';
  drawMark(g);
}

/* ===== capture ===== */
let recState='idle', warmStart=0, recStart=0, recorder=null, comp=null, compCtx=null, chunks=[], recCancelled=false;
const MIMES_AV=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
const MIMES=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
export const recording=()=>recState==='warm'||recState==='rec';

function composite(){
  if(!compCtx) return;
  compCtx.globalCompositeOperation='source-over';
  compCtx.fillStyle='#000';
  compCtx.fillRect(0,0,comp.width,comp.height);
  compCtx.drawImage(glc,0,0);
  compCtx.drawImage(cv,0,0);
  compCtx.drawImage(hv,0,0);
}
function endRec(){ recState='idle'; recorder=null; compCtx=null; comp=null; }
function beginRec(){
  try{
    comp=document.createElement('canvas');
    comp.width=cv.width; comp.height=cv.height;
    compCtx=comp.getContext('2d');
    const stream=comp.captureStream(60);
    // include the playing file's audio; the mic and the synthetic driver are silent
    const withAudio=recDest&&source==='file'&&audioEl&&!audioEl.paused;
    if(withAudio) recDest.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
    let mime='';
    for(const m of (withAudio?MIMES_AV:MIMES)){ if(MediaRecorder.isTypeSupported(m)){ mime=m; break; } }
    recorder=mime?new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:12000000})
                 :new MediaRecorder(stream);
    chunks=[];
    recCancelled=false;
    recorder.ondataavailable=e=>{ if(e.data&&e.data.size) chunks.push(e.data); };
    recorder.onstop=()=>{
      if(recCancelled){ recCancelled=false; chunks=[]; endRec(); return; }
      const type=recorder.mimeType||'video/webm';
      const blob=new Blob(chunks,{type});
      const ext=type.indexOf('mp4')>=0?'mp4':'webm';
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download='eve-'+seed.toString(16)+'-5s.'+ext;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),8000);
      say('SAVED '+a.download,4500);
      endRec();
    };
    recorder.start();
    recState='rec'; recStart=elapsed;
  }catch(e){
    say('recorder failed ('+(e.name||e.message||'error')+')');
    endRec();
  }
}
export function startCapture(){
  if(recState!=='idle') return 'Already recording.';
  if(typeof MediaRecorder==='undefined'||!cv.captureStream){
    say('recording not supported in this browser'); return 'Recording is not supported in this browser.';
  }
  paused=false;
  recState='warm'; warmStart=elapsed;
  return 'Recording one seamless five second loop. It downloads when it finishes, in about ten seconds.';
}
export function cancelCapture(msg){
  if(recState==='warm'){ recState='idle'; say(msg,4500); }
  else if(recState==='rec'){
    recCancelled=true; recState='stopping';
    try{ recorder.stop(); }catch(e){ endRec(); }
    say(msg,4500);
  }
}
function tickCapture(prevTl){
  if(!recording()) return;
  const wrapped=tl<prevTl;
  if(recState==='warm'){
    if(wrapped&&elapsed-warmStart>=LOOP) beginRec();
  }else if(wrapped){
    recState='stopping';
    try{ recorder.stop(); }catch(e){ endRec(); }
  }
}
export function snapshot(){
  const t=document.createElement('canvas');
  t.width=cv.width; t.height=cv.height;
  const tc=t.getContext('2d');
  tc.fillStyle='#000'; tc.fillRect(0,0,t.width,t.height);
  tc.drawImage(glc,0,0); tc.drawImage(cv,0,0); tc.drawImage(hv,0,0);
  t.toBlob(b=>{
    const a=document.createElement('a');
    a.href=URL.createObjectURL(b);
    a.download='eve-'+seed.toString(16)+'.png';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),8000);
    say('SAVED '+a.download);
  },'image/png');
}

/* ===== shared actions (keyboard, buttons and the assistant all use these) ===== */
export function setPaused(p){
  if(p&&recording()){ say('recording — pause blocked'); return "I can't pause while a loop is recording. It finishes in a few seconds."; }
  paused=p; last=performance.now();
  if(!p) settle=0;
  say(p?'paused':'playing');
  return p?pick('Paused.','Okay, holding the frame.','Frozen. Say play when you want it moving.')
          :pick('Playing.','And we are moving again.','Back in motion.');
}
export function setSeed(n){
  seed=n>>>0;
  buildRings();
  if(gpuParticles) uploadParticles();
  try{
    const u=new URL(location.href);
    u.searchParams.set('seed',seed);
    u.searchParams.delete('capture');
    history.replaceState(null,'',u);
  }catch(e){ /* history API unavailable (e.g. sandboxed frame) */ }
  setHint(); invalidate();
  say('SEED 0x'+hex(seed));
  return 'Seed zero x '+hex(seed).replace(/^0+(?=.)/,'')+'.';
}
export function reseed(){ return setSeed((Math.random()*4294967296)>>>0); }
export function setBoost(v){
  boost=Math.max(0.35,Math.min(2.4,v)); invalidate();
  say('BOOST '+boost.toFixed(2));
  return 'Boost is '+num(boost)+'.';
}
export function openFilePicker(){
  ui.pickFile();
  return 'Opening the file picker. If nothing appears, press F or drop an audio file anywhere.';
}

export function chime(){
  if(!actx) return;
  const t0=actx.currentTime;
  for(let i=0;i<3;i++){
    const o=actx.createOscillator(), g=actx.createGain();
    o.frequency.value=880; o.type='sine';
    g.gain.setValueAtTime(0.0001,t0+i*0.32);
    g.gain.exponentialRampToValueAtTime(0.25,t0+i*0.32+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+i*0.32+0.26);
    o.connect(g); g.connect(actx.destination);
    o.start(t0+i*0.32); o.stop(t0+i*0.32+0.3);
  }
}
/* ===== frame ===== */
function resize(){
  DPR=Math.min(window.devicePixelRatio||1,2);
  W=window.innerWidth; H=window.innerHeight;
  SC=Math.min(W/720,H/900);
  HS=Math.max(1,Math.min(2,SC));
  FW=Math.min(W,H*0.8); FX=(W-FW)/2;
  // conversation sits above the EVE mark unless the screen is wide enough to sit beside it
  const besideMark=W/2-60*HS>584;
  const besideStrip=W-(FX+FW*0.92)>270;
  document.documentElement.style.setProperty('--sys-top',(besideStrip?10:Math.round(H*0.164+20*HS))+'px');
  document.documentElement.style.setProperty('--talk-bottom',(besideMark?34:Math.round(H*0.023+44*HS))+'px');
  const nw=Math.round(W*DPR), nh=Math.round(H*DPR);
  if(glc.width!==nw||glc.height!==nh){
    if(recording()) cancelCapture('window resized — recording cancelled');
    glc.width=nw; glc.height=nh;
    cv.width=nw; cv.height=nh;
    hv.width=nw; hv.height=nh;
    if(glOK){ gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT); }
    invalidate();
  }
  ctx.setTransform(DPR,0,0,DPR,0,0);
  hctx.setTransform(DPR,0,0,DPR,0,0);
}

function frame(now){
  requestAnimationFrame(frame);
  let dt=(now-last)/1000;
  if(!(dt>0)) dt=0; else if(dt>0.1) dt=0.1;
  last=now;
  if(!paused){
    elapsed+=dt;
    if(voice.speaking){
      const s=Math.abs(Math.sin(now*0.014)+0.55*Math.sin(now*0.031));
      voice.env=Math.min(1,Math.max(voice.env*0.88,0.40+0.60*Math.min(1,s)));
    }else if(voice.env>0){
      voice.env=voice.env-dt*3.2; if(voice.env<0) voice.env=0;
    }
    readAudio();
  }
  const prevTl=tl;
  tl=elapsed%LOOP;
  updateSpec();
  tickCapture(prevTl);

  // paused: the last frame stays on the preserved buffers; only redraw while settling
  if(!paused||settle>0){
    if(settle>0) settle--;
    computeRings();
    if(glOK) drawGL();

    ctx.setTransform(DPR,0,0,DPR,0,0);
    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='rgba(0,0,0,0.24)';
    ctx.fillRect(0,0,W,H);
    ctx.globalCompositeOperation='lighter';
    ctx.save();
    ctx.translate(W*0.5,H*0.505);
    if(!glOK) drawStreaks2D();
    if(!gpuParticles) drawParticles();
    drawCenter(245*SC);
    drawPetals(245*SC);
    drawInnerRing(245*SC);
    ctx.restore();
  }

  hctx.setTransform(DPR,0,0,DPR,0,0);
  hctx.clearRect(0,0,W,H);
  drawSpec();
  drawHUD();
  if(recState==='rec') composite();
}

// read-only views for the UI
export const getState=()=>({gpuParticles,seed,paused,source,boost,recState,recording:recording(),elapsed,recStart,warmStart,ringCount:rings.length,particles:rings.reduce((n,r)=>n+r.count,0)});
function setHint(){ store.set({seed}); }

let mounted=false;
export function mountEngine(canvases){
  glc=canvases.gl; cv=canvases.c; hv=canvases.h;
  ctx=cv.getContext('2d'); hctx=hv.getContext('2d');
  setHint();
  if(mounted){ resize(); return; } // React StrictMode mounts twice; the engine is a singleton
  mounted=true;
  window.addEventListener('resize',resize);
  resize();
  glOK=initGL();
  if(!glOK) say('WebGL unavailable — 2D fallback',5000);
  else gpuParticles=initParticlesGL();
  if(reduced){
    for(let i=0;i<24;i++) readAudio();
    paused=true; invalidate();
    say('reduced motion — press L to animate',6000);
  }
  if(qs.get('capture')==='1') setTimeout(startCapture,600);
  requestAnimationFrame(frame);
}
