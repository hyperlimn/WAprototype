import type { Renderer } from "../rendering/renderer";
import { PRIMARY_TRAIL_LIMITS, PrimaryLiveTrailRecorder } from "../rendering/liveTrails";
import type { Universe } from "../simulation/universe";

const ENABLED_KEY="protouniverse.primary-live-trails.enabled.1",LENGTH_KEY="protouniverse.primary-live-trails.samples.1";
export function bindPrimaryLiveTrails(options:{getUniverse:()=>Universe;renderer:Renderer}){
  const enabled=document.querySelector<HTMLInputElement>("#primaryLiveTrails")!,length=document.querySelector<HTMLInputElement>("#primaryTrailLength")!,lengthLabel=document.querySelector<HTMLElement>("#primaryTrailLengthLabel")!,lengthValue=document.querySelector<HTMLOutputElement>("#primaryTrailLengthValue")!,highlight=document.querySelector<HTMLButtonElement>("#highlightLiveTrail")!,stats=document.querySelector<HTMLElement>("#selectedLiveTrailStats")!;
  let selectedId:number|null=null,highlighted=false,sampleLimit:number=PRIMARY_TRAIL_LIMITS.defaultSamples,lastStatsAt=0;try{sampleLimit=Math.max(4,Math.min(64,Number(localStorage.getItem(LENGTH_KEY))||sampleLimit));}catch{/* Defaults remain. */}
  let recorder=new PrimaryLiveTrailRecorder(sampleLimit);options.renderer.primaryLiveTrails=recorder;length.value=String(sampleLimit);lengthValue.value=String(sampleLimit);
  function store():void{try{localStorage.setItem(ENABLED_KEY,String(enabled.checked));localStorage.setItem(LENGTH_KEY,String(sampleLimit));}catch{/* Presentation remains session-local. */}}
  function renderStats():void{const value=selectedId===null?null:recorder.stats(selectedId,options.getUniverse().state.ticks);highlight.hidden=selectedId===null||!recorder.enabled;highlight.disabled=!value;highlight.textContent=highlighted?"Stop Highlighting Recorded Trail":"Highlight Recorded Trail";stats.hidden=!highlighted||!value;if(value)stats.innerHTML=`<strong>Recorded Trail</strong><br>Recording began: tick ${value.startTick.toLocaleString()}<br>Current tick: ${value.currentTick.toLocaleString()}<br>Sampled points: ${value.sampledPoints}<br>Sampled path: ${value.sampledPathLength.toFixed(3)} world units<br>Displacement from first available point: ${value.displacement.toFixed(3)}<br>Sampling resolution: every ${value.samplingIntervalTicks} ticks`;}
  function setEnabled(value:boolean):void{enabled.checked=value;lengthLabel.hidden=!value;if(value)recorder.enable(options.getUniverse());else{recorder.disable();highlighted=false;options.renderer.highlightSelectedLiveTrail=false;}store();renderStats();}
  enabled.addEventListener("change",()=>setEnabled(enabled.checked));
  length.addEventListener("input",()=>{sampleLimit=Number(length.value);lengthValue.value=String(sampleLimit);const wasEnabled=recorder.enabled;recorder.disable();recorder=new PrimaryLiveTrailRecorder(sampleLimit);options.renderer.primaryLiveTrails=recorder;if(wasEnabled)recorder.enable(options.getUniverse());store();renderStats();});
  highlight.addEventListener("click",()=>{highlighted=!highlighted;options.renderer.highlightSelectedLiveTrail=highlighted;renderStats();});
  let restore=false;try{restore=localStorage.getItem(ENABLED_KEY)==="true";}catch{/* Disabled by default. */}if(restore)setEnabled(true);
  return{
    selectEntity(id:number|null){selectedId=id;if(id===null){highlighted=false;options.renderer.highlightSelectedLiveTrail=false;}renderStats();},
    sample(){recorder.sample(options.getUniverse());},
    update(){const now=performance.now();if(now-lastStatsAt>250){lastStatsAt=now;renderStats();}},
    reset(){const wasEnabled=recorder.enabled;recorder.disable();highlighted=false;options.renderer.highlightSelectedLiveTrail=false;if(wasEnabled)recorder.enable(options.getUniverse());renderStats();},
    get recorder(){return recorder;}
  };
}
