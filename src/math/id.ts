let seq = 0;

export function createId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
