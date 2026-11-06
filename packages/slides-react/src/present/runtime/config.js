// The reveal.js settings a presentation starts with, in the app and in the exported web page (which pastes
// this file in, so it has no imports). Slides are drawn by Kasten's renderer at their own size: reveal.js only
// moves between them, so its margins, centring, themes and its own text rules are all off.

/**
 * @param {{ w: number, h: number }} size the slide's size in units
 * @param {Record<string, unknown>} [extra] settings that replace these
 */
export function revealConfig(size, extra) {
  return {
    width: size.w,
    height: size.h,
    margin: 0,
    minScale: 0.05,
    maxScale: 4,
    center: false,
    // The deck lives in its own box; without this reveal.js takes over the page.
    embedded: true,
    hash: false,
    history: false,
    respondToHashChanges: false,
    fragmentInURL: false,
    controls: true,
    controlsTutorial: false,
    controlsLayout: "bottom-right",
    controlsBackArrows: "faded",
    progress: true,
    slideNumber: false,
    // Its help lists its own keys; the presentation has a list of its own (chrome.js).
    help: false,
    jumpToSlide: false,
    pause: true,
    overview: true,
    touch: true,
    keyboard: true,
    fragments: true,
    navigationMode: "default",
    // A deck's own choices (`present.loop`, `present.autoAdvance`) come in through `extra`; a plain show stops at its last slide.
    loop: false,
    rtl: false,
    mouseWheel: false,
    previewLinks: false,
    // A page inside an embed must not be able to steer the deck.
    postMessage: false,
    postMessageEvents: false,
    preventIframeAutoFocus: true,
    focusBodyOnPageVisibilityChange: false,
    hideInactiveCursor: true,
    hideCursorTime: 2000,
    transition: "none",
    transitionSpeed: "default",
    backgroundTransition: "none",
    // Slides that morph are paired by their elements' data-id (morph.js does the animating).
    autoAnimate: true,
    autoAnimateUnmatched: false,
    autoAnimateDuration: 0.6,
    autoAnimateEasing: "ease",
    autoAnimateStyles: [],
    autoPlayMedia: null,
    autoSlide: 0,
    showNotes: false,
    viewDistance: 3,
    mobileViewDistance: 2,
    display: "block",
    ...extra,
  };
}
