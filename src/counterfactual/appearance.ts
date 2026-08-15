export interface CounterfactualAppearance {
  preset:"ember"|"red"|"orange"|"violet"|"custom";
  hue:number; saturation:number; lightness:number; overlayOpacity:number;
  entitySize:number; relationshipWeight:number; relationshipOpacity:number;
  connectorOpacity:number; haloIntensity:number; trailOpacity:number;
  trailWeight:number; trailSamples:number; trailsEnabled:boolean;
}
export const COUNTERFACTUAL_APPEARANCE_STORAGE_KEY="protouniverse.counterfactual.appearance.1";
export const COUNTERFACTUAL_APPEARANCE_PRESETS:Record<Exclude<CounterfactualAppearance["preset"],"custom">,Pick<CounterfactualAppearance,"hue"|"saturation"|"lightness">>={
  ember:{hue:18,saturation:52,lightness:57},red:{hue:2,saturation:54,lightness:57},orange:{hue:31,saturation:58,lightness:57},violet:{hue:278,saturation:42,lightness:61},
};
export const DEFAULT_COUNTERFACTUAL_APPEARANCE:CounterfactualAppearance={preset:"ember",...COUNTERFACTUAL_APPEARANCE_PRESETS.ember,overlayOpacity:.5,entitySize:.95,relationshipWeight:.8,relationshipOpacity:.38,connectorOpacity:.34,haloIntensity:.18,trailOpacity:.28,trailWeight:.65,trailSamples:10,trailsEnabled:true};
const bounded=(value:unknown,min:number,max:number,fallback:number)=>typeof value==="number"&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
export function validateCounterfactualAppearance(value:unknown):CounterfactualAppearance{
  const input=value&&typeof value==="object"?value as Partial<CounterfactualAppearance>:{},fallback=DEFAULT_COUNTERFACTUAL_APPEARANCE,preset=["ember","red","orange","violet","custom"].includes(String(input.preset))?input.preset!:fallback.preset;
  return{preset,hue:bounded(input.hue,0,359,fallback.hue),saturation:bounded(input.saturation,10,90,fallback.saturation),lightness:bounded(input.lightness,25,80,fallback.lightness),overlayOpacity:bounded(input.overlayOpacity,0,1,fallback.overlayOpacity),entitySize:bounded(input.entitySize,.5,2,fallback.entitySize),relationshipWeight:bounded(input.relationshipWeight,.25,3,fallback.relationshipWeight),relationshipOpacity:bounded(input.relationshipOpacity,0,1,fallback.relationshipOpacity),connectorOpacity:bounded(input.connectorOpacity,0,1,fallback.connectorOpacity),haloIntensity:bounded(input.haloIntensity,0,1,fallback.haloIntensity),trailOpacity:bounded(input.trailOpacity,0,1,fallback.trailOpacity),trailWeight:bounded(input.trailWeight,.25,3,fallback.trailWeight),trailSamples:Math.round(bounded(input.trailSamples,2,32,fallback.trailSamples)),trailsEnabled:typeof input.trailsEnabled==="boolean"?input.trailsEnabled:fallback.trailsEnabled};
}
