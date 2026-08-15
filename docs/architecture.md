# ProtoUniverse architecture

ProtoUniverse is a deterministic universe plus several ways to observe, preserve, and operate it. Its central dependency rule is:

```text
authoritative state and laws
  -> derived measurements
  -> observational snapshots and queries
  -> faculties and projections
  -> human or machine presentation

supervisor
  -> owned runtime services (Bridge/API, frontend)
```

Lower layers must not depend on presentation, operator UI, or experimental policy. Observer projections do not alter the universe. The Laboratory restricts access to truthful authoritative observations; it does not change or fabricate reality.

## Current layers

### Authoritative simulation

`src/simulation/` contains entity and relationship state, deterministic fingerprints and oscillation identity, seeded randomness, physics, dimensional state, relationship lifecycle, rupture, reproduction, fields, and higher-order behavior. `Universe` owns the authoritative runtime and hand-wires the exact step order. `SIMULATION_SYSTEM_ORDER` documents that order; it does not execute it.

`WorldState` currently contains several kinds of data in one compatible runtime shape. `WORLD_STATE_FIELDS` classifies every field without migrating it. Entity arrays, bond and relationship maps, subsystem continuation records, occurrence sequence, PRNG cursor, clock, and scheduler markers together form the continuation surface.

Forbidden dependencies: simulation code must not import UI, Three.js, MCP, Laboratory, persistence stores, or operator modules. Wall-clock profiling and rendering animation must never feed physics.

#### Law Evolution v1

Law Evolution is authoritative, deterministic law state. Every 500,000 completed ticks, after all existing step phases and measurements, the runtime builds `cosmological-state-vector/1`, encodes its classified measurements as fixed-point big-endian bytes, and hashes those bytes with the universe identity, epoch, boundary, grammar versions, previous law-set hash, and previous evolution hash. `law-grammar/1` decodes only a bounded parameter modulation. The mutation is installed atomically and first affects the following tick.

```text
completed authoritative state
-> canonical cosmological vector
-> Law Evolution Hash
-> bounded Law Genome
-> effective parameter set and immutable law-set manifest
-> subsequent authoritative evolution
```

The typed Law Parameter Registry is the only route by which an evolved genome can affect physics. V1 cannot generate code, add phases, change PRNG/tick/save/archive machinery, or allocate per-entity law state. Effective parameter lookup is fixed-size and O(1); immutable birth records are continuation history.

### Derived measurements

Current aggregates in `WorldState`, diagnostics in `src/observation/`, oscillation-at-tick, anomaly scores, comparisons, and attention rankings are derived observations. Some rolling values remain persisted for save compatibility even when rebuildable. Observer-only timing data lives outside `WorldState` and save payloads.

### Persistence

`src/simulation/saveState.ts` defines the executable continuation schema `protouniverse-save-state/2`. `server/save-state/` writes immutable artifacts and verifies compatibility/checksums. Version-1 saves below tick 500,000 migrate explicitly into Law Epoch 0; later version-1 saves fail closed because Law Evolution did not shape their past. `server/memory/` owns observational archives and checkpoints. Checkpoints are evidence; save states are executable continuation points. Neither is presentation state.

Memory manifests use a per-path serialized atomic publisher: a unique temporary file is completely written, flushed, and closed before an atomic rename replaces the manifest. Transient Windows `EPERM`, `EBUSY`, and `EACCES` replacement failures receive six bounded deterministic attempts; the previous manifest is never unlinked, and final failure propagates to the caller. Runtime ownership separately prevents independent Bridge processes from becoming competing writers.

Save compatibility rule: do not change the continuation schema, state meaning, PRNG semantics, or law order without an explicit version and migration decision.

#### Counterfactual Overlay v1

A counterfactual originates only at the immutable between-ticks continuation boundary: completed authoritative tick `T`, after every tick-T phase and any Law Evolution installation, before step `T → T+1`. `Universe.continuationState()` is cloned once and sent to a dedicated temporary Web Worker. The worker reconstructs a separately owned `Universe`, applies one validated velocity-only impulse, and advances toward primary target ticks without ever blocking the primary scheduler. Branch identity, correspondence, comparison metrics, overlay frames, and tombstones are observer/tool state; none enter primary continuation, Bridge publication, memory, saves, archives, MCP, or Laboratory.

V1 permits one in-memory branch, owns no persistence, and has no tick-age limit. Resource limits pause the branch rather than throttling primary authority. The inherited universe seed and deep-cloned Law Evolution continuation remain the branch's causal inputs; session branch names never affect physics. The Canvas overlay is disposable presentation and cannot call simulation methods.

Counterfactual Experimentation v2 adds bounded displacement, radial velocity, tangential spin, and atomic relationship sever interventions. All routes share one canonical `counterfactual-intervention/2` validator; final causal values, resolved one-hop membership, and relationship identity enter the intervention hash, while UI presets and multipliers do not. Relationship strength modulation remains deferred because the current lifecycle has no single authoritative modulation pathway whose isolated mutation would preserve all bond and relationship invariants.

Normal MCP may relay explicit create/status/compare/inspect/terminate calls to the connected browser authority. The relay cannot accept continuation state, PRNG state, laws, paths, processes, or commands: origin capture occurs only inside the browser controller. One active branch, a create cooldown, worker resource caps, bounded comparison/inspection payloads, and twenty session-only terminated experiment summaries constrain experimentation. These summaries are not memory, archive, save, occurrence, or observer-memory records. Laboratory explicitly disables every counterfactual faculty by default.

Counterfactual appearance preferences and both trail systems are observer-only presentation. Counterfactual trails retain a short bounded sequence of received overlay frames. Primary Live Trails begin only when enabled, sample current authoritative positions at a fixed tick interval into bounded typed buffers, and are cleared when disabled. They are recorded observations, not lifetime histories, and never enter continuation, hashes, snapshots, saves, memory, or archives.

**Full Timeline Trails are deferred.** A future system may reconstruct or persist whole tick-space trajectories through deterministic replay in a dedicated Worker, a sampled/decimated trajectory cache, or explicit trajectory persistence. Current trail code has no dependency on that future facility and makes no historical-completeness claim.

### Observation and query

`src/interface/worldSnapshot.ts` creates the canonical machine snapshot from a universe. Reusable diagnostics live in `src/observation/`, never `src/ui/`. `src/query/` and `src/perception/` consume snapshot records and archived evidence. `OBSERVATION_FIELD_CLASSIFICATION` records the known epistemic categories in preparation for a future field-classified schema; it does not yet drive filtering.

### Machine faculties and MCP

`server/mcp/` exposes read-only structured faculties and deterministic rendered Human View through the Bridge/API gateway. Faculties consume observational interfaces rather than simulation implementation objects. MCP must not become a mutation, filesystem, shell, or unrestricted network path.

### Laboratory and the Veil

`server/laboratory/` loads persistent experiment definitions, derives policy, filters outputs/resources centrally, and exposes a distinct Laboratory MCP doorway. Freeze/reveal/compare artifacts remain outside universe history. Laboratory access must always pass through its gateway; experiments must not gain normal MCP, memory, bookmarks, shell, filesystem, or web access unless explicitly designed and safely supported.

### Human projections and rendering

`src/rendering/` contains the 2D camera, renderer, and dimension projection policy. `src/ui/` binds panels and controls to observational state. Projections may filter or emphasize visible information, but cannot write simulation state. The canonical direction is observation/projection policy to renderer, not renderer back into simulation.

### Entity close-up morphology

`src/closeup/` maps immutable fingerprints to a deterministic morphology genome, bounded topology and pattern features, then a lazily created Three.js close-up. Oscillation adds tick-derived visual breathing only. Connection particles are one buffered point per current relationship; their deterministic planes, shells, speed, state color, and glow are observer projections of current relationship measurements. Camera, animation, particles, and WebGL lifecycle are presentation concerns and must remain disposable and non-authoritative.

Future close-up work may gradually turn connection particles into a relational portrait, but mappings must be justified against authoritative `RelationshipEntity` fields before adoption. Candidate investigations include dimensional mode for orbital inclination, instability or churn for eccentricity, relationship change rate for precession, a defensible polarity field for rotation direction, shared character for plane alignment, another measured relationship property for symmetry-axis latitude, and coherence/synergy for rotational coherence. V1 keeps the functioning particle visualization unchanged; these are design hypotheses, not current semantics.

### Bridge, operator tools, and supervisor

`server/index.ts` hosts the loopback Bridge/API, receives browser-authoritative snapshots, serves observational queries, and runs allowlisted operator jobs. `server/supervisor/` is the control plane and owns the frontend and Bridge/API child PIDs. Runtime replacement uses immutable save-state continuation, semantic health checks, browser reconnection, and provenance verification. It may stop only tracked children and must never expose arbitrary commands or paths. Restart cleanup inventories Windows command lines using the exact repository path plus reviewed entry-point signatures, re-verifies PID identity immediately before termination, excludes the handling supervisor and Codex, and fails closed on unknown port owners.

## Boundaries to preserve

- Authoritative simulation may publish state; it must not know how observers render or filter it.
- Persistence serializes domain schemas, not DOM, canvas, Three.js, or operator-console fields.
- Snapshot/query code may depend on simulation and observation modules, never UI implementations.
- Laboratory policy wraps observational gateways; authoritative query code must remain usable without Laboratory conditions.
- Human and machine projections should converge on shared observation/projection semantics without sharing presentation machinery unnecessarily.
- Supervisor owns process lifecycle; the Bridge/API owns approved application actions; the browser owns neither process spawning nor arbitrary shell execution.

## Versioned guardrails

- Simulation version: `SIMULATION_VERSION`.
- Law/system-order version: `SIMULATION_LAW_SET_VERSION`.
- Save compatibility: `SAVE_STATE_SCHEMA_VERSION`.
- Machine observation: `MACHINE_INTERFACE_VERSION` / server interface version.
- Deterministic state hashes intentionally exclude operational runtime provenance and wall-clock metadata.

Golden replay hashes are law-regression fixtures. An intentional law or continuation change must explain and deliberately update them; an architectural refactor should leave them unchanged.

## Deliberately deferred

Architecture Foundation v1 does not create a dynamic system pipeline, generic plugin loader, new state schema, timeline/branch model, worker-owned simulation, classified Veil schema, or shared renderer scene graph. Those changes require separate compatibility and behavior decisions.
