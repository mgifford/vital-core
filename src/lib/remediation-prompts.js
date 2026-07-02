/**
 * Platform-specific remediation tips keyed by normalised CMS/framework name
 * then axe rule id. Returned alongside the generic remediation-tips.json entry
 * so the report shows both a universal fix and a CMS-specific workflow.
 *
 * Only covers the most common government CMS platforms. Unknown platforms
 * fall back gracefully to the generic tip from remediation.js.
 */

const PLATFORM_TIPS = {
  drupal: {
    'image-alt': 'In Drupal\'s Media Library, fill the "Alternative text" field when uploading or editing an image. For images in body fields, the CKEditor "Image Properties" dialog includes an Alt Text field.',
    'label': 'Use Drupal\'s form element "Label" setting. In Webform, every element has a Label field — ensure it\'s not empty or hidden. Check that twig templates don\'t strip <label> elements from form fields.',
    'color-contrast': 'Check your Drupal theme\'s base CSS. Themes like Olivero and Bartik have contrast issues in default color schemes — override failing color pairs in your subtheme\'s style.css.',
    'heading-order': 'Drupal Views and blocks can insert headings at arbitrary levels. In the Views UI, set "Title tag" for each display. For block titles, configure the heading level in the block\'s layout settings.',
    'link-name': '"Read more" links from Drupal Views should use the "Link text" rewrite field to add context, or add aria-label via the Views rewrite output.',
    'html-has-lang': 'Drupal sets the page lang attribute from Admin › Configuration › Regional and Language › Languages. Ensure the default language is configured.',
    'document-title': 'Drupal generates page titles from the node title + site name. Customise the pattern at Admin › Configuration › Search and metadata › Metatag.',
    'bypass': 'Enable the "Skip to main content" link in your Drupal theme. Olivero includes it; for custom themes add a skip link in html.html.twig before the main content region.',
    'region': 'Use Drupal\'s region system (header, navigation, main, sidebar, footer) and map each to an HTML5 landmark element in your theme\'s page.html.twig.',
    'duplicate-id': 'Drupal views and blocks can emit duplicate ids when the same view appears multiple times. Patch the twig template to append the block delta or display id to each id attribute.',
  },
  wordpress: {
    'image-alt': 'In the Block Editor, click an Image block and fill "Alt text" in the sidebar. In the Media Library, set alt text on each image in the "Alternative Text" field so it pre-fills everywhere that image is used.',
    'label': 'For contact forms, use accessible plugins like Gravity Forms or Ninja Forms which generate proper label associations. Check that your theme\'s comment form and search form include visible labels.',
    'color-contrast': 'Override contrast-failing colours in your child theme\'s style.css or via Appearance › Customize › Additional CSS. The WP Accessibility plugin includes a contrast checker for your colour palette.',
    'heading-order': 'The Block Editor\'s Heading block lets you pick H1–H6 freely. Install the Equalize Digital Accessibility Checker plugin to flag skipped heading levels across your posts and pages.',
    'link-name': 'Replace generic "Read more" links with descriptive text. The WP Accessibility plugin\'s "Read More" fix can append the post title automatically.',
    'html-has-lang': 'WordPress sets the lang attribute from Settings › General › Site Language. Ensure the language matches the primary content language of the site.',
    'document-title': 'WordPress generates <title> from the post/page title and site name. Use an SEO plugin (Yoast, RankMath) to customise the template and prevent duplicate titles.',
    'bypass': 'Add a skip link before wp_body_open() in your header.php. The WP Accessibility plugin adds skip links automatically if your theme does not include them.',
    'frame-title': 'For embeds (YouTube, Google Maps), add a title via the Block Editor\'s Advanced panel or filter the embed output with oembed_result to inject the title attribute programmatically.',
    'aria-hidden-focus': 'Themes and plugins that use modal dialogs (lightboxes, cookie banners) commonly cause this. Check the plugin\'s accessibility settings or file an issue requesting aria-hidden is removed before the element gains focus.',
  },
  sharepoint: {
    'image-alt': 'In SharePoint Online, click the Image web part and fill the "Alternative text" field in the property pane. For images in Rich Text web parts, right-click the image and choose "Format picture" to add alt text.',
    'label': 'SharePoint list forms and Power Apps forms should have visible labels for all fields. Add column descriptions visible to assistive technology and avoid label-free placeholder-only inputs.',
    'color-contrast': 'SharePoint themes are defined in site settings under "Change the Look". Test chosen theme colours with Accessibility Insights for Web before deploying to a wide audience.',
    'document-title': 'SharePoint page titles come from the page name set at creation. Rename pages via the Site Pages library or use the Page Details panel to set a custom browser title.',
    'heading-order': 'In SharePoint modern pages, text web parts default to Paragraph format. Use the format toolbar to set explicit Heading 1/2/3 levels; avoid bold-paragraph as a heading substitute.',
    'link-name': 'When inserting links in Rich Text web parts, always fill the "Display text" field with descriptive text rather than pasting raw URLs.',
    'region': 'SharePoint modern pages use a fixed layout with built-in landmarks. Avoid custom web parts that render outside landmarks or wrap content in non-semantic containers.',
  },
  'adobe experience manager': {
    'image-alt': 'In AEM\'s Assets console, set the "Alt Text" metadata field on each asset. For components, ensure the Image component\'s authoring dialog exposes an Alt Text field and the Sling model reads it.',
    'label': 'AEM Forms components should use the "Title" field as the visible label. Check that adaptive form components are configured with visible titles and not placeholder-only inputs.',
    'heading-order': 'AEM\'s Text component and Title component each have configurable heading levels. Provide content authors clear documentation on which heading level to use in each page region.',
  },
};

// Map a raw detected tech name to a key in PLATFORM_TIPS.
function normalize(name) {
  return name.toLowerCase().trim();
}

/**
 * Returns the best platform-specific tip for a rule id given a list of
 * detected technologies, or null when no tip is available.
 *
 * @param {Array<{name:string}|string>} detectedTech - from summary.tech
 * @param {string} ruleId - axe rule id (e.g. 'image-alt')
 * @returns {{ tech: string, tip: string } | null}
 */
export function techRemediationTip(detectedTech, ruleId) {
  if (!detectedTech?.length) return null;
  for (const t of detectedTech) {
    const name = typeof t === 'string' ? t : (t.name ?? '');
    const key = normalize(name);
    const tip = PLATFORM_TIPS[key]?.[ruleId];
    if (tip) return { tech: name, tip };
  }
  return null;
}

/**
 * Return all platform names that have at least one tip entry.
 * Useful for tests and documentation.
 */
export function supportedPlatforms() {
  return Object.keys(PLATFORM_TIPS);
}
