export function trimSuffix(str: string | undefined, suffix: string) {
  if (!str) {
    return;
  }

  return str.endsWith(suffix) ? str.slice(0, -suffix.length) : str;
}
