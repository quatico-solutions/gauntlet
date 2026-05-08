const { getElementSelector } = require('./element-selector');
const { throwIfExceptionDetails } = require('./cdp-utils');

// Brief pause between the last mouseMoved step and mouseReleased so apps
// that process drag events asynchronously have time to commit.
const DRAG_SETTLE_MS = 50;

/**
 * CDP mouse actions — click, hover, drag, mouse-move, scroll, double-click,
 * right-click. Every entry resolves to real `Input.dispatchMouseEvent`
 * calls so React (and other framework) synthetic-event handlers see
 * genuine input.
 *
 * Helpers accept `tabIndexOrPageSession` (the orchestrator's
 * `getPageSession` resolver handles all shapes) and route through
 * `pageSession.send`.
 */
function attachMouse({ getPageSession }) {
  // Common helper: resolve a CSS/XPath selector to centered viewport coords
  // after scrolling the element into view. Returns { x, y } or throws.
  async function resolveCenter(ps, selector, label = 'Element') {
    const js = `
      (() => {
        const el = ${getElementSelector(selector)};
        if (!el) return { found: false };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          found: true
        };
      })()
    `;
    const result = await ps.send('Runtime.evaluate', {
      expression: js,
      returnByValue: true,
    });
    throwIfExceptionDetails(result);
    if (!result.result.value || !result.result.value.found) {
      throw new Error(`${label} not found: ${selector}`);
    }
    return { x: result.result.value.x, y: result.result.value.y };
  }

  /**
   * Click element using CDP mouse events (works with React and all frameworks).
   * Falls back to `el.click()` if CDP coordinate resolution throws (hidden
   * elements with no bounding rect).
   */
  async function click(tabIndexOrPageSession, selector) {
    const ps = await getPageSession(tabIndexOrPageSession);

    try {
      const { x, y } = await resolveCenter(ps, selector);

      await ps.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', clickCount: 1,
      });
      await ps.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
      });

      return { clicked: true, x, y };
    } catch (_e) {
      // Fallback for edge cases (e.g., hidden elements with zero bounding rect).
      const js = `${getElementSelector(selector)}?.click()`;
      const fallbackResult = await ps.send('Runtime.evaluate', { expression: js });
      throwIfExceptionDetails(fallbackResult);
      return { clicked: true, fallback: true };
    }
  }

  async function hover(tabIndexOrPageSession, selector) {
    const ps = await getPageSession(tabIndexOrPageSession);
    const { x, y } = await resolveCenter(ps, selector);

    await ps.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y,
    });

    return { hovered: true, x, y };
  }

  async function drag(tabIndexOrPageSession, sourceSelector, target, options = {}) {
    const ps = await getPageSession(tabIndexOrPageSession);
    const steps = options.steps || 8;

    const src = await resolveCenter(ps, sourceSelector, 'Source element');

    let dst;
    if (typeof target === 'object' && target.x !== undefined && target.y !== undefined) {
      dst = { x: target.x, y: target.y };
    } else {
      dst = await resolveCenter(ps, target, 'Target element');
    }

    await ps.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: src.x, y: src.y, button: 'left', clickCount: 1,
    });

    for (let i = 1; i <= steps; i++) {
      const ratio = i / steps;
      await ps.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(src.x + (dst.x - src.x) * ratio),
        y: Math.round(src.y + (dst.y - src.y) * ratio),
        button: 'left',
      });
    }

    // Brief pause for apps that process drag events asynchronously.
    await new Promise((resolve) => setTimeout(resolve, DRAG_SETTLE_MS));

    await ps.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: Math.round(dst.x),
      y: Math.round(dst.y),
      button: 'left',
      clickCount: 1,
    });

    return { dragged: true, from: { x: src.x, y: src.y }, to: { x: dst.x, y: dst.y }, steps };
  }

  async function mouseMove(tabIndexOrPageSession, x, y, options = {}) {
    const ps = await getPageSession(tabIndexOrPageSession);
    const steps = options.steps || 1;

    if (steps <= 1 || (options.fromX === undefined && options.fromY === undefined)) {
      await ps.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(x),
        y: Math.round(y),
      });
    } else {
      const startX = options.fromX || 0;
      const startY = options.fromY || 0;
      for (let i = 1; i <= steps; i++) {
        const ratio = i / steps;
        await ps.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: Math.round(startX + (x - startX) * ratio),
          y: Math.round(startY + (y - startY) * ratio),
        });
      }
    }

    return { moved: true, x, y };
  }

  async function scroll(tabIndexOrPageSession, options = {}) {
    const ps = await getPageSession(tabIndexOrPageSession);

    let x = options.x || 100;
    let y = options.y || 100;

    if (options.selector) {
      // Inline selector lookup — missing element falls back to default coords
      // instead of throwing, matching the pre-extraction scroll() behaviour.
      const js = `
        (() => {
          const el = ${getElementSelector(options.selector)};
          if (!el) return { found: false };
          const rect = el.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            found: true
          };
        })()
      `;
      const result = await ps.send('Runtime.evaluate', {
        expression: js,
        returnByValue: true,
      });
      throwIfExceptionDetails(result);
      if (result.result.value && result.result.value.found) {
        x = result.result.value.x;
        y = result.result.value.y;
      }
    }

    await ps.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: Math.round(x),
      y: Math.round(y),
      deltaX: options.deltaX || 0,
      deltaY: options.deltaY || 0,
    });

    return { scrolled: true, x, y, deltaX: options.deltaX || 0, deltaY: options.deltaY || 0 };
  }

  async function doubleClick(tabIndexOrPageSession, selector) {
    const ps = await getPageSession(tabIndexOrPageSession);
    const { x, y } = await resolveCenter(ps, selector);

    await ps.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    });
    await ps.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    });
    await ps.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 2,
    });
    await ps.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 2,
    });

    return { doubleClicked: true, x, y };
  }

  async function rightClick(tabIndexOrPageSession, selector) {
    const ps = await getPageSession(tabIndexOrPageSession);
    const { x, y } = await resolveCenter(ps, selector);

    await ps.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'right', clickCount: 1,
    });
    await ps.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'right', clickCount: 1,
    });

    return { rightClicked: true, x, y };
  }

  return { click, hover, drag, mouseMove, scroll, doubleClick, rightClick };
}

module.exports = { attachMouse };
