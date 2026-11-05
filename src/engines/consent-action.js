// Click a site's cookie/consent dialog once per run, through its own button.
//
// Opt-in per target, and only ever the buttons the site owner configures:
//
//   consent_handling:
//     component: consent-dialog      # id of a component_signatures entry
//     choice: reject                 # reject (default) | accept
//     reject_selectors: ['#disagree-btn']
//     accept_selectors: ['#accept-btn']
//     wait_ms: 2000
//
// The scanner shares one browser context for a run, so after the first click the
// dialog does not return on later pages and is audited once instead of on every
// page. The default is `reject`: a scanner should not consent to tracking on a
// site's behalf. Nothing is guessed, no cookie is written directly and no
// element is removed: the page is only changed by its own dialog, the way a
// visitor would change it.

const CHOICES = ['reject', 'accept'];
const MAX_SELECTORS = 10;

export function resolveConsentHandling(raw, signatures = [], where = 'config') {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${where}: consent_handling must be a mapping.`);
  const errors = [];
  const choice = raw.choice ?? 'reject';
  if (!CHOICES.includes(choice)) errors.push(`${where}: consent_handling.choice must be reject or accept.`);
  const component = typeof raw.component === 'string' ? raw.component.trim() : '';
  if (!component) errors.push(`${where}: consent_handling.component must name a component_signatures id.`);
  else if (!signatures.some((signature) => signature.id === component)) errors.push(`${where}: consent_handling.component "${component}" is not a configured component_signatures id.`);
  const selectors = {};
  for (const key of CHOICES) {
    const value = raw[`${key}_selectors`] ?? [];
    if (!Array.isArray(value) || value.length > MAX_SELECTORS || value.some((v) => typeof v !== 'string' || !v.trim())) {
      errors.push(`${where}: consent_handling.${key}_selectors must be a list of up to ${MAX_SELECTORS} CSS selectors.`);
      selectors[key] = [];
    } else selectors[key] = value.map((v) => v.trim());
  }
  if (CHOICES.includes(choice) && selectors[choice].length === 0) errors.push(`${where}: consent_handling.${choice}_selectors needs at least one selector for the chosen action.`);
  const waitMs = raw.wait_ms == null ? 2000 : raw.wait_ms;
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 10000) errors.push(`${where}: consent_handling.wait_ms must be a whole number from 0 to 10000.`);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return { component, choice, selectors, wait_ms: waitMs };
}

/**
 * Click the first visible configured button for the chosen action. Returns
 * { clicked, selector }; clicked is false when none matched or the click failed.
 */
export async function runConsentAction(page, config) {
  for (const selector of config.selectors[config.choice]) {
    try {
      const button = page.locator(selector).first();
      if (!(await button.isVisible())) continue;
      await button.click({ timeout: 5000 });
      await page.waitForTimeout(config.wait_ms);
      return { clicked: true, selector };
    } catch {
      /* try the next selector */
    }
  }
  return { clicked: false, selector: null };
}
