// Every outbound fetch the server makes must be checked against this before
// it happens (spec.md FR-08 / NFR-01) — there is exactly one allowed origin,
// fixed at startup from the resolved .vital.yml, and no tool argument can
// widen it.
export function assertAllowedUrl(url, allowedOrigin) {
  let parsed;
  try {
    parsed = typeof url === 'string' ? new URL(url) : url;
  } catch {
    throw new Error(`Network access blocked: "${url}" is not a valid URL.`);
  }
  if (parsed.origin !== allowedOrigin) {
    throw new Error(
      `Network access blocked: "${parsed.origin}" is not the configured Vital Core host "${allowedOrigin}".`,
    );
  }
  return parsed;
}
