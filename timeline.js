(() => {
  'use strict';

  document.querySelectorAll('.timeline-card').forEach((chart, index) => {
    const points = chart.querySelectorAll('.timeline-point');
    if (!points.length) return;

    const tooltip = document.createElement('div');
    tooltip.className = 'timeline-tooltip';
    tooltip.id = `timeline-tooltip-${index + 1}`;
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    document.body.append(tooltip);

    let activePoint = null;
    let hideTimer;
    let focusFrame;
    let highlightedEvent = null;
    let highlightTimer;

    const hideTooltip = () => {
      window.clearTimeout(hideTimer);
      window.cancelAnimationFrame(focusFrame);
      if (activePoint) activePoint.removeAttribute('aria-describedby');
      activePoint = null;
      tooltip.hidden = true;
    };

    const positionTooltip = () => {
      if (!activePoint) return;
      const marker = activePoint.querySelector('.timeline-marker').getBoundingClientRect();
      const viewport = chart.querySelector('.chart-scroll').getBoundingClientRect();
      if (marker.right < viewport.left || marker.left > viewport.right ||
          marker.bottom < 0 || marker.top > window.innerHeight) {
        hideTooltip();
        return;
      }
      const box = tooltip.getBoundingClientRect();
      const left = Math.max(16, Math.min(
        marker.left + marker.width / 2 - box.width / 2,
        window.innerWidth - box.width - 16
      ));
      const above = marker.top - box.height - 10;
      const top = above >= 16 ? above : Math.min(
        marker.bottom + 10, window.innerHeight - box.height - 16
      );
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(16, top)}px`;
    };

    const showTooltip = (point, target) => {
      hideTooltip();
      activePoint = point;
      tooltip.textContent = `${target.querySelector('time').textContent.trim()} — ${target.querySelector('p').textContent.trim()}`;
      tooltip.hidden = false;
      point.setAttribute('aria-describedby', tooltip.id);
      positionTooltip();
    };

    const scheduleHide = () => {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (tooltip.matches(':hover') || document.activeElement === activePoint) return;
        hideTooltip();
      }, 120);
    };

    points.forEach(point => {
      const fragment = point.getAttribute('href');
      const target = document.getElementById(fragment.slice(1));
      if (!target) return;

      point.addEventListener('pointerenter', event => {
        if (event.pointerType !== 'touch') showTooltip(point, target);
      });
      point.addEventListener('pointerleave', scheduleHide);
      point.addEventListener('focus', () => {
        hideTooltip();
        focusFrame = window.requestAnimationFrame(() => {
          if (document.activeElement !== point) return;
          // The browser's own focus scroll runs before this frame.
          point.scrollIntoView({behavior: 'instant', block: 'nearest', inline: 'nearest'});
          showTooltip(point, target);
        });
      });
      point.addEventListener('blur', scheduleHide);
      point.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
            event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        hideTooltip();

        // Retain a shareable anchor and normal browser history without a second scroll.
        if (window.location.hash !== fragment) {
          window.history.pushState(null, '', fragment);
        }
        target.focus({preventScroll: true});
        target.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
          block: 'center'
        });

        window.clearTimeout(highlightTimer);
        if (highlightedEvent) highlightedEvent.classList.remove('event-highlight');
        // Restart the fade even when the same point is selected again.
        void target.offsetWidth;
        target.classList.add('event-highlight');
        highlightedEvent = target;
        highlightTimer = window.setTimeout(() => {
          target.classList.remove('event-highlight');
          highlightedEvent = null;
        }, 3000);
      });
    });

    tooltip.addEventListener('pointerenter', () => window.clearTimeout(hideTimer));
    tooltip.addEventListener('pointerleave', scheduleHide);
    chart.querySelector('.chart-scroll').addEventListener('scroll', positionTooltip, {passive: true});
    window.addEventListener('scroll', positionTooltip, {passive: true});
    window.addEventListener('resize', hideTooltip);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') hideTooltip();
    });
  });
})();
