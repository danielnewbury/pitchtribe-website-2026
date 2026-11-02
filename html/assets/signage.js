// Clubhouse TV demo: rotates through the four screen types and lets
// visitors pick one. Auto-rotation is skipped for reduced-motion users
// and paused while the demo is hovered/focused or off-screen.
(function () {
  const demo = document.querySelector(".sg-demo");
  if (!demo) return;

  const slides = Array.from(demo.querySelectorAll("[data-slide]"));
  const tabs = Array.from(demo.querySelectorAll(".sg-tab"));
  const SLIDE_MS = 5000;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let index = 0;
  let timer = null;
  let paused = false;
  let visible = true;

  demo.style.setProperty("--slide-ms", SLIDE_MS + "ms");

  function show(i) {
    index = (i + slides.length) % slides.length;
    const name = slides[index].dataset.slide;
    slides.forEach((s) => s.classList.toggle("is-active", s.dataset.slide === name));
    tabs.forEach((t) => {
      const on = t.dataset.target === name;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-pressed", String(on));
      // Restart the progress bar animation on the active tab.
      if (on) {
        t.classList.remove("is-active");
        void t.offsetWidth;
        t.classList.add("is-active");
      }
    });
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    demo.classList.remove("is-playing");
  }

  function play() {
    stop();
    if (reduceMotion || paused || !visible) return;
    demo.classList.add("is-playing");
    timer = setInterval(() => show(index + 1), SLIDE_MS);
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      show(slides.findIndex((s) => s.dataset.slide === tab.dataset.target));
      play();
    });
  });

  demo.addEventListener("mouseenter", () => { paused = true; stop(); });
  demo.addEventListener("mouseleave", () => { paused = false; play(); });
  demo.addEventListener("focusin", () => { paused = true; stop(); });
  demo.addEventListener("focusout", (e) => {
    if (!demo.contains(e.relatedTarget)) { paused = false; play(); }
  });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      visible ? play() : stop();
    }).observe(demo);
  }

  document.addEventListener("visibilitychange", () => {
    document.hidden ? stop() : play();
  });

  show(0);
  play();
})();
