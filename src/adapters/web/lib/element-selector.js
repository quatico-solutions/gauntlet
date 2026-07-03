/**
 * Element selector helpers — pure functions that produce JavaScript source
 * strings to be evaluated in the page via CDP Runtime.evaluate.
 *
 * No closure state, no Chrome session dependency. The returned strings are
 * interpolated into larger CDP `expression` payloads.
 */

// ===== GAUNTLET DIVERGENCE #4: parseContains + :contains() support =====
// Upstream has no :contains() helper. We added one because LLM agents reach
// for jQuery-style `button:contains('Log in')` anyway, and a silent CSS
// syntax error wastes turns. getElementSelector / getElementSelectorAll
// below consume this — both have matching Gauntlet-only branches.
//
// Parse a :contains('text') / :contains("text") clause at the end of a
// selector. Returns { base, text } or null if the selector doesn't use
// :contains. The base may be empty (meaning "match any element"); we
// turn that into "*".
// GAUNTLET DIVERGENCE #5 (ewz): shadow-piercing querySelectorAll, embedded in every
// generated CSS-selector snippet. XPath branches stay document-scoped (document.evaluate
// cannot cross shadow boundaries).
const HELPER_JS = `
    function __gDeepQueryAll(sel) {
      var out = [];
      function walk(root) {
        var matches = root.querySelectorAll(sel);
        for (var i = 0; i < matches.length; i++) out.push(matches[i]);
        var all = root.querySelectorAll('*');
        for (var j = 0; j < all.length; j++) {
          if (all[j].shadowRoot) walk(all[j].shadowRoot);
        }
      }
      walk(document);
      return out;
    }
`;

function parseContains(selector) {
  const m = selector.match(/^(.*?):contains\(\s*(['"])(.*?)\2\s*\)\s*$/);
  if (!m) return null;
  const base = m[1].trim();
  return { base: base || '*', text: m[3] };
}
// ===== GAUNTLET DIVERGENCE END =====

// Generate element selection code (supports CSS, XPath, and Gauntlet's
// jQuery-style :contains('text')). Prefers visible elements (non-zero
// bounding rect) over hidden ones; falls back to first DOM match with a
// console.warn if all matches are hidden. For XPath with text()='...', also
// tries normalize-space() fallback for mixed content elements.
function getElementSelector(selector) {
  if (selector.startsWith('/') || selector.startsWith('//')) {
    // XPath selector - collect all matches, prefer visible
    const hasTextEquals = /text\(\)\s*=\s*['"]/.test(selector);
    const xpaths = [JSON.stringify(selector)];
    if (hasTextEquals) {
      const fallbackSelector = selector.replace(/text\(\)\s*=\s*(['"])(.*?)\1/g, "normalize-space()=$1$2$1");
      xpaths.push(JSON.stringify(fallbackSelector));
    }
    return `(() => {
      var all = [];
      var seen = new Set();
      [${xpaths.join(', ')}].forEach(function(xpath) {
        var iter = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
        var node;
        while (node = iter.iterateNext()) {
          if (!seen.has(node)) { seen.add(node); all.push(node); }
        }
      });
      if (all.length === 0) return null;
      var visible = all.find(function(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (visible) return visible;
      console.warn('[superpowers-chrome] All ' + all.length + ' elements matching XPath have zero dimensions; using first match');
      return all[0];
    })()`;
  }

  // GAUNTLET DIVERGENCE #4: jQuery-style :contains('text') — translate to a
  // querySelectorAll walk. Prefer visible matches, consistent with the CSS
  // and XPath branches.
  const contains = parseContains(selector);
  if (contains) {
    return `(() => {
${HELPER_JS}
      var all = __gDeepQueryAll(${JSON.stringify(contains.base)}).filter(function(_el) {
        var _t = (_el.textContent || '').replace(/\\s+/g, ' ').trim();
        return _t.includes(${JSON.stringify(contains.text)});
      });
      if (all.length === 0) return null;
      var visible = all.find(function(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (visible) return visible;
      console.warn('[superpowers-chrome] All ' + all.length + ' elements matching :contains() have zero dimensions; using first match');
      return all[0];
    })()`;
  }

  // CSS selector - prefer visible elements
  return `(() => {
${HELPER_JS}
    var all = __gDeepQueryAll(${JSON.stringify(selector)});
    if (all.length === 0) return null;
    var visible = all.find(function(el) {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (visible) return visible;
    console.warn('[superpowers-chrome] All ' + all.length + ' elements matching ' + ${JSON.stringify(JSON.stringify(selector))} + ' have zero dimensions; using first match');
    return all[0];
  })()`;
}

// Get all matching elements (used by multi-element warnings).
// For XPath with text()='...', also tries normalize-space() fallback for mixed content elements.
function getElementSelectorAll(selector) {
  if (selector.startsWith('/') || selector.startsWith('//')) {
    // XPath - get all matches, with fallback for text()='...' patterns
    const hasTextEquals = /text\(\)\s*=\s*['"]/.test(selector);
    if (hasTextEquals) {
      const fallbackSelector = selector.replace(/text\(\)\s*=\s*(['"])(.*?)\1/g, "normalize-space()=$1$2$1");
      return `(() => {
        const result = [];
        const seen = new Set();
        for (const xpath of [${JSON.stringify(selector)}, ${JSON.stringify(fallbackSelector)}]) {
          const iterator = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
          let node;
          while (node = iterator.iterateNext()) {
            if (!seen.has(node)) { seen.add(node); result.push(node); }
          }
        }
        return result;
      })()`;
    }
    return `(() => {
      const result = [];
      const iterator = document.evaluate(${JSON.stringify(selector)}, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
      let node;
      while (node = iterator.iterateNext()) result.push(node);
      return result;
    })()`;
  }

  // GAUNTLET DIVERGENCE #4: jQuery-style :contains('text') — same translation
  // as getElementSelector, but returns all matches (no visible-preference).
  const contains = parseContains(selector);
  if (contains) {
    return `(() => {
${HELPER_JS}
      const _els = __gDeepQueryAll(${JSON.stringify(contains.base)});
      const _want = ${JSON.stringify(contains.text)};
      return _els.filter((_el) => {
        const _t = (_el.textContent || '').replace(/\\s+/g, ' ').trim();
        return _t.includes(_want);
      });
    })()`;
  }

  // CSS selector
  return `(() => {
${HELPER_JS}
    return __gDeepQueryAll(${JSON.stringify(selector)});
  })()`;
}

module.exports = { getElementSelector, getElementSelectorAll, parseContains };
