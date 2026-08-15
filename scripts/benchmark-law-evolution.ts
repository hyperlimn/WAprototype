import { performance } from "node:perf_hooks";
import { Universe } from "../src/simulation/universe.js";
const run=(label:string,universe:Universe,ticks:number)=>{const started=performance.now();for(let i=0;i<ticks;i++)universe.step();const elapsed=performance.now()-started;return{label,ticks,elapsedMs:Number(elapsed.toFixed(3)),ticksPerSecond:Number((ticks/elapsed*1000).toFixed(1))};};
run("warmup",new Universe("law-benchmark-warmup"),100);
const before=run("enabled-before-boundary",new Universe("law-benchmark"),2000),boundaryUniverse=new Universe("law-boundary-benchmark",undefined,{lawEpochInterval:2001});
run("boundary-warmup",boundaryUniverse,2000);const boundary=run("boundary",boundaryUniverse,1),post=run("post-boundary-lookup",boundaryUniverse,2000);
console.log(JSON.stringify({before,boundary,post,productionEpochInterval:500000},null,2));
