export function resolveExperimentModeAvailability(): boolean {
  return true;
}

export function resolveExperimentModeEnabled(storedValue: string | null): boolean {
  return storedValue !== "false";
}

export function isExperimentModeAvailable(): boolean {
  return resolveExperimentModeAvailability();
}
