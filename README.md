# Universe 0

Universe 0 is a small deterministic generative-system prototype. Each entity possesses an immutable 64-character hexadecimal fingerprint containing latent numerical potential. Only three regions are decoded as entity traits: characters 1–4 as `alpha`, 5–8 as `beta`, and 9–12 as `gamma`. Some otherwise latent regions may participate in creation conditions without becoming personality-like traits.

The universe's laws determine how those variables interact. Interactions change the global world state, and the global world state feeds back into the laws. Therefore, the meaning and consequence of an immutable fingerprint depends partly upon the evolving universe in which it exists.

The prototype investigates whether complex or unexpected structures can emerge from very small rule sets. It intentionally contains no goals, authored categories, predefined clusters, or decorative randomness.

## Run

```sh
npm install
npm run dev
```

Create a production build with `npm run build`, then inspect it locally with `npm run preview`.

## Controls

- Drag the canvas to pan through the larger world.
- Use the mouse wheel or trackpad to zoom from individual entities to broad structures.
- Click an entity to inspect its immutable fingerprint and mutable state.
- Adjust **Relation filter** to control which nearby relationship lines are visible.
- Pause/play, change simulation speed, restart the exact seed, or create a new seeded universe.
- A seed is stored in the URL so it can be shared and recreated.

## Architecture

- `src/simulation/` contains the renderer-independent universe, entity model, fingerprint decoding, seeded PRNG, grid spatial indexes, base physics, bond memory, relationship-entity lifecycle, dimensional state, relationship field, higher-order physics, and global measurements.
- `src/rendering/` contains the Canvas renderer and pan/zoom camera.
- `src/ui/` contains DOM controls, instruments, and entity inspection.

Simulation updates use fixed timesteps. Fingerprints, initial positions, velocities, progressive arrivals, and births use only deterministic seeded or hash-derived values. A simulation-version prefix participates in the PRNG seed, so a seed's meaning can be tied to a particular law set. Browser frame rate affects how quickly fixed steps are processed, not their numeric result.

## Current laws

For nearby entities `A` and `B`:

```text
difference   = (|A.alpha-B.alpha| + |A.beta-B.beta| + |A.gamma-B.gamma|) / 3
relationship = 1 - difference
polarity     = relationship - worldAlpha
preferred    = 20 + 70 × mean(A.alpha, A.beta, A.gamma, B.alpha, B.beta, B.gamma)
falloff      = 1 - distance / interactionRadius
radial       = polarity > 0 ? tanh((distance - preferred) / 18) : 1
force        = baseForce × feedback × polarity × radial × falloff × (1 + 0.55 × bond)
```

Positive-polarity pairs attract outside their deterministic preferred spacing and repel inside it, with force approaching zero at that spacing. Negative polarity remains repulsive. The feedback coefficient rises subtly with average world speed. Bonds accumulate slowly while pairs remain within bonding distance, decay while separated, and reinforce the direction of later interaction without overriding the preferred spacing.

## First higher-order layer

A bond becomes a relationship entity after remaining at or above `0.22` for 90 consecutive ticks. An existing relationship entity remains alive until its bond falls below `0.08`. At tick zero there are no relationship entities and therefore no higher-order forces.

Relationship identity uses canonical lexicographic parent-fingerprint order. The string `lowerFingerprint:higherFingerprint` is passed through eight independently salted FNV-1a 32-bit streams and their eight-character hexadecimal outputs are concatenated into a deterministic 64-character relationship fingerprint.

Distance stability is `1 - EMA`, where the EMA uses `0.95 × previous + 0.05 × min(1, |distance - previousDistance| / 2)`. Coherence is:

```text
coherence = 0.45 × bondStrength
          + 0.35 × relationshipStrength
          + 0.20 × distanceStability
```

Nearby, disjoint relationship entities interact within 320 world units. Compatibility uses the mean normalized hexadecimal-digit distance over the first 16 characters of their relationship fingerprints:

```text
compatibility = 1
              - 0.60 × fingerprintDigitDistance
              - 0.40 × |coherenceA - coherenceB|

higherOrderForce = 0.000035
                 × (compatibility - 0.58)
                 × radialResponse
                 × (1 - distance / 320)
                 × coherenceA × coherenceB
                 × influenceMultiplier
                 × synergyMultiplier

preferredDistance = 70 + 150 × (segmentA + segmentB) / 2
segmentX = hexToNumber(relationshipFingerprintX[1..4]) / 65535

radialResponse = compatibility > 0.58
               ? tanh((distance - preferredDistance) / 42)
               : 1
```

Compatible relationship pairs attract outside their deterministic 70–220 unit preferred spacing and repel inside it, with radial force approaching zero at equilibrium. Incompatible pairs remain directly repulsive. The resulting radial acceleration is added equally to both parents of one relationship and oppositely to both parents of the other. This moves relationship centers while adding no direct differential force within either parent pair. Relationship entities sharing a parent are excluded at this first level to avoid applying contradictory center translations to a shared base entity.

## Dimensional duration

Simulation version `u0.2` gives each relationship entity exactly two immutable durations. Both are measured from its creation tick and use previously uninterpreted relationship-fingerprint regions:

```text
spatialNormalized   = hexToNumber(fingerprint[17..20]) / 65535
influenceNormalized = hexToNumber(fingerprint[21..24]) / 65535

spatialDuration   = round(4000 + 16000 × spatialNormalized)
influenceDuration = round(8000 + 32000 × influenceNormalized)
```

Thus spatial duration is 4,000–20,000 ticks and influence duration is 8,000–40,000 ticks. `spatialActive` and `influenceActive` are independently determined by `age < duration`. A spatially expired entity is excluded from higher-order pair forces and spatial rendering, but may remain an influence source. An entity inactive in both dimensions is retained as a compact dormant record while its base bond remains viable; this prevents the same persistent bond from recreating it with a reset age. Existing bond destruction still removes it normally.

Influence-active entities produce a bounded, non-directional magnitude modulation for spatial entities within 420 units:

```text
sourceContribution = 0.012 × sourceCoherence × (1 - distance / 420)
influenceField      = sum(sourceContribution)
influenceMultiplier = 1 + min(0.06, influenceField)
```

The two interacting entities' influence multipliers are averaged in the higher-order force equation. The field does not push directly and cannot change the sign or equilibrium zero of the existing force.

Local relationship density is the number of spatially active relationship entities within 320 units. Dual-active entities receive:

```text
boundedDensity    = localDensity / (localDensity + 4)
synergy           = coherence × boundedDensity
synergyMultiplier = 1 + 0.08 × (synergyA + synergyB) / 2
```

Synergy is zero unless an entity is active in both dimensions. It only scales existing higher-order interaction magnitude and therefore injects no independent force.

## Emergent relationship field

Simulation version `u0.3` adds a scalar field generated only by existing, non-dormant relationship entities. Dimensional source factors are `1.0` for dual-active, `0.8` for spatial-only, `0.65` for influence-only, and `0` for dormant entities:

```text
sourceStrength = coherence × bondStrength × dimensionalFactor
```

Sources superpose independently. There is no density, geometry, or recognized-structure term. For softening `ε = 60`, support radius `R = 800`, distance `r`, and smooth support window `w = (1 - r/R)²`, each source contributes for `r < R`:

```text
potentialContribution = sourceStrength × w / sqrt(r² + ε²)
totalPotential        = sum(potentialContribution)
```

The support window reaches zero smoothly at 800 units and permits a spatial-grid lookup without a hard potential edge. The analytic gradient points toward each source. With `q = sqrt(r² + ε²)` its magnitude contribution is:

```text
gradientContribution = sourceStrength
                     × [r × w / q³ + 2 × (1 - r/R) / (R × q)]

fieldAcceleration = 0.004 × totalGradient
```

A spatial relationship excludes its own source by deterministic relationship ID when sampling. Field acceleration is applied equally to both of its base parents, translating the center without directly changing their internal separation. Field rendering samples the same scalar potential on a low-resolution screen grid and has no effect on simulation state.

## Deterministic reproduction and arrival

Simulation version `u0.4` begins with 20 base entities. One entity from the continuing seeded PRNG sequence arrives every 1,000 ticks until initial entities plus external arrivals total 300. Initial entities, external arrivals, and reproduction births carry diagnostic origin metadata that does not enter the laws.

A viable relationship may reproduce when its age and coherence clear values derived from relationship-fingerprint characters 29–36, its cooldown from characters 37–40 has elapsed, and the mean of parent characters 13–16 plus relationship characters 25–28 is at least `0.82`. Minimum age spans 8,000–32,000 ticks, coherence threshold spans 0.68–0.88, and cooldown spans 30,000–100,000 ticks.

Eligible relationships are processed in stable relationship-ID order. A child's fingerprint is synchronous SHA-256 over canonical parent fingerprints, relationship fingerprint, zero-based relationship event index, tick, and a quantized world-state signature. Child characters 13–20 set an 8–24 unit offset from the relationship midpoint; characters 21–28 add a 0.002–0.010 velocity offset to mean parent velocity. Children then follow the ordinary base laws. Total base population is capped at 1,000; no entity is removed to create capacity.

## Observation Mode

Observation Mode is a renderer-only diagnostic layer. It gives external arrivals a square outline, reproduction-born entities a diamond outline, and leaves initial entities as the native point. Simulation-tick-based traces mark arrivals, births, relationship formation/destruction, and dimensional transitions for 10,000 ticks. Birth traces connect both current parent positions to the child. Dormant relationships appear as subdued crosses while relationship observation is enabled.

The Occurrences panel retains the latest 200 deterministic lifecycle records in newest-first display order. Observation visibility filters affect drawing and picking only; they are never passed into simulation updates and cannot affect evolution.

## Useful observations before changing the laws

## Machine interface

The simulation is authoritative. Interfaces observe it.

Anything meaningfully observable by the human interface should have a machine-readable equivalent. Rendering, human controls, HTTP/GPT clients, and future interfaces consume the canonical browser world model; the localhost bridge is only a volatile observation cache and never steps or reconstructs the universe.

Run `npm.cmd run dev` to start Vite and the bridge together, or `npm.cmd run dev:app` and `npm.cmd run dev:bridge` separately. The bridge binds to `127.0.0.1:8787` by default. Explicit future configuration may change `PROTOUNIVERSE_BRIDGE_HOST` and `PROTOUNIVERSE_BRIDGE_PORT`; no remote exposure happens automatically.

The browser publishes a heartbeat every 1 second, a canonical snapshot every 5 seconds, and newly observed occurrences in bounded batches. These are wall-clock observation timers only. The bridge retains at most 1,000 events in memory and exposes read-only `/api`, `/api/status`, `/api/state`, `/api/events`, `/api/entity/:id`, and `/api/relationship/:id` routes under interface schema `protouniverse-machine-interface/1`.

- Distribution and lifetime of bonds, not just the active count.
- Relationship values within persistent groups compared with the population baseline.
- Local-density distribution and whether its variance grows over time.
- Radial dispersion and mean pair distance across equal-duration seed runs.
- Velocity autocorrelation and the time required for a seed to settle or disperse.
- Whether structures survive pause/restart comparisons at identical tick counts.
