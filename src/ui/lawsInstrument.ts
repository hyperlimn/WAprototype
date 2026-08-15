import { LAW_PARAMETER_REGISTRY } from "../simulation/lawParameters";
import type { Universe } from "../simulation/universe";

const escape = (value:string):string => value.replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]!));
const row=(label:string,value:string)=>`<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;

export function updateLawsInstrument(element:HTMLElement,universe:Universe):void{
  const evolution=universe.lawEvolution, manifest=evolution.activeManifest, latest=evolution.records.at(-1);
  const selectedId=element.dataset.selectedLawId&&evolution.records.some(record=>record.id===element.dataset.selectedLawId)?element.dataset.selectedLawId:latest?.id;
  const selected=evolution.records.find(record=>record.id===selectedId);
  element.innerHTML=[row("Current epoch",String(evolution.completedEpoch)),row("Next boundary",`${(evolution.completedEpoch+1)*evolution.epochInterval} ticks`),row("Evolved laws",String(evolution.records.length)),
    ...LAW_PARAMETER_REGISTRY.map(parameter=>row(parameter.description,manifest.effectiveParameters[parameter.id].toPrecision(7))),
    ...(selected?[`<label class="law-history-select">Law history<select>${evolution.records.map(record=>`<option value="${escape(record.id)}"${record.id===selected.id?" selected":""}>${escape(record.id)}</option>`).join("")}</select></label>`,row("Born",`tick ${selected.bornAtTick}`),row("Genome",`${selected.genome.operation} ${selected.genome.polarity>0?"+":"−"}${selected.genome.magnitude.toPrecision(5)}`),row("Evolution hash",selected.evolutionHash),row("Parameter",selected.targetParameter),row("Change",`${selected.priorValue} → ${selected.resultingValue}`)]:[row("Law history","No evolved laws yet")])].join("");
  element.querySelector("select")?.addEventListener("change",event=>{element.dataset.selectedLawId=(event.currentTarget as HTMLSelectElement).value;updateLawsInstrument(element,universe);});
}
