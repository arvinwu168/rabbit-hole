export function resolveExperimentModeAvailability(
  nodeEnvironment: string | undefined,
  configuredValue: string | undefined,
): boolean {
  return nodeEnvironment === "development" || configuredValue === "1";
}

export function isExperimentModeAvailable(): boolean {
  return resolveExperimentModeAvailability(
    process.env.NODE_ENV,
    process.env.NEXT_PUBLIC_RABBIT_HOLE_EXPERIMENT_MODE,
  );
}
