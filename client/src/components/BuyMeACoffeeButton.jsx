import { useEffect, useRef } from 'react';

const BMC_SCRIPT_SRC = 'https://cdnjs.buymeacoffee.com/1.0.0/button.prod.min.js';

/**
 * Buy Me a Coffee button embed.
 *
 * The official script uses document.writeln(), which is unsafe to execute dynamically in a SPA.
 * Instead we load the script (to get window.bmcBtnWidget) and then inject the generated markup
 * into a scoped container.
 */
export function BuyMeACoffeeButton({
  slug = 'semi.column',
  text = 'Buy me a coffee',
  color = '#FFDD00',
  emoji = '',
  font = 'Cookie',
  outlineColor = '#000000',
  fontColor = '#000000',
  coffeeColor = '#ffffff',
  className = '',
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;

    const render = () => {
      if (cancelled) return;
      if (!container) return;

      const widget = window.bmcBtnWidget;
      if (typeof widget !== 'function') return;

      // The widget returns a string containing <style> and <link> tags + the button markup.
      // We scope it to this component by inserting into a dedicated container.
      container.innerHTML = widget(
        text,
        slug,
        color,
        emoji,
        font,
        fontColor,
        outlineColor,
        coffeeColor
      );
    };

    const loadScript = () => {
      if (typeof window.bmcBtnWidget === 'function') return Promise.resolve();

      const existing = document.querySelector(`script[src="${BMC_SCRIPT_SRC}"]`);
      if (existing) {
        return new Promise((resolve, reject) => {
          if (typeof window.bmcBtnWidget === 'function') {
            resolve();
            return;
          }
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', reject, { once: true });
        });
      }

      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = BMC_SCRIPT_SRC;
        script.async = true;
        // Keep the official config as data-attributes for transparency/debugging.
        script.setAttribute('data-name', 'bmc-button');
        script.setAttribute('data-slug', slug);
        script.setAttribute('data-color', color);
        script.setAttribute('data-emoji', emoji);
        script.setAttribute('data-font', font);
        script.setAttribute('data-text', text);
        script.setAttribute('data-outline-color', outlineColor);
        script.setAttribute('data-font-color', fontColor);
        script.setAttribute('data-coffee-color', coffeeColor);

        script.addEventListener('load', () => resolve(), { once: true });
        script.addEventListener(
          'error',
          () => reject(new Error('Failed to load Buy Me a Coffee widget script')),
          { once: true }
        );

        document.head.appendChild(script);
      });
    };

    loadScript()
      .then(render)
      .catch(() => {
        // If the widget fails to load, we silently keep the UI clean (no broken icon).
        // The sponsor button still provides a support option.
      });

    return () => {
      cancelled = true;
      if (container) container.innerHTML = '';
    };
  }, [slug, text, color, emoji, font, outlineColor, fontColor, coffeeColor]);

  return <div ref={containerRef} className={`bmc-header-button ${className}`.trim()} />;
}
