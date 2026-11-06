// Starts the exported web page. This file is pasted into the page after reveal.js and the presentation's runtime, as the last part
// of one script; it is not a module of the app, and it expects these names to be there: `Reveal`, `config`, `stepfx`, `fx`, `transitions`,
// `morph` and `chrome` (the runtime files, each as an object of what it exports). The page holds the slides as markup, with a layer for
// each step of a slide that has steps, a few facts in `#ks-data`, and the pictures in it, once each.

var data = JSON.parse(document.getElementById("ks-data").textContent);
var root = document.querySelector(".ks-show");
var params = new URLSearchParams(location.search);

// The pictures are in the data once each, and set where the markup names them.
document.querySelectorAll("[data-ks-img]").forEach(function (image) {
  image.src = data.images[Number(image.getAttribute("data-ks-img"))] || "";
});

/** The slide as one page, with its notes under it: what `?view=scroll` shows. */
function showScroll() {
  root.hidden = true;
  var page = document.createElement("div");
  page.className = "ks-show-scroll";
  var head = document.createElement("header");
  head.className = "ks-show-scroll-head";
  head.innerHTML = "<h1></h1><p></p>";
  head.querySelector("h1").textContent = data.title;
  head.querySelector("p").textContent = data.count === 1 ? "1 slide" : data.count + " slides";
  page.append(head);
  var frames = [];
  data.slides.forEach(function (entry) {
    var section = document.querySelector('.slides section[data-slide="' + CSS.escape(entry.id) + '"]');
    if (!section) return;
    var layers = section.querySelectorAll(":scope > .ks-show-layer");
    var last = layers[layers.length - 1];
    if (!last) return;
    var article = document.createElement("article");
    article.className = "ks-show-scroll-item";
    var label = document.createElement("h2");
    label.className = "ks-show-scroll-label";
    label.textContent = "Slide " + entry.number;
    if (entry.backup) {
      var badge = document.createElement("span");
      badge.className = "ks-show-scroll-badge";
      badge.textContent = "Backup";
      label.append(badge);
    }
    var frame = document.createElement("div");
    frame.className = "ks-show-scroll-frame";
    frame.style.aspectRatio = data.size.w + " / " + data.size.h;
    var inner = document.createElement("div");
    inner.className = "ks-show-scroll-slide";
    inner.style.width = data.size.w + "px";
    inner.style.height = data.size.h + "px";
    var copy = last.firstElementChild.cloneNode(true);
    inner.append(copy);
    frame.append(inner);
    frames.push([frame, inner]);
    article.append(label, frame);
    var notes = section.querySelector(":scope > .ks-show-notes-store");
    if (notes && notes.firstElementChild) article.append(notes.firstElementChild.cloneNode(true));
    page.append(article);
  });
  document.body.append(page);
  function fit() {
    frames.forEach(function (pair) {
      var width = pair[0].clientWidth;
      pair[1].style.transform = "scale(" + (width > 0 ? width / data.size.w : 1) + ")";
    });
  }
  fit();
  if (typeof ResizeObserver === "function") new ResizeObserver(fit).observe(document.body);
  else addEventListener("resize", fit);
}

/** The presentation itself. */
function startShow() {
  var reveal = new Reveal(root.querySelector(".ks-show-reveal"), config.revealConfig(data.size, { autoAnimateMatcher: morph.matchSlides, loop: data.loop === true, autoSlide: data.autoAdvance > 0 ? Math.round(data.autoAdvance * 1000) : 0 }));
  var trackers = new WeakMap();

  /** The effects a slide names for its steps (see `data.slides`), or none. */
  function planOf(section) {
    var id = section.getAttribute("data-slide");
    var found = data.slides.find(function (entry) { return entry.id === id; });
    return found ? found.fx : null;
  }

  // A slide with steps holds a layer for each, and shows the one for the steps taken: reveal.js counts the steps as fragments.
  function trackerOf(section) {
    var known = trackers.get(section);
    if (!known) {
      var paragraphKey = function (paragraph) {
        var holder = paragraph.closest("[data-el]");
        var all = holder ? holder.querySelectorAll(".ks-p") : [];
        return (holder ? holder.getAttribute("data-el") : "") + ":" + Array.prototype.indexOf.call(all, paragraph);
      };
      known = {
        elements: stepfx.newcomers(function (element) { return element.getAttribute("data-el") + (element.classList.contains("ks-highlight") ? "*" : ""); }),
        paragraphs: stepfx.uncovered(paragraphKey),
        // The effects the slide names for its steps, played in place of the deck's usual one.
        fx: fx.fxPlayer(planOf(section)),
      };
      trackers.set(section, known);
    }
    return known;
  }
  function showLayers(play) {
    reveal.getSlides().forEach(function (section) {
      var layers = section.querySelectorAll(":scope > .ks-show-layer");
      if (layers.length === 0) return;
      var step = Math.min(section.querySelectorAll(":scope > .fragment.visible").length, layers.length - 1);
      layers.forEach(function (layer, at) {
        layer.hidden = at !== step;
      });
      var layer = layers[step];
      var entering = trackerOf(section).elements(Array.prototype.slice.call(layer.querySelectorAll(".ks-slide [data-el]:not([data-master]), .ks-slide .ks-highlight")));
      entering = entering.concat(trackerOf(section).paragraphs(Array.prototype.slice.call(layer.querySelectorAll(".ks-slide .ks-p"))));
      var live = play && layers.length > 1 && section.classList.contains("present");
      var named = trackerOf(section).fx.play(Array.prototype.slice.call(layer.querySelectorAll(".ks-slide [data-el]:not([data-master])")), layer.querySelector(".ks-slide"), step, live);
      entering = entering.filter(function (node) { return !named.has(node.getAttribute("data-el") || ""); });
      if (live) stepfx.playEnter(entering, data.effect, stepfx.EFFECT_SECONDS);
    });
  }

  // The embedded web pages of the slide on view come alive when there is a network: the frame is given its address and shows once it has
  // loaded. Offline (or for a player that refuses a page opened from a file) the still under it stays, and it links to the page. A page
  // that refuses to be framed cannot be told from here: its error page would show, so those sites are the app's to warn about.
  function wake() {
    var current = reveal.getCurrentSlide();
    if (!current || navigator.onLine === false) return;
    current.querySelectorAll(":scope > .ks-show-layer:not([hidden]) iframe[data-ks-live]").forEach(function (frame) {
      if (frame.getAttribute("src")) return;
      if (location.protocol === "file:" && frame.hasAttribute("data-ks-needs-address")) return;
      frame.addEventListener("load", function () {
        frame.style.opacity = "1";
        frame.style.pointerEvents = "auto";
      });
      frame.src = frame.getAttribute("data-ks-live");
    });
  }

  ["slidechanged", "fragmentshown", "fragmenthidden", "sync"].forEach(function (type) {
    reveal.on(type, function () {
      showLayers(type !== "sync");
      wake();
    });
  });
  addEventListener("online", wake);
  reveal.on("autoanimate", morph.animateMorph);
  // The transitions reveal.js has no name for (push, wipe, cover ...): reveal.js cuts and these play over the cut.
  reveal.on("slidechanged", transitions.transitionListener());
  reveal.initialize().then(function () {
    showLayers(false);
    wake();
    var host = root.querySelector(".ks-show-chrome");
    chrome.attachChrome(reveal, host, {
      locate: function (number) {
        var found = data.slides.find(function (entry) { return entry.number === Math.min(Math.max(Math.trunc(number) || 1, 1), data.count); });
        return found ? [found.h, found.v] : null;
      },
      fullscreenTarget: root,
    });
  });
  return reveal;
}

if (params.get("view") === "scroll") showScroll();
else startShow();
