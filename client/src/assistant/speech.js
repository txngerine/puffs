// Speech output (text-to-speech).
import { lsGet, lsSet } from '../lib/storage.js';
import { api } from '../lib/api.js';
import { store } from '../lib/store.js';
import { voice } from '../engine/engine.js';

const setAState=s=>store.set({aState:s||''});
// hooks for barge-in: the assistant listens while Puffs talks
export const speechEvents={onStart:null,onIdle:null};
const recent=[];
export function recentSpeech(ms=20000){
  const cut=Date.now()-ms;
  while(recent.length&&recent[0].at<cut) recent.shift();
  return recent.map(r=>r.text).join(' ');
}
export const isSpeaking=()=>voice.speaking;
export const getRankedVoices=()=>{ if(!rankedVoices.length) loadVoices(); return rankedVoices; };
export function setVoiceByName(name){
  const q=name.toLowerCase();
  const v=getRankedVoices().find(x=>voiceLabel(x).toLowerCase().includes(q)||x.name.toLowerCase().includes(q));
  if(!v) return null;
  voicePrefs.name=v.name; savePrefs();
  return v;
}

/* ===== speech output =====
   Fluency comes from three things: the most natural voice the browser has, text rewritten the way
   it should be said, and chunking — the first sentence goes out alone so speech starts at once,
   then queued sentences are merged into longer utterances so the voice keeps one continuous
   intonation instead of restarting on every full stop. */
const TTS={q:[],cur:null,dog:0,waiters:[],first:true};
const voicePrefs={name:lsGet('puffs.voice',''),rate:lsGet('puffs.rate',1)};
// voice preferences are stored per device in MongoDB; localStorage is only a fast first-paint cache
function savePrefs(){
  lsSet('puffs.voice',voicePrefs.name); lsSet('puffs.rate',voicePrefs.rate);
  api('/settings',{method:'PUT',body:{voice:voicePrefs.name,rate:voicePrefs.rate}}).catch(()=>{});
}
export function applySettings(s){
  if(typeof s?.voice==='string') voicePrefs.name=s.voice;
  if(typeof s?.rate==='number') voicePrefs.rate=s.rate;
  lsSet('puffs.voice',voicePrefs.name); lsSet('puffs.rate',voicePrefs.rate);
}
export const getVoicePrefs=()=>({...voicePrefs});
let voices=[], rankedVoices=[];
const NOVELTY=/\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|grandma|grandpa|rocko|shelley|eddy|flo|reed|sandy)\b/i;
export function voiceScore(v){
  const want=(navigator.language||'en-US').toLowerCase();
  const vl=(v.lang||'').toLowerCase().replace('_','-');
  if(!vl.startsWith('en')) return -1;            // replies are English
  let sc=want.startsWith('en')&&vl===want?30:vl==='en-us'||vl==='en-gb'?20:10;
  if(/natural|neural/i.test(v.name)) sc+=60;      // Edge / Windows neural voices
  if(/premium|enhanced|siri/i.test(v.name)) sc+=45; // Apple downloaded high-quality voices
  if(/^google/i.test(v.name)) sc+=35;             // Chrome's network voices
  if(/online/i.test(v.name)) sc+=15;
  if(/\b(ava|samantha|allison|susan|zoe|evan|nathan|serena|daniel|karen|moira|tessa|aria|jenny|guy|libby|sonia|ryan|natasha)\b/i.test(v.name)) sc+=12;
  if(/\b(zira|david|mark|hazel)\b/i.test(v.name)) sc-=8; // older SAPI voices
  if(NOVELTY.test(v.name)) sc-=200;
  if(v.localService===false) sc+=4;
  return sc;
}
export function loadVoices(){
  voices=('speechSynthesis' in globalThis&&speechSynthesis.getVoices())||[];
  rankedVoices=voices.map(v=>[voiceScore(v),v]).filter(x=>x[0]>=0).sort((x,y)=>y[0]-x[0]).map(x=>x[1]);
}
if('speechSynthesis' in globalThis){
  loadVoices();
  speechSynthesis.addEventListener('voiceschanged',loadVoices);
}
export function pickVoice(){
  if(!voices.length) loadVoices();
  // offline, network voices (Chrome's Google voices) fall silent: use the best voice on this computer
  const usable=v=>v&&(navigator.onLine!==false||v.localService!==false);
  const chosen=voicePrefs.name&&voices.find(v=>v.name===voicePrefs.name);
  return [chosen,...rankedVoices,...voices].find(usable)||null;
}
export function voiceLabel(v){
  if(!v) return 'the default voice';
  const android=v.name.match(/^[a-z]{2,3}-([a-z]{2})-x-([a-z]+)-(local|network|embedded)/i); // e.g. en-us-x-iog-local
  if(android) return android[1].toUpperCase()+' voice '+android[2].toUpperCase();
  return v.name.replace(/^(Microsoft|Google|Apple)\s+/i,'').replace(/\s*\((Natural|Enhanced|Premium)\)/ig,'')
    .replace(/\s+Online\b/i,'').replace(/\s+-\s+.*$/,'').trim();
}
export function cycleVoice(){
  if(!rankedVoices.length) loadVoices();
  if(!rankedVoices.length) return "This browser doesn't offer other voices.";
  const cur=pickVoice(), top=rankedVoices.slice(0,8);
  const next=top[(top.indexOf(cur)+1)%top.length];
  voicePrefs.name=next.name; savePrefs();
  return "Hi, I'm using "+voiceLabel(next)+' now.';
}
export function setRate(r){
  voicePrefs.rate=Math.max(0.8,Math.min(1.35,Math.round(r*100)/100)); savePrefs();
  return voicePrefs.rate>1.02?"Okay, I'll talk a bit faster.":voicePrefs.rate<0.98?"Sure, I'll slow down.":'Back to my normal pace.';
}
const SAY_UNITS={km:'kilometers',mi:'miles',kg:'kilograms',lb:'pounds',lbs:'pounds',mph:'miles per hour',kph:'kilometers per hour',ft:'feet',cm:'centimeters',mm:'millimeters',ml:'milliliters',oz:'ounces',hz:'hertz',khz:'kilohertz',ms:'milliseconds',mb:'megabytes',gb:'gigabytes'};
export function speechText(t){
  return t
    .replace(/```[\s\S]*?```/g,' ').replace(/`([^`]*)`/g,'$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/https?:\/\/\S+/g,'a link')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm,'').replace(/[*_#>|~]/g,'')
    .replace(/\p{Extended_Pictographic}/gu,'')
    .replace(/\be\.g\./gi,'for example').replace(/\bi\.e\./gi,'that is').replace(/\betc\./gi,'et cetera').replace(/\bvs\.?(?=\s)/gi,'versus')
    .replace(/\s*&\s*/g,' and ')
    .replace(/(\d)\s*°\s*C\b/g,'$1 degrees Celsius').replace(/(\d)\s*°\s*F\b/g,'$1 degrees Fahrenheit').replace(/°/g,' degrees')
    .replace(/(\d)\s*(km|mi|kg|lbs?|mph|kph|ft|cm|mm|ml|oz|k?hz|ms|mb|gb)\b/gi,(m,n,u)=>n+' '+SAY_UNITS[u.toLowerCase()])
    .replace(/\b0x([0-9a-f]+)\b/gi,(m,h)=>'zero x '+h.split('').join(' '))
    .replace(/(\d)\s*[x×]\s*(\d)/g,'$1 times $2')
    .replace(/\s+[—–-]\s+|—/g,', ')               // dashes become a breath, not "minus"
    .replace(/\s*\(([^)]{1,80})\)\s*/g,', $1, ')  // asides read as asides
    .replace(/([!?.]){2,}/g,'$1').replace(/\s*,\s*([.!?,])/g,'$1').replace(/,\s*,/g,',')
    .replace(/\s+/g,' ').trim();
}
// sentence boundaries: end punctuation followed by space/end, never inside "1.35" or after a common abbreviation
export function splitSentences(t){
  const out=[]; let start=0;
  const re=/[.!?…]+["')\]]*(?=\s|$)/g; let m;
  while((m=re.exec(t))){
    const end=m.index+m[0].length;
    if(/\b(mr|mrs|ms|dr|st|no|approx|mt|jr|sr)\.$/i.test(t.slice(Math.max(start,end-8),end))) continue;
    out.push(t.slice(start,end).trim()); start=end;
  }
  if(start<t.length&&t.slice(start).trim()) out.push(t.slice(start).trim());
  return out;
}
export function ttsSay(text){
  const t=speechText(text||'');
  if(!t) return;
  for(const p of splitSentences(t)) if(p) TTS.q.push(p);
  ttsPump();
}
const MAX_CHUNK=230; // long single utterances get cut off in Chrome around 15 s
function ttsPump(){
  if(TTS.cur) return;
  if(!TTS.q.length||!('speechSynthesis' in globalThis)){ TTS.q.length=0; ttsSettle(); return; }
  let text=TTS.q.shift();
  if(!TTS.first) while(TTS.q.length&&text.length+1+TTS.q[0].length<=MAX_CHUNK) text+=' '+TTS.q.shift();
  TTS.first=false;
  const u=new SpeechSynthesisUtterance(text);
  const v=pickVoice(); if(v){ u.voice=v; u.lang=v.lang; }
  u.rate=voicePrefs.rate; u.pitch=1;
  u.onboundary=()=>{ voice.env=1; };
  const done=()=>{ if(TTS.cur!==u) return; clearTimeout(TTS.dog); TTS.cur=null; ttsPump(); };
  u.onend=done; u.onerror=done;
  const starting=!voice.speaking;
  recent.push({text,at:Date.now()});
  TTS.cur=u; voice.speaking=true; voice.env=1; setAState('speaking');
  if(starting) speechEvents.onStart?.();
  TTS.dog=setTimeout(done,(5000+text.length*95)/voicePrefs.rate);
  try{
    if(speechSynthesis.paused) speechSynthesis.resume(); // Chrome can get stuck paused
    speechSynthesis.speak(u);
  }catch(e){ done(); }
}
function ttsSettle(){
  if(TTS.cur||TTS.q.length) return;
  const was=voice.speaking;
  voice.speaking=false; TTS.first=true;
  if(was) speechEvents.onIdle?.();
  if(store.get().aState==='speaking') setAState('');
  const w=TTS.waiters; TTS.waiters=[]; w.forEach(f=>f());
}
export function ttsCancel(){
  TTS.q.length=0; TTS.cur=null; clearTimeout(TTS.dog);
  try{ speechSynthesis.cancel(); }catch(e){ /* nothing to cancel */ }
  ttsSettle();
}
export function ttsIdle(){ return (TTS.cur||TTS.q.length)?new Promise(r=>TTS.waiters.push(r)):Promise.resolve(); }
