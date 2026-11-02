(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Mobile navigation ---- */
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("primary-nav");
  if (toggle && nav) {
    const setOpen = (open) => {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  /* ---- Live clock in the display mockup ---- */
  const clock = document.querySelector("[data-clock]");
  if (clock) {
    const tick = () => {
      clock.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    };
    tick();
    setInterval(tick, 10_000);
  }

  /* ---- Display mockup tabs (auto-rotating until the user interacts) ---- */
  const tabs = Array.from(document.querySelectorAll(".scr-tab"));
  let current = 0;
  const show = (i, focus = false) => {
    current = (i + tabs.length) % tabs.length;
    tabs.forEach((tab, n) => {
      const on = n === current;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      document.getElementById(tab.getAttribute("aria-controls"))?.classList.toggle("is-active", on);
    });
    if (focus) tabs[current].focus();
  };

  let rotator = null;
  const stopRotation = () => {
    if (rotator) clearInterval(rotator);
    rotator = null;
  };
  if (tabs.length && !reduceMotion) {
    rotator = setInterval(() => show(current + 1), 4000);
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => {
      stopRotation();
      show(i);
    });
    tab.addEventListener("keydown", (e) => {
      const moves = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: tabs.length - 1 };
      if (e.key in moves) {
        e.preventDefault();
        stopRotation();
        show(moves[e.key], true);
      }
    });
  });

  /* ---- Copy install command ---- */
  const copyBtn = document.getElementById("copy-btn");
  const cmd = document.getElementById("install-cmd");
  const status = document.getElementById("copy-status");
  if (copyBtn && cmd) {
    const flash = (label) => {
      copyBtn.textContent = label;
      if (status) status.textContent = label === "Copied!" ? "Install command copied to clipboard" : "";
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
    };
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(cmd.textContent.trim());
        flash("Copied!");
      } catch {
        const range = document.createRange();
        range.selectNodeContents(cmd);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        flash("Selected");
      }
    });
  }

  /* ---- Scroll reveal ---- */
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -40px 0px" });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-in"));
  }

  /* ---- Footer year ---- */
  const year = document.querySelector("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());
})();
