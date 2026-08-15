import { formatRegistryHelp } from "../src/operator/commandRegistry.js";
process.stdout.write(`ProtoUniverse operator commands\n\n${formatRegistryHelp()}\n`);
