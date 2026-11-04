import { checkExamples } from "../examples.ts";
import rule from "./no-script-motion.ts";

checkExamples("no-script-motion", rule, [
  { name: "M01", code: "el.animate([], 200);", reports: [["el.animate", 1]] },
  {
    name: "M02",
    code: "el['animate']([], 200); el[`animate`]([], 200);",
    reports: [
      ["el['animate']", 1],
      ["el[`animate`]", 25],
    ],
  },
  { name: "M03", code: "el?.animate?.([], 200);", reports: [["el?.animate", 1]] },
  { name: "M04", code: "const { animate } = el;", reports: [["animate", 9]] },
  { name: "M05", code: "Element.prototype.animate.call(el, [], 200);", reports: [["Element.prototype.animate", 1]] },
  { name: "M06", code: "new Animation(effect).play();", reports: [["Animation", 5]] },
  { name: "M07", code: "new KeyframeEffect(el, [], 200);", reports: [["KeyframeEffect", 5]] },
  {
    name: "M08",
    code: "new DocumentTimeline(); new ScrollTimeline({ source: el }); new ViewTimeline({ subject: el });",
    reports: [
      ["DocumentTimeline", 5],
      ["ScrollTimeline", 29],
      ["ViewTimeline", 65],
    ],
  },
  { name: "M09", code: "const Effect = KeyframeEffect; new Effect(el, [], 200);", reports: [["KeyframeEffect", 16]] },
  { name: "M10", code: "new window.ScrollTimeline({ source: el });", reports: [["window.ScrollTimeline", 5]] },
  {
    name: "M11",
    code: "new globalThis['ViewTimeline']({ subject: el }); new self.Animation();",
    reports: [
      ["globalThis['ViewTimeline']", 5],
      ["self.Animation", 54],
    ],
  },
  { name: "M12", code: "const { KeyframeEffect: Effect } = window;", reports: [["KeyframeEffect: Effect", 9]] },
  { name: "M13", code: "class Fade extends Animation {}", reports: [["Animation", 20]] },
  { name: "M14", code: "Reflect.construct(Animation, [effect]);", reports: [["Animation", 19]] },
  { name: "M15", code: "let effect: KeyframeEffect; type Clock = typeof DocumentTimeline; function play(a: Animation): ScrollTimeline {}" },
  { name: "M15b", code: "class Player implements Animation {} interface Clock extends ViewTimeline {} let a: globalThis.Animation;" },
  { name: "M16", code: "function play(Animation: Player) { new Animation(); }" },
  { name: "M17", code: "import { KeyframeEffect } from 'motion'; new KeyframeEffect();" },
  { name: "M18", code: "const window = frame; new window.Animation(); const { Animation } = props;" },
  { name: "M19", code: "const motion = { animate: true, Animation: 1 }; el.getAnimations(); animation.play(); store.Animation;" },
  { name: "M20", code: "const view = <svg><animate dur='1s' /></svg>;", reports: [["<animate dur='1s' />", 19]], tsx: true },
  {
    name: "M21",
    code: "const view = <svg><animateMotion /><animateTransform /></svg>;",
    reports: [
      ["<animateMotion />", 19],
      ["<animateTransform />", 36],
    ],
    tsx: true,
  },
  { name: "M22", code: "const view = <svg><set to='1' /><Animate /></svg>;", reports: [["<set to='1' />", 19]], tsx: true },
  {
    name: "M23",
    code: "document.createElementNS(SVG, 'animateTransform');",
    reports: [["document.createElementNS(SVG, 'animateTransform')", 1]],
  },
  { name: "M24", code: "document.createElementNS(SVG, 'rect'); document.createElement('animate');" },
  {
    name: "M25",
    code: "el.scrollIntoView({ behavior: 'smooth' }); scrollTo({ top: 0, 'behavior': 'smooth' });",
    reports: [
      ["behavior: 'smooth'", 21],
      ["'behavior': 'smooth'", 63],
    ],
  },
  {
    name: "M26",
    code: "el.scrollIntoView({ behavior: 'auto', block: 'nearest' }); scrollTo({ behavior: 'instant' }); const look = { smooth: 'behavior' }; const { behavior } = options;",
  },
  {
    name: "M27",
    code: "scrollTo({ behavior: 'smooth' as ScrollBehavior }); el.scrollIntoView({ behavior: `smooth` });",
    reports: [
      ["behavior: 'smooth' as ScrollBehavior", 12],
      ["behavior: `smooth`", 73],
    ],
  },
  {
    name: "M28",
    code: "el.scroll({ behavior: 'smooth' satisfies ScrollBehavior }); el.scrollBy({ behavior: 'smooth' as const });",
    reports: [
      ["behavior: 'smooth' satisfies ScrollBehavior", 13],
      ["behavior: 'smooth' as const", 75],
    ],
  },
  {
    name: "M29",
    code: "const behavior = 'smooth'; el.scrollIntoView({ behavior }); const options: ScrollIntoViewOptions = { behavior: mode };",
    reports: [
      ["behavior", 48],
      ["behavior: mode", 102],
    ],
  },
  {
    name: "M30",
    code: "el.scrollIntoView({ behavior: r ? 'auto' : 'smooth' }); el.scrollIntoView({ behavior: 'auto' as ScrollBehavior });",
    reports: [
      ["behavior: r ? 'auto' : 'smooth'", 21],
      ["behavior: 'auto' as ScrollBehavior", 77],
    ],
  },
  {
    name: "M31",
    code: "options.behavior = 'smooth'; options['behavior'] = mode; options.behavior = 'instant';",
    reports: [
      ["options.behavior = 'smooth'", 1],
      ["options['behavior'] = mode", 30],
    ],
  },
  {
    name: "M32",
    code: "effect.updateTiming({ duration: 200 }); el.getAnimations()[0]?.effect?.updateTiming({ delay: 0 }); const { updateTiming } = effect;",
    reports: [
      ["effect.updateTiming", 1],
      ["el.getAnimations()[0]?.effect?.updateTiming", 41],
      ["updateTiming", 108],
    ],
  },
  {
    name: "M33",
    code: "document.startViewTransition(() => update()); document.startViewTransition?.({ update });",
    reports: [
      ["document.startViewTransition", 1],
      ["document.startViewTransition", 47],
    ],
  },
  {
    name: "M34",
    code: "let A; ({ Animation: A } = window); function f({ KeyframeEffect: E } = globalThis) {}",
    reports: [
      ["Animation: A", 11],
      ["KeyframeEffect: E", 50],
    ],
  },
  { name: "M35", code: "const o = { Animation };", reports: [["Animation", 13]] },
  {
    name: "M36",
    code: "document.createElementNS(SVG, 'set'); document.createElementNS(SVG, 'discard');",
    reports: [
      ["document.createElementNS(SVG, 'set')", 1],
      ["document.createElementNS(SVG, 'discard')", 39],
    ],
  },
  { name: "M37", code: "const view = <svg><discard begin='1s' /></svg>;", reports: [["<discard begin='1s' />", 19]], tsx: true },
]);
