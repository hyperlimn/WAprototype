import type { RuptureEvent } from "../simulation/rupture";
import type { Universe } from "../simulation/universe";

const TIME_WINDOWS = [100, 500, 1_000, 5_000] as const;
const LOCAL_NEIGHBORHOOD_RADIUS = 320;

const distanceBand = (distance: number): "0-50" | "50-100" | "100-200" | "200-400" | "400+" => {
  if (distance < 50) return "0-50";
  if (distance < 100) return "50-100";
  if (distance < 200) return "100-200";
  if (distance < 400) return "200-400";
  return "400+";
};

const distance = (a: RuptureEvent, b: RuptureEvent): number => Math.hypot(b.x - a.x, b.y - a.y);

const sharesParent = (a: RuptureEvent, b: RuptureEvent): boolean =>
  a.parentEntityIds.some((id) => b.parentEntityIds.includes(id));

const largestWindowCount = (events: readonly RuptureEvent[], window: number): number => {
  let first = 0, largest = 0;
  for (let last = 0; last < events.length; last++) {
    while (events[last].tick - events[first].tick > window) first++;
    largest = Math.max(largest, last - first + 1);
  }
  return largest;
};

const maximumSeparation = (events: readonly RuptureEvent[]): number => {
  let maximum = 0;
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) maximum = Math.max(maximum, distance(events[i], events[j]));
  }
  return maximum;
};

export function buildRuptureCascadeDiagnostics(universe: Universe) {
  // Copying preserves deterministic insertion order for simultaneous ruptures.
  const events = [...universe.rupture.recentEvents];
  const currentEdges = new Set<string>();
  for (const relationship of universe.relationshipLayer.entities.values()) {
    currentEdges.add(`${relationship.parentAId}:${relationship.parentBId}`);
    currentEdges.add(`${relationship.parentBId}:${relationship.parentAId}`);
  }
  const graphConnected = (a: RuptureEvent, b: RuptureEvent): boolean => sharesParent(a, b)
    || a.parentEntityIds.some((original) => b.parentEntityIds.some((later) => currentEdges.has(`${original}:${later}`)));

  const countsByTimeWindowAndDistanceBand = Object.fromEntries(TIME_WINDOWS.map((window) => [String(window), {
    "0-50": 0, "50-100": 0, "100-200": 0, "200-400": 0, "400+": 0,
  }])) as Record<string, Record<string, number>>;
  const followed = { 100: 0, 500: 0, 1000: 0, 5000: 0 };
  let sharedParentFollowUpCount = 0;
  let structurallyConnectedFollowUpCount = 0;
  let sameLocalNeighborhoodFollowUpCount = 0;
  let noDirectStructuralConnectionFollowUpCount = 0;

  const eventDiagnostics = events.map((event, index) => {
    const later = events.slice(index + 1);
    const within = (window: number) => later.filter((candidate) => candidate.tick - event.tick <= window);
    const within100 = within(100), within500 = within(500), within1000 = within(1_000), within5000 = within(5_000);
    if (within100.length) followed[100]++;
    if (within500.length) followed[500]++;
    if (within1000.length) followed[1000]++;
    if (within5000.length) followed[5000]++;

    for (const candidate of within5000) {
      const separation = distance(event, candidate);
      if (sharesParent(event, candidate)) sharedParentFollowUpCount++;
      if (graphConnected(event, candidate)) structurallyConnectedFollowUpCount++;
      if (separation < LOCAL_NEIGHBORHOOD_RADIUS) sameLocalNeighborhoodFollowUpCount++;
      if (!graphConnected(event, candidate)) noDirectStructuralConnectionFollowUpCount++;
    }
    for (const window of TIME_WINDOWS) {
      for (const candidate of within(window)) {
        countsByTimeWindowAndDistanceBand[String(window)][distanceBand(distance(event, candidate))]++;
      }
    }
    const nearest = later.reduce<{ event: RuptureEvent; distance: number } | null>((best, candidate) => {
      const separation = distance(event, candidate);
      return !best || separation < best.distance ? { event: candidate, distance: separation } : best;
    }, null);
    return {
      tick: event.tick, relationshipId: event.relationshipId, parentIds: event.parentEntityIds,
      x: event.x, y: event.y,
      laterRupturesWithin100Ticks: within100.length,
      laterRupturesWithin500Ticks: within500.length,
      laterRupturesWithin1000Ticks: within1000.length,
      nearestLaterRuptureDistance: nearest?.distance ?? null,
      nearestLaterRuptureTickDelta: nearest ? nearest.event.tick - event.tick : null,
      sharedParentLaterRupture: later.some((candidate) => sharesParent(event, candidate)),
      structurallyConnectedLaterRupture: later.some((candidate) => graphConnected(event, candidate)),
    };
  });

  const bursts: RuptureEvent[][] = [];
  for (const event of events) {
    const current = bursts[bursts.length - 1];
    if (!current || event.tick - current[current.length - 1].tick > 500) bursts.push([event]);
    else current.push(event);
  }
  const burstDiagnostics = bursts.map((burst) => {
    const xs = burst.map((event) => event.x), ys = burst.map((event) => event.y);
    return {
      startTick: burst[0].tick, endTick: burst[burst.length - 1].tick,
      duration: burst[burst.length - 1].tick - burst[0].tick,
      ruptureCount: burst.length,
      involvedRelationshipIds: [...new Set(burst.map((event) => event.relationshipId))],
      involvedEntityIds: [...new Set(burst.flatMap((event) => [...event.parentEntityIds]))].sort((a, b) => a - b),
      spatialBoundingBox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
      maximumSeparation: maximumSeparation(burst),
    };
  });

  const baseline = (timeWindow: number, spatialRadius: number) => {
    let totalPairs = 0, temporalPairs = 0, spatialPairs = 0, observedPairs = 0;
    for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
      totalPairs++;
      const temporal = events[j].tick - events[i].tick <= timeWindow;
      const spatial = distance(events[i], events[j]) < spatialRadius;
      if (temporal) temporalPairs++;
      if (spatial) spatialPairs++;
      if (temporal && spatial) observedPairs++;
    }
    const expectedPairsUnderIndependence = totalPairs ? temporalPairs * spatialPairs / totalPairs : 0;
    return { timeWindow, spatialRadius, observedPairs, expectedPairsUnderIndependence, totalPairs };
  };
  const largestBurst = burstDiagnostics.reduce((largest, burst) => Math.max(largest, burst.ruptureCount), 0);
  const recentBurst = burstDiagnostics[burstDiagnostics.length - 1] ?? null;
  return {
    totalRuptureEventsExamined: events.length,
    ruptureEventsFollowedWithin100Ticks: followed[100],
    ruptureEventsFollowedWithin500Ticks: followed[500],
    ruptureEventsFollowedWithin1000Ticks: followed[1000],
    ruptureEventsFollowedWithin5000Ticks: followed[5000],
    countsByTimeWindowAndDistanceBand,
    sharedStructureAssociations: {
      sharedParentFollowUpCount, structurallyConnectedFollowUpCount,
      sameLocalNeighborhoodFollowUpCount, noDirectStructuralConnectionFollowUpCount,
    },
    isolatedRuptureCount: events.length - followed[5000],
    ruptureBurstCount: burstDiagnostics.length,
    currentOrRecentBurstSize: recentBurst?.ruptureCount ?? 0,
    longestObservedRuptureBurst: largestBurst,
    largestRuptureCountWithinAny500TickWindow: largestWindowCount(events, 500),
    largestRuptureCountWithinAny1000TickWindow: largestWindowCount(events, 1_000),
    recentBursts: burstDiagnostics.slice(-50),
    recentRuptureEventAssociations: eventDiagnostics.slice(-100),
    deterministicBaselineComparison: [baseline(500, 100), baseline(1_000, 200)],
  };
}
