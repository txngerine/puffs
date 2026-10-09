// Eve's brain: fast, local intent rules that run entirely in the browser. No AI service is involved.
import { setPaused, setSeed, reseed, setBoost, hex, num, pick, getState, toMic, audioOff, startCapture, recording, cancelCapture, snapshot, openFilePicker } from '../engine/engine.js';
import { addTimer, cancelTimers, timerStatus } from './timers.js';
import { ttsCancel, setRate, cycleVoice, voiceLabel, pickVoice, getVoicePrefs } from './speech.js';
import { store } from '../lib/store.js';
import { parseMessage, parseSaveContact, parseOpenApp, messageFlow, resolveMessage, saveContact, openApp, isAutoSendRequest, enableAutoSend } from './device.js';

let lastCmd=null;

const SMALL={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
const MULT={hundred:100,thousand:1000,million:1e6};
const NUMWORD=new RegExp('\\b(?:'+Object.keys(SMALL).concat(Object.keys(MULT)).join('|')+')(?:[\\s-]+(?:and[\\s-]+)?(?:'+Object.keys(SMALL).concat(Object.keys(MULT)).join('|')+'))*\\b','g');
function wordsToNumbers(s){
  return s.replace(NUMWORD,m=>{
    let total=0,cur=0;
    for(const w of m.split(/[\s-]+/)){
      if(w==='and') continue;
      if(w in SMALL) cur+=SMALL[w];
      else if(w==='hundred') cur=(cur||1)*100;
      else { total+=(cur||1)*MULT[w]; cur=0; }
    }
    return String(total+cur);
  });
}
export function normalize(raw){
  let s=raw.toLowerCase()
    .replace(/×/g,' times ').replace(/÷/g,' divided by ').replace(/[−–]/g,'-')
    .replace(/(\d),(?=\d{3}\b)/g,'$1')
    .replace(/['’]/g,'')
    .replace(/[^a-z0-9+\-*/%.:()^ ]/g,' ')
    .replace(/\s+/g,' ').trim();
  return wordsToNumbers(s);
}
// Arithmetic without eval (the page's Content-Security-Policy forbids it):
// numbers, + - * / ** and parentheses, with the usual precedence.
export function evalArith(src){
  const toks=src.match(/\*\*|\d+(?:\.\d+)?|\.\d+|[-+*/()]/g)||[];
  if(toks.join('')!==src.replace(/\s+/g,'')) throw new Error('bad token');
  let i=0;
  const peek=()=>toks[i], next=()=>toks[i++];
  function expr(){ let v=term(); while(peek()==='+'||peek()==='-') v=next()==='+'?v+term():v-term(); return v; }
  function term(){ let v=power(); while(peek()==='*'||peek()==='/') v=next()==='*'?v*power():v/power(); return v; }
  function power(){ const b=unary(); return peek()==='**'?(next(),b**power()):b; }  // right-associative
  function unary(){ if(peek()==='-'){ next(); return -unary(); } if(peek()==='+'){ next(); return unary(); } return atom(); }
  function atom(){
    const t=next();
    if(t==='('){ const v=expr(); if(next()!==')') throw new Error('missing )'); return v; }
    if(t!==undefined&&/^[\d.]/.test(t)) return parseFloat(t);
    throw new Error('unexpected '+t);
  }
  const v=expr();
  if(i!==toks.length) throw new Error('trailing input');
  return v;
}
function mathOf(t){
  let s=' '+t+' ';
  const sq=t.match(/^(?:what is |whats )?(?:the )?square root of\s*(\d+(?:\.\d+)?)$/);
  if(sq) return {expr:'sqrt '+sq[1],v:Math.sqrt(+sq[1]),direct:true};
  s=s.replace(/square root of\s*(\d+(?:\.\d+)?)/g,(m,a)=>' '+Math.sqrt(+a)+' ')
     .replace(/(\d+(?:\.\d+)?)\s*(?:percent|%)\s*of\s*(\d+(?:\.\d+)?)/g,'($1/100*$2)')
     .replace(/\bsquared\b/g,'**2').replace(/\bcubed\b/g,'**3')
     .replace(/\b(?:to the power of|raised to(?: the power of)?)\b|\^/g,'**')
     .replace(/\bplus\b/g,'+').replace(/\bminus\b/g,'-')
     .replace(/\b(?:times|multiplied by|x)\b/g,'*')
     .replace(/\b(?:divided by|over)\b/g,'/');
  const cands=s.match(/-?[\d(.][\d\s.+\-*/()]*[\d)]/g)||[];
  for(const c of cands.sort((a,b)=>b.length-a.length)){
    if(!/[\d)]\s*(?:\*\*|[+\-*/])\s*[(-]*\s*[\d.(]/.test(c)) continue;
    let depth=0, ok=true;
    for(const ch of c){ if(ch==='(')depth++; else if(ch===')'&&--depth<0){ ok=false; break; } }
    if(!ok||depth) continue;
    try{
      const v=evalArith(c);
      if(typeof v==='number'&&isFinite(v)) return {expr:c.trim(),v};
      if(typeof v==='number') return {expr:c.trim(),v:NaN};
    }catch(e){ /* not a valid expression; try the next candidate */ }
  }
  return null;
}
const UNITS={
  km:['len',1000],kilometer:['len',1000],kilometre:['len',1000],m:['len',1],meter:['len',1],metre:['len',1],
  cm:['len',0.01],centimeter:['len',0.01],centimetre:['len',0.01],mm:['len',0.001],millimeter:['len',0.001],
  mi:['len',1609.344],mile:['len',1609.344],ft:['len',0.3048],foot:['len',0.3048],feet:['len',0.3048],
  inch:['len',0.0254],inche:['len',0.0254],yard:['len',0.9144],yd:['len',0.9144],
  kg:['mass',1],kilo:['mass',1],kilogram:['mass',1],g:['mass',0.001],gram:['mass',0.001],
  lb:['mass',0.45359237],lbs:['mass',0.45359237],pound:['mass',0.45359237],oz:['mass',0.028349523125],ounce:['mass',0.028349523125],stone:['mass',6.35029318],
  l:['vol',1],liter:['vol',1],litre:['vol',1],ml:['vol',0.001],milliliter:['vol',0.001],millilitre:['vol',0.001],
  gallon:['vol',3.785411784],cup:['vol',0.2365882365],pint:['vol',0.473176473],
  mph:['speed',0.44704],kph:['speed',1/3.6],kmh:['speed',1/3.6],
  c:['temp','c'],celsius:['temp','c'],centigrade:['temp','c'],f:['temp','f'],fahrenheit:['temp','f'],kelvin:['temp','k']
};
function unitOf(w){
  if(!w) return null;
  if(UNITS[w]) return UNITS[w];
  if(w.endsWith('s')&&UNITS[w.slice(0,-1)]) return UNITS[w.slice(0,-1)];
  return null;
}
export function convert(t){
  const s=t.replace(/\bdegrees?\b/g,' ').replace(/\bkm h\b|\bkm per hour\b|\bkilometers per hour\b/g,'kph').replace(/\bmiles per hour\b/g,'mph').replace(/\s+/g,' ');
  let m=s.match(/(-?\d+(?:\.\d+)?)\s*([a-z]+)\s+(?:in|to|into|as)\s+([a-z]+)/), v,a,b,an,bn;
  if(m){ v=+m[1]; an=m[2]; bn=m[3]; }
  else{
    m=s.match(/how many ([a-z]+) (?:are |is )?(?:in |there in )?(-?\d+(?:\.\d+)?)\s*([a-z]+)/);
    if(!m) return null;
    v=+m[2]; an=m[3]; bn=m[1];
  }
  a=unitOf(an); b=unitOf(bn);
  if(!a||!b||a[0]!==b[0]) return null;
  let r;
  if(a[0]==='temp'){
    const c=a[1]==='c'?v:a[1]==='f'?(v-32)*5/9:v-273.15;
    r=b[1]==='c'?c:b[1]==='f'?c*9/5+32:c+273.15;
  }else r=v*a[1]/b[1];
  const nm=(u,w)=>u[0]==='temp'?{c:'degrees Celsius',f:'degrees Fahrenheit',k:'kelvin'}[u[1]]:w;
  return num(v)+' '+nm(a,an)+' is '+num(r)+' '+nm(b,bn)+'.';
}
export function parseDuration(t){
  let s=0, hit=false;
  const re=/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g; let m;
  while((m=re.exec(t))){ hit=true; const u=m[2][0]; s+=(+m[1])*(u==='h'?3600:u==='m'?60:1); }
  if(/\bhalf an hour\b/.test(t)){ s+=1800; hit=true; }
  else if(/\ban hour\b/.test(t)){ s+=3600; hit=true; }
  if(/\ba minute\b/.test(t)){ s+=60; hit=true; }
  if(/\band a half\b/.test(t)&&hit){
    const unit=/hour/.test(t)?3600:/minute/.test(t)?60:0; s+=unit/2;
  }
  return hit?s:0;
}
const JOKES=[
  "Why don't scientists trust atoms? Because they make up everything.",
  "I told my computer I needed a break. It said, no problem, I'll go to sleep.",
  "Why did the scarecrow win an award? He was outstanding in his field.",
  "I asked my calendar for a joke. It said, sorry, I'm fully booked.",
  'A sine wave walks into a bar. The bartender says, why the long period?',
];
let jokeIx=0;
// "Good morning" before noon, "Good afternoon" until five, "Good evening" until ten, then a plain hello
export function timeGreeting(now=new Date()){
  const h=now.getHours();
  return h>=5&&h<12?'Good morning':h>=12&&h<17?'Good afternoon':h>=17&&h<22?'Good evening':pick('Hello','Hi there');
}
// ctx: { lastReply, assistantOn, toggleAssistant, setMemory, saveComposition, openHelp }
export function helpText(){
  return 'I can set timers, do maths and unit conversions, tell you the time and date, flip a coin or roll dice, remember things you tell me, open apps and send WhatsApp messages. I can also control the visual: pause, play, record, screenshot, reseed, louder, quieter, microphone, or load a file.';
}

// Answers a follow-up offline (e.g. "five minutes" after "For how long?", or "yes" after "Send it?").
// Returns { r } or { task } like brain(), or null when the answer is about something else.
export function resolvePending(pending,raw,ctx={}){
  if(pending?.intent==='whatsapp') return resolveMessage(pending.msg,raw,ctx);
  if(pending?.intent!=='timer_set') return null;
  const t=normalize(raw);
  let sec=parseDuration(t);
  const bare=t.match(/^(?:about |maybe |like )?(\d+(?:\.\d+)?)(?: please)?$/);
  if(!sec&&bare) sec=+bare[1]*60; // a bare number after "for how long?" means minutes
  return sec?{r:addTimer(sec,pending.label||'',pending.prep)}:null;
}

export function brain(raw,ctx={}){
  const {seed,source,particles,ringCount}=getState();
  const mem=store.get().memory;
  const t=normalize(raw);
  const is=re=>re.test(t);
  const now=new Date();
  const R=(r,kind,extra)=>Object.assign({r,kind:kind||'cmd'},extra||{});

  if(!t) return null;
  if(is(/\b(stop talking|be quiet|shut up|silence|hush|never ?mind|cancel that)\b/)){ ttsCancel(); return R(null); }

  // messages and apps on this computer (before timers and memory: the message text can be anything)
  if(isAutoSendRequest(raw)) return R(undefined,'cmd',{task:enableAutoSend});
  const contact=parseSaveContact(raw);
  if(contact){ saveContact(ctx,contact.name,contact.phone); return R('Saved. I can message '+contact.name+' on WhatsApp now.'); }
  const msg=parseMessage(raw);
  if(msg) return R(undefined,'cmd',{task:()=>messageFlow(msg)});

  // timers
  if(is(/\b(cancel|stop|clear|delete|remove) (the |my |all |all the )?timers?\b/)) return R(cancelTimers());
  if(is(/\bhow (much )?(long|time) (is )?(left|remaining)\b|\btimers? status\b|\bany timers\b/)) return R(timerStatus());
  if(is(/\btimer\b|\bremind me in\b|\bcount ?down\b|\bwake me in\b/)){
    const sec=parseDuration(t);
    const lm=t.match(/\b(to|for|called|named|labelled|labeled)\s+(?!\d)([a-z][a-z ]{1,38})$/);
    const ok=lm&&!/\b(hours?|minutes?|seconds?|mins?|secs?)\b/.test(lm[2]);
    const label=ok?lm[2]:'', prep=ok&&lm[1]==='to'?'to':'for';
    // Siri-style: ask for the missing duration and keep the request open for the answer
    if(!sec) return R('Sure. For how long?','cmd',{pending:{intent:'timer_set',question:'For how long?',label,prep}});
    return R(addTimer(sec,label,prep));
  }

  // maths and conversions
  const conv=convert(t);
  if(conv) return R(conv);
  const mt=mathOf(t);
  if(mt&&(mt.direct||is(/\b(what|whats|how much|calculate|compute|equals?|is)\b|=/)||mt.expr.replace(/\s/g,'').length>=t.replace(/\s/g,'').length*0.6)){
    return R(isFinite(mt.v)?num(mt.v)+'.':"That one doesn't have an answer. Dividing by zero, maybe?");
  }

  // clock and calendar
  if(is(/\bwhat time\b|\bthe time\b|\btime is it\b/))
    return R(pick("It's ","It's just about ","Right now it's ")+now.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+'.');
  if(is(/\b(what|which) (day|date)\b|\btodays date\b|\bthe date\b|\bdate today\b/)){
    const d=new Date(now);
    let when='Today is ';
    if(is(/\btomorrow\b/)){ d.setDate(d.getDate()+1); when='Tomorrow is '; }
    else if(is(/\byesterday\b/)){ d.setDate(d.getDate()-1); when='Yesterday was '; }
    return R(when+d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'})+'.');
  }

  // chance
  if(is(/\b(flip|toss) (a )?coin\b|\bheads or tails\b/)) return R(Math.random()<0.5?'Heads.':'Tails.');
  let m=t.match(/\broll\b.*?\b(?:(\d+) )?(?:dice|die|d(\d+))\b/);
  if(m){
    const n=Math.min(10,+(m[1]||1)), sides=+(m[2]||6); let sum=0; const rolls=[];
    for(let i=0;i<n;i++){ const r=1+Math.floor(Math.random()*sides); rolls.push(r); sum+=r; }
    return R(n>1?'You rolled '+rolls.join(', ')+'. Total '+sum+'.':'You rolled '+(/^(8|11|18)$/.test(String(sum))?'an ':'a ')+sum+'.');
  }
  if(is(/\brandom number\b|\bpick a number\b/)){
    m=t.match(/(-?\d+)\D+?(-?\d+)/);
    let lo=1,hi=100; if(m){ lo=Math.min(+m[1],+m[2]); hi=Math.max(+m[1],+m[2]); }
    return R(String(lo+Math.floor(Math.random()*(hi-lo+1)))+'.');
  }

  // memory
  m=t.match(/^(?:my name is|call me|i am called|im called) ([a-z][a-z ]{0,30})$/);
  if(m){ const name=m[1].replace(/\b[a-z]/g,c=>c.toUpperCase()); ctx.setMemory?.({name}); return R('Nice to meet you, '+name+'.'); }
  if(is(/\bwhat is my name\b|\bwhats my name\b|\bwho am i\b/))
    return R(mem.name?'You are '+mem.name+'.':"You haven't told me. Say my name is, then your name.");
  m=t.match(/^(?:please )?remember (?:that )?(.{3,160})$/);
  if(m){ ctx.setMemory?.({facts:[...mem.facts,m[1]].slice(-30)}); return R(pick("Got it. I'll remember that.","Noted. I won't forget.","Okay, I'll keep that in mind.")); }
  if(is(/\bwhat do you (remember|know about me)\b/)){
    if(!mem.facts.length&&!mem.name) return R("Nothing yet. Say remember that, and then whatever you like.");
    return R((mem.name?'Your name is '+mem.name+'. ':'')+(mem.facts.length?'You told me: '+mem.facts.slice(-5).join('; ')+'.':''));
  }
  if(is(/\bforget (everything|all|it all|about me)\b/)){ ctx.setMemory?.(null); return R('Done. My memory is empty.'); }

  if(/^(say that again|repeat( that)?|what did you say|come again|pardon)\b/.test(t))
    return R(ctx.lastReply||"I haven't said anything yet.");

  // the voice itself
  if(is(/\b(speak|talk) (a bit |a little |much )?(faster|quicker)\b|\bspeed up\b/)) return R(setRate(getVoicePrefs().rate+0.1));
  if(is(/\b(speak|talk) (a bit |a little |much )?(slower|more slowly)\b|\bslow down\b/)) return R(setRate(getVoicePrefs().rate-0.1));
  if(is(/\bnormal (speed|pace)\b/)) return R(setRate(1));
  if(is(/\b(change|switch|swap)( your| the)? voice\b|\b(different|another|next|new) voice\b/)) return R(cycleVoice());
  if(is(/\b(what|which) voice\b/)) return R("I'm using "+voiceLabel(pickVoice())+'. Say change your voice to try another.');

  if(is(/\b(turn off|disable|stop|no more) (the )?(interruptions|interrupting|barge in)\b|\bdont listen while (you )?talk/)){ ctx.setBargeIn?.(false); return R("Okay. I won't listen while I'm talking. Press escape to cut me off."); }
  if(is(/\b(turn on|enable|allow) (the )?(interruptions|interrupting|barge in)\b|\blet me interrupt\b/)){ ctx.setBargeIn?.(true); return R('Sure. Talk over me any time, or just say stop.'); }

  // wake word
  if(is(/\b(turn on|enable|use|start) (the )?(wake word|hey eve)\b|\bwait for (me to say )?hey eve\b|\b(only )?listen (for|when i say) hey eve\b/)){
    if(ctx.setWake?.(true)===false) return R("This device can't listen for a wake word. Keep using the talk button.");
    return R("Okay. I'll wait quietly until you say hey Eve.");
  }
  if(is(/\b(turn off|disable|stop|no more) (the )?(wake word|hey eve)\b|\balways listen\b|\blisten all the time\b/)){ ctx.setWake?.(false); return R("Okay. While I'm on, I'll listen all the time. Press V to turn me off."); }
  if(ctx.wake&&is(/^(go to sleep|sleep|stop listening|never ?mind|thats all|nothing)( thanks| thank you)?( eve)?$/))
    return R('Okay.','cmd',{after:()=>ctx.doze?.()});

  // the visual
  if(is(/\b(load|open|choose|play|pick|use) (a |an |some |my )?(audio )?(file|song|track|music)\b/)) return R(openFilePicker());
  if(is(/\b(audio off|turn off (the )?(mic|microphone|audio|sound|music)|stop (the )?(mic|music|song|audio)|synthetic( beat)?)\b/)){ audioOff(); return R('Audio off. The synthetic beat is driving the rings.'); }
  if(is(/\b(microphone|use the mic|turn on the mic|mic on|listen to me|my voice)\b/)){
    toMic(); return R('Listening to your microphone. Your voice drives the rings.');
  }
  if(is(/\bwhat (are you|is) (listening|hearing|playing)\b|\b(audio|sound) source\b/))
    return R({mic:'Your microphone.',file:'The audio file you loaded.',synth:'My own synthetic beat. Nothing external.'}[source]);
  if(is(/\b(stop|cancel) (the )?recording\b/)){
    if(!recording()) return R('Nothing is recording.');
    cancelCapture('recording cancelled'); return R('Recording cancelled.');
  }
  if(/^(please )?(record|capture)\b/.test(t)||is(/\b(record|capture) (the |a |this )?(loop|video|it)\b|\bmake a video\b|\bexport (the )?(loop|video)\b/)) return R(startCapture());
  if(is(/\b(screenshot|take a picture|snapshot|save a png|save (a |the )?(still|frame|image))\b/)){ snapshot(); return R('Saving a still frame.'); }
  if(t==='stop'||is(/\b(pause|freeze|hold the frame|stop moving|hold still)\b/)) return R(setPaused(true));
  if(/^(play|continue|go|start)( please)?$/.test(t)||is(/\b(resume|unpause|keep going|start moving|start again|play again)\b/)) return R(setPaused(false));
  m=t.match(/\b(?:set|change|use|make)? ?(?:the )?seed (?:to |at |number )?(\d+)\b/);
  if(m) return R(setSeed(+m[1]));
  if(is(/\b(reseed|random seed|new seed|change the seed|randomi[sz]e|surprise me|something new|shuffle|new composition)\b/)){ lastCmd=reseed; return R(reseed()); }
  m=t.match(/\b(?:save|keep|bookmark) (?:this|the|current)? ?(?:composition|seed|one|look)(?: as | called | named )?(.*)$/);
  if(m){ ctx.saveComposition?.(m[1].trim()); return R(pick('Saved.','Saved to your compositions.','Got it, saved.')+' Press question mark to see them.'); }
  if(is(/\b(show|list|open) (my )?(saved|compositions|favorites)\b/)){ ctx.openHelp?.(); return R('Here are your saved compositions.'); }
  if(is(/\b(what is the seed|whats the seed|current seed|which seed)\b/))
    return R('Seed is zero x '+hex(seed).replace(/^0+(?=.)/,'')+'.');
  if(is(/\b(louder|brighter|turn it up|boost|more intense|stronger|crank it)\b/)){ lastCmd=()=>setBoost(getState().boost*1.35); return R(lastCmd()); }
  if(is(/\b(quieter|dimmer|turn it down|softer|calmer|less intense|weaker)\b/)){ lastCmd=()=>setBoost(getState().boost*0.74); return R(lastCmd()); }
  if(is(/\b(normal|reset)( the)? (boost|brightness|level)\b|\bback to normal\b/)) return R(setBoost(1));
  if(lastCmd&&is(/^(more|again|even more|once more|another|do it again|one more)( please)?$/)) return R(lastCmd());
  if(is(/\bhow many particles\b|\bparticle count\b|\bcount the particles\b/)){
    return R(particles+' particles across '+ringCount+' rings.');
  }
  const app=parseOpenApp(raw);
  if(app) return R(undefined,'cmd',{task:()=>openApp(app)});
  if(/^(help|commands|options)( me)?( please)?$/.test(t)||is(/\bwhat (can|do) you do\b/))
    return R(helpText());
  if(/^(bye|goodbye|good night|see you|later|thats all)\b/.test(t))
  {
    const bye=/^good night\b/.test(t)?'Good night'+(mem.name?', '+mem.name:'')+'. Sleep well.':pick('Goodbye.','Talk to you later.','See you soon.');
    return ctx.wake?R(bye+' Say hey Eve when you need me.','cmd',{after:()=>ctx.doze?.()})
      :R(bye+' Press V when you need me.','cmd',{after:()=>{ if(ctx.assistantOn) ctx.toggleAssistant?.(); }});
  }

  // small talk
  if(/^(hi|hey|hello|yo|hiya|howdy|greetings)\b/.test(t)||is(/\bgood (morning|afternoon|evening|day)\b/))
    return R(timeGreeting(now)+(mem.name?', '+mem.name+'. ':". I'm Eve, your virtual assistant. ")+pick('How can I help?','What can I do for you?','How can I help you today?'),'chat');
  if(is(/\b(who are you|what are you|your name|are you an ai|are you a bot)\b/))
    return R("I'm Eve, your virtual assistant. I can set timers, do quick maths, tell you the time, remember things, open apps and send WhatsApp messages. Say help to hear more.",'chat');
  if(is(/\b(what is this|what am i looking at|describe|explain|how does this work)\b/))
    return R("I'm Eve, a voice assistant. Behind me, sixty four frequency bands drive about nine thousand particles that react to sound and loop every five seconds. Talk to me, or say help to see what I can do.",'chat');
  if(is(/\bhow are you\b|\bhows it going\b|\bhow are things\b/)) return R(pick("I'm doing well, thanks for asking. How can I help?","I'm great, thank you. How about you?","All good here. What can I do for you?"),'chat');
  if(is(/^(im|i am) (good|fine|great|ok|okay|well|doing well)\b/)) return R(pick('Glad to hear it. What can I do for you?','Good to hear. How can I help?'),'chat');
  if(is(/\b(joke|make me laugh|something funny)\b/)) return R(JOKES[jokeIx++%JOKES.length],'chat');
  if(is(/\b(weather|temperature outside|how hot|how cold|forecast|news)\b/))
    return R("Sorry, I can't check live information like the weather or news. I'm not connected to the internet.",'chat');
  if(is(/\b(how long is the loop|five second|the loop)\b/))
    return R('Exactly five seconds. Say record and I will hand you the whole loop as a video.','chat');
  if(is(/\b(thank|thanks|cheers)\b/)) return R(pick('Anytime.',"You're welcome.",'Happy to help.','Of course.'),'chat');
  if(is(/\bsing\b/)) return R("I'm better at helping than singing, but here goes. La la la.",'chat');
  if(is(/\bare you (real|alive|human)\b/)) return R("I'm a virtual assistant, so not quite. But I'm here whenever you need me.",'chat');
  return null;
}
