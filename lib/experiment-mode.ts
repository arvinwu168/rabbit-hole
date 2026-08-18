export function resolveExperimentModeAvailability(): boolean {
  return true;
}

export function isExperimentModeAvailable(): boolean {
  return resolveExperimentModeAvailability();
}
