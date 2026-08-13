export const PERCEPTION_LIMITS = { defaultResults: 10, maximumResults: 100, maximumDepth: 3, recentEventWindow: 10_000 } as const;

export const ATTENTION_WEIGHTS = {
  anomaly: 0.35, connectivity: 0.2, persistence: 0.15, recentActivity: 0.2, structuralExtremity: 0.1,
} as const;
