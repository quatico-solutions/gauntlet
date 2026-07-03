// Page-side script: token-efficient page summary used by auto-capture.
// Loaded as a string at attachCapture setup and embedded in CDP
// Runtime.evaluate. Tested directly against jsdom in
// test/lib/page-scripts/dom-summary.test.mjs.
module.exports = `
  (() => {
    // GAUNTLET DIVERGENCE #5 (ewz): shadow-piercing query - webbloqs/Lit apps render
    // everything inside open shadow roots, which document.querySelectorAll cannot see.
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
    const buttons = __gDeepQueryAll('button, input[type="button"], input[type="submit"]').length;
    const inputs = __gDeepQueryAll('input:not([type="button"]):not([type="submit"]), textarea, select').length;
    const links = __gDeepQueryAll('a[href]').length;

    const title = document.title.slice(0, 60);
    const allH1s = Array.from(__gDeepQueryAll('h1')).map(h => h.textContent.trim().slice(0, 40)).filter(Boolean);
    const h1s = allH1s.slice(0, 3);
    const h1Extra = allH1s.length > 3 ? allH1s.length - 3 : 0;

    const main = document.querySelector('main, [role="main"], .main, #main, .content, #content');
    const mainTag = main ? main.tagName.toLowerCase() + (main.id ? '#' + main.id : main.className ? '.' + main.className.split(' ')[0] : '') : 'body';

    const forms = __gDeepQueryAll('form');
    const formInfo = forms.length > 0 ? \`\${forms.length} form\${forms.length > 1 ? 's' : ''}\` : '';

    const nav = document.querySelector('nav, [role="navigation"], .nav, #nav') ? 'nav' : '';

    return [
      \`\${title}\`,
      \`Interactive: \${buttons} buttons, \${inputs} inputs, \${links} links\`,
      h1s.length > 0 ? \`Headings: \${h1s.map(h => '"' + h + '"').join(', ')}\${h1Extra > 0 ? ', and ' + h1Extra + ' more' : ''}\` : '',
      \`Layout: \${nav ? 'nav + ' : ''}\${mainTag}\${formInfo ? ' + ' + formInfo : ''}\`
    ].filter(Boolean).join('\\n');
  })()
`;
