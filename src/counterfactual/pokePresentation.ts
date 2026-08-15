import { COUNTERFACTUAL_IMPULSE_PRESETS } from "./intervention";

export const COUNTERFACTUAL_POKE_MULTIPLIERS=[1,2,5,10,20] as const;
export type CounterfactualPokeMultiplier=typeof COUNTERFACTUAL_POKE_MULTIPLIERS[number];
export const COUNTERFACTUAL_POKE_MULTIPLIER_STORAGE_KEY="protouniverse.counterfactual.poke-multiplier.1";
export function validatePokeMultiplier(value:unknown):CounterfactualPokeMultiplier{const parsed=Number(value);return COUNTERFACTUAL_POKE_MULTIPLIERS.includes(parsed as CounterfactualPokeMultiplier)?parsed as CounterfactualPokeMultiplier:1;}
export function effectiveImpulse(base:number,multiplier:CounterfactualPokeMultiplier):number{if(!Number.isFinite(base)||base<=0)throw new Error("Base impulse must be finite and positive");return base*multiplier;}
export function effectiveImpulseText(label:string,base:number,multiplier:CounterfactualPokeMultiplier):string{const effective=effectiveImpulse(base,multiplier);return`${label} ${base.toFixed(3)} × ${multiplier}\nEffective impulse: ${effective.toFixed(3)} world-units/tick`;}
export const MAXIMUM_PRESET_EFFECTIVE_IMPULSE=COUNTERFACTUAL_IMPULSE_PRESETS.strong*20;
