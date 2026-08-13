export const THEME_STORAGE_KEY = "rabbit-hole-color-theme";
export const THEME_CHANGE_EVENT = "rabbit-hole-theme-change";

export type ColorTheme = "light" | "dark";

export function isColorTheme(value: unknown): value is ColorTheme {
  return value === "light" || value === "dark";
}

export function resolveColorTheme(
  savedTheme: string | null | undefined,
  systemPrefersDark: boolean,
): ColorTheme {
  return isColorTheme(savedTheme) ? savedTheme : systemPrefersDark ? "dark" : "light";
}

export function oppositeColorTheme(theme: ColorTheme): ColorTheme {
  return theme === "dark" ? "light" : "dark";
}
