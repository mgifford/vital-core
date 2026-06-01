import { describe, expect, it } from 'vitest';
import { OfflineWorker } from '../../src/engine/workers/offline-worker';

describe('OfflineWorker', () => {
  it('extracts overlay, design-system, and alt-text metrics from a snapshot', () => {
    const html = `
      <html>
        <body class="usa-grid">
          <script src="https://cdn.userway.org/widget.js"></script>
          <p>The Centers for Medicare & Medicaid Services (CMS) helps people access benefits.</p>
          <a href="/details">Read more</a>
          <img src="logo.png" alt="logo" />
          <img src="hero.jpg" />
          <p>This sentence is here. Another sentence is here for readability checks.</p>
        </body>
      </html>
    `;

    const result = OfflineWorker.processSnapshot(html);

    expect(result.overlayDetected.found).toBe(true);
    expect(result.overlayDetected.provider).toBe('UserWay');
    expect(result.designSystem.usesUSWDS).toBe(true);
    expect(result.contentMetrics.suspiciousAltTextCount).toBe(2);
    expect(result.contentMetrics.readabilityScore).toBeGreaterThanOrEqual(0);
    expect(result.contentMetrics.readabilityScore).toBeLessThanOrEqual(100);
    expect(result.contentMetrics.fleschKincaidGrade).toBeGreaterThanOrEqual(0);
    expect(result.contentMetrics.averageSentenceLength).toBeGreaterThan(0);
    expect(result.contentMetrics.passiveVoiceSentenceRatio).toBeGreaterThanOrEqual(0);
    expect(result.contentMetrics.passiveVoiceSentenceRatio).toBeLessThanOrEqual(100);
    expect(result.contentMetrics.ambiguousLinkTextCount).toBe(1);
    expect(result.contentMetrics.unexplainedAcronymCount).toBe(0);
  });

  it('reports totalImageCount for all images on the page', () => {
    const html = `
      <html>
        <body>
          <header><img src="logo.png" alt="logo" /></header>
          <main>
            <img src="content1.jpg" alt="chart" />
            <img src="content2.jpg" alt="diagram" />
          </main>
          <footer><img src="footer-seal.png" alt="seal" /></footer>
        </body>
      </html>
    `;

    const result = OfflineWorker.processSnapshot(html);

    expect(result.contentMetrics.totalImageCount).toBe(4);
  });

  it('reports contentImageCount excluding header/footer/nav images', () => {
    const html = `
      <html>
        <body>
          <header><img src="logo.png" alt="logo" /></header>
          <nav><img src="nav-icon.png" alt="nav icon" /></nav>
          <main>
            <img src="content1.jpg" alt="chart" />
            <img src="content2.jpg" alt="diagram" />
          </main>
          <footer><img src="footer-seal.png" alt="seal" /></footer>
        </body>
      </html>
    `;

    const result = OfflineWorker.processSnapshot(html);

    expect(result.contentMetrics.totalImageCount).toBe(5);
    expect(result.contentMetrics.contentImageCount).toBe(2);
  });

  it('uses article as fallback main content container', () => {
    const html = `
      <html>
        <body>
          <header><img src="logo.png" alt="logo" /></header>
          <article>
            <p>Article content here with several words for counting.</p>
            <img src="inline.jpg" alt="inline chart" />
          </article>
          <footer><img src="footer.png" alt="footer" /></footer>
        </body>
      </html>
    `;

    const result = OfflineWorker.processSnapshot(html);

    expect(result.contentMetrics.contentImageCount).toBe(1);
    expect(result.contentMetrics.totalImageCount).toBe(3);
    expect(result.contentMetrics.wordCount).toBeGreaterThan(0);
  });

  it('counts words in main content area only', () => {
    const html = `
      <html>
        <body>
          <header><p>Site header navigation links</p></header>
          <main>
            <p>hello world this is main content</p>
          </main>
          <footer><p>Footer copyright text</p></footer>
        </body>
      </html>
    `;

    const result = OfflineWorker.processSnapshot(html);

    // Main content has 6 words; header and footer words should not be counted
    expect(result.contentMetrics.wordCount).toBe(6);
  });

  it('detects misspelled words in main content', () => {
    const html = `
      <html>
        <body>
          <main>
            <p>This page has a mistak in it with baaaad speling.</p>
          </main>
        </body>
      </html>
    `;

    const result = OfflineWorker.processSnapshot(html);

    // misspelledWordCount should be populated
    expect(result.contentMetrics.misspelledWordCount).toBeGreaterThan(0);
    expect(Array.isArray(result.contentMetrics.misspelledWords)).toBe(true);
    expect(result.contentMetrics.misspelledWords!.length).toBeGreaterThan(0);
  });

  it('does not flag correctly spelled words as misspellings', () => {
    const html = `
      <html>
        <body>
          <main>
            <p>the government provides services to all citizens and residents.</p>
          </main>
        </body>
      </html>
    `;

    const result = OfflineWorker.processSnapshot(html);

    expect(result.contentMetrics.misspelledWordCount).toBe(0);
    expect(result.contentMetrics.misspelledWords).toEqual([]);
  });

  it('caps misspelled words list at 20 entries', () => {
    // Generate a string with 25+ distinct misspelled tokens
    const badWords = Array.from({ length: 25 }, (_, i) => `zxqwrty${i}abc`).join(' ');
    const html = `<html><body><main><p>${badWords}</p></main></body></html>`;

    const result = OfflineWorker.processSnapshot(html);

    expect(result.contentMetrics.misspelledWords!.length).toBeLessThanOrEqual(20);
  });
});
