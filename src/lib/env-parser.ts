/**
 * Parse .env file content into key-value pairs.
 * Handles comments (#), quoted values, and empty lines.
 */
export function parseEnvContent(text: string): { key: string; value: string }[] {
  const results: { key: string; value: string }[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) results.push({ key, value });
  }
  return results;
}
