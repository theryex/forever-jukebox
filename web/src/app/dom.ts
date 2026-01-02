export function requireElement<T>(value: T | null, name: string): T {
  if (!value) {
    throw new Error(`Missing required DOM element: ${name}`);
  }
  return value;
}

export function requireNonEmpty<T>(value: T[], name: string): T[] {
  if (value.length === 0) {
    throw new Error(`Missing required DOM elements: ${name}`);
  }
  return value;
}
