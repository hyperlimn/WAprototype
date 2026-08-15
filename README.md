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

## Intrinsic oscillation

Oscillation v1 gives every entity an intrinsic oscillator derived only from its existing 64-character fingerprint. Fingerprint slice `[12, 20)` (zero-based characters 12–19) is interpreted as an unsigned 32-bit integer `f`; `f / 0xffffffff` maps linearly to `naturalFrequency` in the inclusive range 0.25–2 cycles per 1,000 simulation ticks. Slice `[20, 28)` independently produces `p / 0xffffffff`, mapped to `phase` in the inclusive range 0–2π radians.

At authoritative simulation tick `t`, `currentOscillation = sin(phase + 2π × naturalFrequency × t / 1000)`. It is an observation derived from identity and simulation time, not stored mutable state or wall-clock animation. Oscillation v1 is not read by physics, relationships, reproduction, rupture, or other entity interactions. The human Frequency projection only varies entity radius by ±11% and lightness by ±6 points while suppressing relationship clutter; it does not imply resonance or coupling.

### Entity Close-Up

Near the 2D explorer's maximum zoom, a selected entity offers an explicit **View entity up close?** action. The close-up lazy-loads a separate Three.js examination renderer with orbit rotation and dolly controls. Returning restores the prior camera center, zoom, dimension, and fingerprint selection. The orb is an observer-scale projection of identity—not literal surface geometry in the simulation—and is never read by physics.

Morphology v2 renders a `320 × 192` indexed sphere (about 62,000 vertices and 122,000 triangles). A modular feature registry combines a dominant symmetry scaffold with radial petals, latitude rings, longitudinal ridges, polar rosettes, repeated depressions, harmonic interference, tessellated microstructure, and restrained asymmetry. Geometry is generated once per entry. A symmetry-aligned vertex pattern supplies sectors, rings, harmonic interference, restrained palette variation, and patterned emission without texture files. Existing tick-derived oscillation adds only ±0.6% radial breathing and ±8% emissive modulation.

The genome uses independent two-character (8-bit) fingerprint slices, all zero-based: `[0,2)` primary and `[2,4)` secondary symmetry from `{3,4,5,6,7,8,9,10,12}`; `[4,6)` symmetry family; `[6,8)` and `[8,10)` primary/secondary motif families; `[10,12)` amplitude; `[12,14)` frequency; `[14,16)` angular offset; `[16,18)` motif phase; `[18,20)` ring count; `[20,22)` ridge sharpness; `[22,24)` depression depth; `[24,26)` polar and `[26,28)` equatorial weighting; `[28,30)` harmonic count; `[30,32)` harmonic strength; `[32,34)` micro scale; `[34,36)` micro amplitude; `[36,38)` asymmetry (bounded to 0–0.012); `[38,40)` asymmetry phase; `[40,42)` smoothness; `[42,44)` base hue (0.45–0.62); `[44,46)` secondary hue offset; `[46,48)` saturation; `[48,50)` luminance; `[50,52)` emissive hue; `[52,54)` pattern contrast; `[54,56)` emissive intensity; `[56,58)` patterned emission; `[58,60)` material roughness; `[60,62)` metallic response; and `[62,64)` pattern phase. Families are selected from axial/radial/spiral/tessellated scaffolds and petals/rings/nodes/interlock motifs. No runtime randomness is used.

Close-Up camera presets expose that pattern language without changing geometry. **Free** retains ordinary orbit/dolly controls. Morphology is canonically parameterized around the observer-space `+Y` axis, so **Pole** looks directly along `+Y` with `+Z` as camera-up. **Equator** looks along the perpendicular direction `(cos angularOffset, 0, sin angularOffset)` with `+Y` as camera-up. The compact collapsible Morphology instrument reads the already-derived genome and connects scaffold, symmetry orders, motifs, topology amplitudes, palette, emission, and material response to the visible orb.

## Machine interface

The simulation is authoritative. Interfaces observe it.

Anything meaningfully observable by the human interface should have a machine-readable equivalent. Rendering, human controls, HTTP/GPT clients, and future interfaces consume the canonical browser world model; the localhost bridge is only a volatile observation cache and never steps or reconstructs the universe.

Run `npm.cmd run dev` to start Vite and the bridge together, or `npm.cmd run dev:app` and `npm.cmd run dev:bridge` separately. The bridge binds to `127.0.0.1:8787` by default. Explicit future configuration may change `PROTOUNIVERSE_BRIDGE_HOST` and `PROTOUNIVERSE_BRIDGE_PORT`; no remote exposure happens automatically.

The browser publishes a heartbeat every 1 second, a canonical snapshot every 5 seconds, and newly observed occurrences in bounded batches. These are wall-clock observation timers only. The bridge retains at most 1,000 recent events in RAM while the persistent memory archive records accepted occurrences independently. Current-state and historical routes use machine interface schema `protouniverse-machine-interface/4`.

### Persistent universe memory

Memory records the universe; memory does not govern the universe. The bridge writes transparent filesystem archives beneath `data/universes/<seed>/` using memory schema `protouniverse-memory/1`. Each universe has an atomic manifest, bounded append-only JSONL event segments, observational checkpoints, and optional condensed era summaries. Memory never calls simulation methods and wall-clock archive metadata never enters simulation behavior.

Complete mode is the default and retains every accepted machine-observable occurrence. Set `PROTOUNIVERSE_MEMORY_MODE=condensed` to additionally create deterministic summaries for eras older than the recent-detail window. Condensation is non-destructive: original event segments and checkpoints remain the fossil record, and every era summary names its exact source segments and checkpoint references. The universe may forget operational detail in condensed views, but the archive remains its fossil record.

Checkpoints are selected by simulation-tick boundaries, defaulting to every 25,000 ticks through `PROTOUNIVERSE_CHECKPOINT_INTERVAL_TICKS`. Because the browser publishes periodically, the stored checkpoint tick is the first observed canonical snapshot in a newly crossed interval. These checkpoints support historical inquiry only; they are not simulation resume state.

Configuration:

- `PROTOUNIVERSE_MEMORY_ROOT` — storage root, default `data`
- `PROTOUNIVERSE_MEMORY_MODE` — `complete` or `condensed`
- `PROTOUNIVERSE_EVENT_SEGMENT_SIZE` — events per JSONL segment, default 10,000
- `PROTOUNIVERSE_CHECKPOINT_INTERVAL_TICKS` — default 25,000
- `PROTOUNIVERSE_RECENT_DETAIL_TICKS` — condensed-mode full-detail window, default 100,000
- `PROTOUNIVERSE_CONDENSED_ERA_TICKS` — condensed era size, default 100,000

Historical API:

- `GET /api/universes` and `GET /api/universe/:seed` discover and orient within archived universes.
- `GET /api/history?seed&sinceTick&untilTick&type&entityId&relationshipId&limit&cursor` returns stable newest-first pages. Cursors are opaque and bound to their seed and filters.
- `GET /api/history/summary?seed&sinceTick&untilTick`
- `GET /api/history/entity/:id?seed&limit&cursor` and `GET /api/history/relationship/:id?seed&limit&cursor`
- `GET /api/checkpoints?seed&sinceTick&untilTick&limit`, `GET /api/checkpoint/:tick?seed`, and `GET /api/checkpoint/nearest/:tick?seed&direction=before|after|nearest`
- `GET /api/memory/status?seed`

When `seed` is omitted, historical routes resolve the currently active bridge universe. An explicit unknown seed returns `404` and is never replaced by another archive. Archive navigation selects history; it does not alter history.

### Machine perception

Machine perception is an instrument, not a law of the universe. Perception schema `protouniverse-perception/1` consumes cached canonical snapshots, archive events, and observational checkpoints through machine interface `protouniverse-machine-interface/5`. Authoritative fields identify their snapshot or archive source; anomaly scores, comparisons, context, similarity, and attention rankings are explicitly labeled derived or inferred with their method, baseline, and limitations.

- `GET /api/perception/orient?seed` answers what is happening and suggests where to look.
- `GET /api/perception/inspect?kind&depth&...target` inspects entities, relationships, regions, events, or checkpoints with bounded depth 1–3.
- `GET /api/perception/context?kind&...target` zooms out to geometric and connected context without inventing authoritative cluster identity.
- `GET /api/perception/changes?seed&sinceTick|checkpoint|compareSeed&tick` compares cached observations and never claims causation.
- `GET /api/perception/anomalies?seed&kind&limit&x&y&radius` uses explainable median/MAD scoring.
- `GET /api/perception/similar?seed&kind&id&limit` uses versioned normalized features; regions use `x`, `y`, and `radius` instead of `id`.
- `GET /api/perception/compare?kind&seed&compareSeed&idA&idB&tickA&tickB` compares compatible targets and warns when simulation versions differ.
- `GET /api/perception/since-last?observer&seed` reports changes since an observer bookmark.
- `POST /api/perception/mark-observed` with `{ observer, seed, tick }` writes only lightweight metadata beneath `data/observers/`.

### Observer Memory v1

Universe memory answers “what happened in this universe?” Observer memory answers “what happened between this observer and this universe?” It is a separate, provider-neutral notebook scoped by explicit observer and universe identities. Files live beneath `data/observer-memory/<observer>/universes/<encoded-universe>.json` using schema `protouniverse-observer-memory/1`; writes use atomic replacement and survive bridge or MCP restarts.

Entries may be `observation`, `investigation`, `question`, `hypothesis`, `prediction`, `revisit`, `conclusion`, or `surprise`. Every entry has an `open`, `resolved`, or `superseded` lifecycle, timestamps, revision provenance, optional tags and universe tick, and optional references to entities, relationships, events, checkpoints, regions, history queries, or stable URIs. References may be labeled `supports`, `contradicts`, `context`, or `target`.

The epistemic boundary is explicit in every entry: `authority` is `observer-authored`, `authoritativeUniverseTruth` is always `false`, and `classification` is `observer-record`. A notebook entry can reference authoritative evidence, but that does not promote its interpretation, hypothesis, prediction, question, or conclusion into universe fact.

Observer-memory HTTP faculties:

- `GET /api/observer-memory?observer&universe&kind&status&limit` recalls a notebook, with optional filters.
- `POST /api/observer-memory` creates an entry from `{ observer, universe, kind, content, universeTick?, tags?, references? }`.
- `PATCH /api/observer-memory/:id` revises or resolves an entry using `{ observer, universe, content?, status?, resolution?, references?, note? }`.
- `GET /api/perception/orient?seed&observer` includes at most five recent open investigations, questions, hypotheses, predictions, or revisit intentions under `observerContinuity`, then records that visit. Omitting `observer` remains read-only and produces the original orientation shape.

The continuity digest reports the previous visit time/tick, visit count, open inquiry count, and a compact `whereYouLeftOff` list. Use dedicated recall for the full notebook. Observer memory never writes universe archives and never changes Universe 0 behavior.

Attention suggestions transparently combine anomaly, connectivity, persistence, recent activity, and structural extremity. All analyses are bounded and reconstructable; none calls the live `Universe`, steps it, or requests a snapshot.

### MCP machine doorway

MCP is a doorway into ProtoUniverse, not the intelligence of ProtoUniverse. The local server uses MCP specification `2026-07-28`, MCP identity `protouniverse-mcp/1`, and the official TypeScript SDK v2 split packages. It serves STDIO with the v2 `serveStdio` entry so modern clients negotiate the 2026 protocol while retaining SDK-managed legacy compatibility. STDOUT is reserved exclusively for protocol messages; diagnostics go to STDERR. Start the bridge with `npm.cmd run dev:bridge`, then start MCP with:

```powershell
npm.cmd run mcp
```

The adapter exposes `orient`, `inspect`, `context`, `anomalies`, `similar`, `compare`, `changes`, `since_last`, `mark_observed`, `recall_observer_memory`, `remember`, `update_observer_memory`, `list_universes`, `history`, `checkpoints`, and `checkpoint`. Observer-memory writes and `mark_observed` are non-destructive and write observer-owned metadata only. Supplying an observer to `orient` records a notebook visit; without one it remains a pure perception read. `explore-universe` and `resume-observer` are optional navigation prompts. Structured results preserve authoritative, derived, inferred, and observer-authored labels; concise text and resource links provide compatibility and navigation.

Resources use stable URIs:

```text
protouniverse://universe/<seed>
protouniverse://universe/<seed>/entity/<id>
protouniverse://universe/<seed>/relationship/<encoded-id>
protouniverse://universe/<seed>/checkpoint/<tick>
protouniverse://universe/<seed>/event/<tick>/<sequence>
protouniverse://universe/<seed>/region/<x>/<y>/<radius>
protouniverse://observer/<observer>
```

The observer carries identity; the connection does not. Observer handles remain explicit tool arguments. Legacy since-last bookmarks survive reconnects through `data/observers/`; Observer Memory v1 notebooks survive through `data/observer-memory/`. The MCP process normally uses the localhost bridge at `http://127.0.0.1:8787`; set `PROTOUNIVERSE_BRIDGE_URL` to another localhost bridge. Archive discovery, history, checkpoints, archived orientation/inspection, and observer-memory reads/writes have direct filesystem fallback when the bridge is offline.

From this repository directory, connect local Codex with:

```powershell
codex mcp add protouniverse -- npm.cmd run mcp
```

For a location-independent command, use `npm.cmd --prefix C:\absolute\path\to\WAprototype run mcp` and set `PROTOUNIVERSE_MEMORY_ROOT` to the repository's absolute `data` directory using `codex mcp add --env`. An equivalent optional project `.codex/config.toml` entry is:

```toml
[mcp_servers.protouniverse]
command = "npm.cmd"
args = ["run", "mcp"]
```

Run the automated SDK client integration through `npm.cmd test`. To inspect interactively without adding a production dependency:

```powershell
npx.cmd @modelcontextprotocol/inspector npm.cmd run mcp
```

### Human View

The normal MCP exposes `human_view`, a read-only deterministic `rendered_view` of the current canonical snapshot. It returns an in-memory PNG plus universe, authoritative tick, dimension, and viewport metadata. Composite, Spatial, Influence, Lineage, and Frequency use the same projection and tick-derived oscillation policies as the browser renderer. Width, height, center, and either zoom or world radius define a deterministic camera; defaults frame the live population broadly.

This is deliberately not `human_current_view`: it does not capture the user's browser, panels, selections, desktop, or current camera. A future literal browser-view faculty can use that distinct name. Laboratory profiles must opt in with `humanView: true`; omission is deny-by-default, so existing experiments do not gain a new observation channel.

### Save-State / Resume

Checkpoints are observational fossils; `protouniverse-save-state/1` artifacts are executable continuation points. While an authoritative browser runtime is connected, save its exact current state with:

```powershell
npm run universe:save
```

The bridge requests an atomic serialization from the browser between simulation ticks and writes it once beneath `data/universes/<universe>/save-states/`. The artifact includes entity, bond, relationship, lifecycle-timer, rolling-window, occurrence-sequence, world-counter, and PRNG continuation state plus a SHA-256 checksum. Derived oscillation values are not duplicated.

After the existing authoritative runtime and bridge have been stopped normally, resume with:

```powershell
npm run universe:resume -- --save data/universes/<universe>/save-states/<save-id>.json
```

Resume validates schema, simulation version, identity, and checksum before starting the ordinary `npm run dev` runtime with the saved initialization path. It refuses if the default bridge reports another connected authoritative browser. The save artifact remains immutable. Runtime status and canonical snapshot metadata report `fresh` or the source save ID/hash/tick used for a resumed process.

### Laboratory & Tools operator console

The collapsible browser panel is a bounded local operator instrument, not a shell. It exposes Save, observer-once/loop, owned-loop Stop, experiment discovery, blind/reveal launch, runtime provenance, save-path guidance, and command help. Every action displays its equivalent CLI invocation and streams bounded timestamped output with running/completed/failed state, copy, and session clear controls.

The loopback bridge accepts only registry command IDs and validated typed arguments from localhost origins. It maps them to fixed existing ProtoUniverse scripts; clients cannot supply executables, shell text, working directories, environment variables, or arbitrary options. Reveal availability reflects frozen/comparison artifacts, while the existing Laboratory runner remains authoritative for scientific integrity. `npm run help`, individual Laboratory help, and the GUI render metadata from `src/operator/commandRegistry.ts`.

### Recurring machine observer

The local observer loop launches a fresh, non-interactive Codex expedition after each completed wait. It does not start, stop, or restart the app, bridge, universe, or MCP server. Start the app and bridge first (together with `npm run dev`, or separately in two terminals with `npm run dev:app` and `npm run dev:bridge`). The globally registered `protouniverse` MCP server is loaded by each Codex process.

Run `codex-first-entry` every five minutes:

```powershell
npm run observer:loop
```

Run exactly one expedition for testing:

```powershell
npm run observer:once
```

Change the observer or completed-cycle delay by passing arguments after `--`:

```powershell
npm run observer:loop -- --observer codex-first-entry --interval 300
npm run observer:once -- --observer another-observer
```

Options include `--max-cycles <count>`, `--expedition-timeout <seconds>`, `--model <model>`, `--search enabled|disabled`, `--working-directory <path>`, `--prompt-file <path>`, and `--max-logs <count>`. Search is disabled by default. A custom prompt may use `{{observer}}` as an identity placeholder. Run `npm run observer:loop -- --help` for the complete list.

Press Ctrl+C to stop. If an expedition is running, the loop terminates its owned Codex process tree; if it is waiting, the wait is cancelled. Cycles never overlap, and the interval begins only after the prior expedition exits or is terminated. Each expedition has a one-hour maximum runtime by default; configure it with `--expedition-timeout <seconds>`. A timeout, failed Codex, or unavailable-MCP expedition is logged and retried at the next cycle rather than killing the loop.

Operational logs live under `data/observer-runs/<observer>/` as a text transcript plus JSON metadata for each cycle. The default retention is 100 cycles. These files describe loop execution only: they are not universe events, authoritative state, or Observer Memory. Observer Memory remains the observer-authored notebook managed by ProtoUniverse.

The loop provides recurrence. Observer Memory provides continuity. The universe provides the curriculum.

### ProtoUniverse Laboratory v1.1 — Close the Curtain

**Experiments alter the observer's conditions of access, not the universe.** The Laboratory is a separate observational adapter between the authoritative machine interface and an experimental MCP client. It never changes Universe 0, simulation laws, canonical snapshots, archives, or deterministic behavior.

**The Veil restricts access honestly. It never fabricates reality.** A profile can permit, filter, or deny historical ranges, current state, checkpoints, events, entity and relationship inspection, ancestry, coordinates, energy, relationship metrics, regions, similarity, anomaly detection, comparisons, Observer Memory, and bookmarks. Denials describe information as inaccessible under the active observation profile; they do not claim that hidden data is absent or that the universe began at a boundary.

Experiment definitions are versioned JSON files in `data/laboratory/experiments/`. Multiple definitions can target the same universe with different observers and Veil profiles. The separate `protouniverse-lab` MCP process is started for exactly one experiment, forces that experiment's universe, filters both tool results and resource reads, and has no mutation, filesystem, shell, or HTTP-proxy faculty. The normal `protouniverse` MCP remains unrestricted and unchanged.

The included `archaeology-001` definition targets `U0-000001` as fresh observer `lab-archaeology-001-a`. Present entities, relationships, spatial state, and enabled analyses remain visible. History, events, and checkpoints before tick 250000 are inaccessible. History/list queries are clamped to the boundary; direct pre-boundary and comparison requests are rejected honestly. Observer Memory and legacy bookmarks are absent from the lab MCP tool/resource inventory, and `orient` receives no inherited continuity. Its minimal-disclosure profile omits experiment/profile metadata from results. The observer-facing expedition prompt does not disclose the cutoff, Veil, Laboratory status, or hypothesis.

Run the experiment against an already running bridge:

```powershell
npm run lab:once -- --experiment archaeology-001
```

The runner uses Codex's `--ignore-user-config` boundary, registers only the experiment-specific lab MCP, disables shell/snapshot, apps, browser/computer-use, image/view, plugin/skill, agent, hook, and proxy features, omits web search, and uses read-only/no-approval sandbox settings as defense in depth. Codex's capability host remains enabled solely to route the explicitly configured MCP tools; its shell and unified-exec backends remain disabled. Codex starts in a newly created empty temporary directory; only the MCP subprocess receives the real repository as its private working directory. The stage is removed after exit. Transcripts and unscored operational metadata are written beneath `data/laboratory/runs/<experiment-id>/`; metadata includes experiment, observer, universe, profile, prompt and interface versions, entry tick when reachable, simulation version when reachable, timestamps, command, isolation claims, cleanup status, exit status, and timeout state.

Manual classifications are separate sidecars beneath `data/laboratory/run-classifications/`, so scientific run transcripts and metadata remain unmodified. The original archaeology first-contact run is retained and classified as contaminated because it accessed backstage filesystem information.

#### Reveal / Comparison Chamber

The reusable chamber enforces `observe → hypothesize → freeze → reveal → compare`. A chamber-enabled blind run uses a versioned JSON output schema and captures the exact final response. After a successful run, the runner creates `data/laboratory/results/<experiment>/blind-reconstruction.json` with exclusive-create semantics, a SHA-256 over its complete frozen payload, source run/timestamps, observed tick/range, and experiment/profile/prompt/interface/simulation versions. It refuses to overwrite an existing artifact and marks it read-only. Results and run transcripts are experimental runtime records and remain outside authoritative history.

`archaeology-002` uses fresh observer `lab-archaeology-002-a` under the same sealed isolation and tick-250000 horizon, but explicitly asks for a pre-horizon reconstruction with evidence, confidence, competing explanations, chronology, and testable predictions. Run and freeze Phase 1 with:

```powershell
npm run lab:once -- --experiment archaeology-002
```

Only after the frozen artifact exists and validates may the reveal be launched:

```powershell
npm run lab:reveal -- --experiment archaeology-002
```

Reveal refuses before starting Codex unless the frozen SHA-256, experiment revision, successful source-run metadata, and freeze-after-completion ordering validate. It uses a separate sealed observer, exposes the immutable reconstruction through `frozen_reconstruction`, and grants read-only observational access beginning at tick 0. Observer Memory and bookmarks remain unavailable. Schema-constrained comparison output must bind to the frozen hash and reproduce every hypothesis's wording, confidence, evidence, and prediction exactly; missing or altered claims are rejected. Each evaluation uses `confirmed`, `partially supported`, `contradicted`, `unresolved`, or `not testable from available evidence`, followed by timeline and archaeological-information-survival analyses. The write-once result is `data/laboratory/results/archaeology-002/reveal-comparison.json`.

`archaeology-003` is Deep Archaeology: fresh observer `lab-archaeology-003-a` sees the accessible post-250000 record and present form--geometry, motion, energy, relationship topology and dimensional state, structural metrics, and undated lineage--through Veil profile v2. Explicit inscriptions such as birth/creation times, ages, provenance/origin, fingerprints, creation indices, reproduction counters, archive/checkpoint totals, and derived age/origin rankings are removed. Because authoritative numeric entity IDs are creation indices, both phases use stable experiment-scoped opaque entity labels; this preserves navigable topology and lets Reveal correlate evidence without exposing the underlying order. Similarity is unavailable because its candidate order currently mixes hidden age and origin with structural features; safe anomaly and comparison components remain available after field-level filtering. Its scientific question is: "How much information about an inaccessible past is encoded in the present form of ProtoUniverse when explicit historical inscriptions are removed?"

```powershell
npm run lab:once -- --experiment archaeology-003
npm run lab:reveal -- --experiment archaeology-003
```

The same write-once Freeze / Reveal / Compare machinery stores archaeology-003 independently beneath `data/laboratory/results/archaeology-003/`. It never supplies archaeology-002 results to either archaeology-003 observer, leaving later cross-experiment analysis external to both scientific runs.

`archaeology-003` is preserved as a scientifically valuable contaminated run: Veil v2 exposed authoritative event sequence 3950 at the horizon and accumulated rupture bookkeeping in the first accessible checkpoint. Its definition, run record, and frozen reconstruction are not rewritten or revealed.

`archaeology-004` repeats Deep Archaeology in a Veil v3 clean room. In addition to v2 redactions, authoritative event sequences become stable opaque event labels, archive cursors become opaque session-local capabilities, relationship IDs that embed entity creation indices become stable opaque structural labels, and historical bookkeeping is removed systematically from checkpoints, catalogs, orientation, diagnostics, pagination, and resources. Current population and relationship counts remain visible because they describe present form; accumulated births, ruptures, formations, transitions, archive quantities, and hidden-history record positions do not.

```powershell
npm run lab:once -- --experiment archaeology-004
npm run lab:reveal -- --experiment archaeology-004
```

`archaeology-005` is Present Moment archaeology under Veil v4. Its blind observer sees only current-form faculties: `orient`, present entity/relationship/region `inspect` and `context`, present-only `anomalies`, and present-target `compare`. History, changes, similarity, checkpoints, events, universe catalogs, Observer Memory, and bookmarks are absent. Current population, geometry, motion, energy, topology, dimensional states, relationship metrics, regional structure, and undated ancestry remain visible. Lifecycle counters, durations, prior-state values, provenance, historical rankings and summaries, archive metadata, and historical resource links are removed semantically. Entity and relationship references use deterministic experiment-scoped hash labels whose visible form does not preserve authoritative creation ordering.

```powershell
npm run lab:once -- --experiment archaeology-005
npm run lab:reveal -- --experiment archaeology-005
```

The reveal command remains unavailable until the blind reconstruction has completed and been frozen by the existing write-once, hash-verified chamber. Archaeology-001 through archaeology-004 and their scientific artifacts remain separate and unchanged.

Leakage controls remove pre-cutoff event/checkpoint objects and links plus obvious current-record historical fields such as birth/creation ticks, ages, origin, ancestry, historical summaries, archive start/count metadata, and age-derived feature labels. This is controlled epistemic access, not cryptographic secrecy: the present configuration may still permit qualitative inference from current population structure, identifiers/fingerprints, relationship topology, spatial arrangement, energy, and the ranking produced by permitted derived analyses. Future profiles can add sensory apertures, resolution lenses, blind comparison, prediction chambers, amnesiac or generational observers, communication chambers, event triggers, and counterfactual forks without changing authoritative domain logic.

- Distribution and lifetime of bonds, not just the active count.
- Relationship values within persistent groups compared with the population baseline.
- Local-density distribution and whether its variance grows over time.
- Radial dispersion and mean pair distance across equal-duration seed runs.
- Velocity autocorrelation and the time required for a seed to settle or disperse.
- Whether structures survive pause/restart comparisons at identical tick counts.
