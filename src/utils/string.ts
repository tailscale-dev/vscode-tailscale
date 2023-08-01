export function trimSuffix(str: string, suffix: string): string {
  return str.endsWith(suffix) ? str.slice(0, -suffix.length) : str;
}

export function escapeSpace(str: string): string {
  return str.replace(/\s/g, '\\ ');
}
