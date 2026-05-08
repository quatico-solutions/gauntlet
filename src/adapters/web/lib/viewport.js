// Pixel 7 UA string used for mobile emulation.
const MOBILE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/**
 * Viewport / device emulation — set, clear, and read the CDP
 * Emulation.setDeviceMetricsOverride state.
 *
 * Helpers accept `tabIndexOrPageSession` and route through
 * `pageSession.send`.
 */
function attachViewport({ getPageSession }) {
  async function setViewport(tabIndexOrPageSession, params) {
    if (!params || typeof params !== 'object') {
      throw new Error('setViewport requires a params object');
    }

    const ps = await getPageSession(tabIndexOrPageSession);

    const viewportParams = {
      width: params.width ?? 1200,
      height: params.height ?? 800,
      deviceScaleFactor: params.deviceScaleFactor !== undefined ? params.deviceScaleFactor : 1,
      mobile: params.mobile === true,
    };

    if (viewportParams.width < 320 || viewportParams.width > 7680) {
      throw new Error(`Invalid viewport width ${viewportParams.width} (must be 320-7680)`);
    }
    if (viewportParams.height < 200 || viewportParams.height > 4320) {
      throw new Error(`Invalid viewport height ${viewportParams.height} (must be 200-4320)`);
    }
    if (viewportParams.deviceScaleFactor < 0.25 || viewportParams.deviceScaleFactor > 5) {
      throw new Error(`Invalid deviceScaleFactor ${viewportParams.deviceScaleFactor} (must be 0.25-5)`);
    }

    await ps.send('Emulation.setDeviceMetricsOverride', viewportParams);

    if (viewportParams.mobile) {
      await ps.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await ps.send('Emulation.setUserAgentOverride', {
        userAgent: MOBILE_USER_AGENT,
      });
    } else {
      await ps.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await ps.send('Emulation.setUserAgentOverride', { userAgent: '' });
    }

    return { ...viewportParams, touch: viewportParams.mobile };
  }

  async function clearViewport(tabIndexOrPageSession) {
    const ps = await getPageSession(tabIndexOrPageSession);
    await ps.send('Emulation.clearDeviceMetricsOverride', {});
    await ps.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await ps.send('Emulation.setUserAgentOverride', { userAgent: '' });
  }

  async function getViewport(tabIndexOrPageSession) {
    const ps = await getPageSession(tabIndexOrPageSession);

    const result = await ps.send('Runtime.evaluate', {
      expression: `({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        devicePixelRatio: window.devicePixelRatio,
        orientation: screen.orientation ? screen.orientation.type : 'unknown'
      })`,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error(`getViewport failed: ${result.exceptionDetails.text}`);
    }
    return result.result?.value || {};
  }

  return { setViewport, clearViewport, getViewport };
}

module.exports = { attachViewport };
