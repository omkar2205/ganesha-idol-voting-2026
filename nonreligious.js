(() => {
  const ELEPHANT_ICON = 'https://drive.google.com/thumbnail?id=1BodiuRQPzWt0wYjGOJ-dSt16JaUz3Mpg&sz=w512';
  const TARGET_SELECTOR = '.placeholder-symbol, .empty-symbol, .email-symbol';

  function makeElephantImage(className) {
    const image = document.createElement('img');
    image.src = ELEPHANT_ICON;
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.className = className;
    image.loading = 'lazy';
    image.decoding = 'async';
    return image;
  }

  function replaceSymbol(element) {
    if (!element || element.dataset.elephantized === 'true') return;

    const isEmail = element.classList.contains('email-symbol');
    const isEmpty = element.classList.contains('empty-symbol');
    const imageClass = isEmail
      ? 'elephant-ui email-elephant'
      : isEmpty
        ? 'elephant-ui empty-elephant'
        : 'elephant-ui elephant-inline';

    element.textContent = '';
    element.setAttribute('aria-hidden', 'true');
    element.appendChild(makeElephantImage(imageClass));
    element.dataset.elephantized = 'true';
  }

  function removeReligiousSymbols(root = document) {
    root.querySelectorAll(TARGET_SELECTOR).forEach(replaceSymbol);
  }

  removeReligiousSymbols();

  const observer = new MutationObserver(() => removeReligiousSymbols());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
