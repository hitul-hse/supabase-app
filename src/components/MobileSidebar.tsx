"use client";

/**
 * MobileSidebar — client shell that owns the open/close state for the mobile
 * bottom sheet. Renders the title bar, a backdrop and the sheet, and mounts the
 * tab bar that opens it. Used exclusively on small screens (hidden on lg+). The
 * actual nav content is passed as children so the server-side Sidebar async
 * component can keep fetching user/role data.
 *
 * THE SHEET IS A REAL DRAG SURFACE NOW. It used to be a CSS
 * `transition-transform duration-300` with a grab handle painted on top -- a
 * handle that promised a gesture the sheet could not perform, which the
 * honest-chrome rule this codebase holds its bell and its badges to does not
 * allow. So the handle drags: the thumb owns the sheet 1:1 after 10 px of
 * hysteresis, the backdrop dims in step with the sheet's position, and on
 * release the sheet goes where the gesture was HEADING (velocity projected
 * forward, Apple's decelerationRate arithmetic) rather than where the finger
 * happened to be. The spring that finishes the move starts at the release
 * velocity, so there is no seam between dragging and animating (APPLE_REF
 * §6.1 #4, §6.2 "Mobile sheet drag / release").
 *
 * `y` IS THE ONE POSITION VALUE, and it is driven IMPERATIVELY, not by an
 * `animate` prop. Three reasons, all measured on the previous build:
 *
 *   - A declarative re-target reads the value's own velocity, and a
 *     MotionValue forgets it 30 ms after the last update -- a React commit
 *     after pointer-up is often later than that, so the spring restarted
 *     from rest. The release velocity is now handed over explicitly.
 *   - The springs used to be written as `bounce` + `visualDuration`, a form
 *     motion-dom zeroes velocity for (see animations/springs.ts). They are
 *     physics springs now, so the value handed over is the value used.
 *   - A flick and a slow release need DIFFERENT springs (§6.2: bounce 0.15
 *     only after a flick, bounce 0 otherwise) -- a prop can carry only one.
 *
 * A CLOSING SHEET CAN BE GRABBED. `inert`, `aria-hidden` and pointer-events
 * used to flip the instant `open` became false, so the sheet was untouchable
 * for the whole exit -- the canonical interruptibility failure (apple-design
 * §3: "A closing modal the user grabs again should follow the finger"). They
 * now follow `offstage`, which is read off `y` itself: the sheet is "gone"
 * only once its top edge is within 2 px of the bottom of the viewport, in
 * whichever direction it is travelling. Off-screen still means out of the
 * tab order and the accessibility tree (check-mobile-sheet reads that state).
 *
 * Only the handle strip starts a drag (`dragListener={false}` + drag
 * controls). The nav list below it scrolls, and a sheet that hijacked every
 * vertical pan would make a long nav unscrollable.
 *
 * Reduce Motion (§6.2): open and close are a 150 ms opacity fade with the
 * transform snapped; a drag still tracks 1:1 and settles on the bounce-0
 * spring, because a gesture the person is making is not motion imposed on
 * them. The imperative `animate()` calls bypass `MotionConfig`, so the
 * branch is explicit here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type PanInfo,
  type Transition,
} from "framer-motion";
import { MobileTabBar } from "./MobileTabBar";
import { BrandMark } from "./BrandMark";
import { SPRING_FLICK, SPRING_MOVE } from "./animations/springs";

interface MobileSidebarProps {
  children: React.ReactNode;
  /** Role key, for filtering the bottom tab bar the same way the sidebar is
   *  filtered. Resolved server-side in the layout. */
  roleKey?: string | null;
}

/*
 * Where a flick would come to rest if nothing stopped it. Apple's projection
 * from Designing Fluid Interfaces: exponential decay, not the textbook
 * v²/2a. 0.998 is the normal scroll deceleration rate.
 */
function project(velocityPxPerSecond: number, decelerationRate = 0.998): number {
  return ((velocityPxPerSecond / 1000) * decelerationRate) / (1 - decelerationRate);
}

/* Before the sheet has been measured it parks well below any phone's edge. */
const OFFSTAGE = 2000;

/*
 * A release faster than this is a flick: the velocity SIGN decides the
 * outcome and the settle spring may carry a little bounce (§6.2). Slower, and
 * the projected resting position decides against the 40% line. 200 px/s is
 * well above the jitter of a thumb coming to rest (measured ~0-60 px/s).
 */
const FLICK = 200;

/* Apple's "usually 10 points" of hysteresis before a drag commits (§6.1 #1). */
const DRAG_THRESHOLD = 10;

/*
 * "Gone" is the top edge within this many px of the viewport's bottom edge --
 * the same 2 px check-mobile-sheet uses for "displaced". Not 0: the spring's
 * rest thresholds leave it a fraction of a pixel short for ~100 ms, and inert
 * would otherwise wait on that.
 */
const OFFSTAGE_SLACK = 2;

const REDUCED_FADE: Transition = { duration: 0.15 };

/* MobileSidebarToggle (the top-left hamburger) was deleted with the bottom tab
   bar, not merely unmounted: it had one caller, and leaving an exported
   component nobody renders invites somebody to put it back beside the tab bar
   — two controls, opposite corners, opening the same drawer. "More" is the one
   way in now. */

export function MobileSidebarDrawer({ children, roleKey = null }: MobileSidebarProps) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(OFFSTAGE);
  // The same number for the event handlers, which must not close over a
  // render's `height` (a stale closure would park the sheet at the old edge).
  const heightRef = useRef(OFFSTAGE);
  const y = useMotionValue(OFFSTAGE);
  // 1 except under Reduce Motion, where it carries the 150 ms fade.
  const opacity = useMotionValue(1);
  const dragControls = useDragControls();
  const reduceMotion = useReducedMotion();

  /*
    Off-screen, as read from the sheet's own position. `inert`, `aria-hidden`
    and pointer-events follow this, never `open`, so a sheet that is still on
    screen -- opening, closing, or held -- can always be touched, and a sheet
    that has left the viewport is out of the tab order and the a11y tree.
  */
  const [offstage, setOffstage] = useState(true);
  useMotionValueEvent(y, "change", (v) => {
    const off = v >= heightRef.current - OFFSTAGE_SLACK;
    setOffstage((prev) => (prev === off ? prev : off));
  });

  /*
    Set by a drag release that also flips `open`: the release has ALREADY
    started the spring (from the finger's position and velocity, on the same
    frame), so the effect below must not start a second one when the state
    lands a render later. Measured without this: one dead frame between the
    thumb lifting and the sheet moving -- the seam the hand-off exists to
    remove.
  */
  const releasedByDrag = useRef(false);

  // Close on route change (pathname shift detected via popstate / pushstate)
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, []);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  /*
    The sheet's own height is the closed position (y = height parks its top
    edge exactly on the bottom of the viewport) and the denominator of the
    backdrop's dimming. Measured, because 72svh is only known once laid out.
  */
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.offsetHeight || OFFSTAGE;
      heightRef.current = h;
      setHeight(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The backdrop follows the sheet 1:1 -- while dragging, while springing --
  // and shares its fade under Reduce Motion, so the two never disagree.
  const backdropOpacity = useTransform(
    [y, opacity],
    ([yv, o]: number[]) => o * Math.max(0, Math.min(1, 1 - yv / height)),
  );

  /*
    `open` drives `y`. A spring from wherever the sheet is (the presentation
    value -- framer starts from the MotionValue's current value, never the
    target) to its edge or its rest, carrying the value's velocity or the
    one a drag release handed over. Stopping the previous animation on
    cleanup is what makes a second tap mid-flight re-target instead of
    racing two springs.
  */
  useEffect(() => {
    if (releasedByDrag.current) {
      releasedByDrag.current = false;
      return;
    }
    const target = open ? 0 : height;
    if (reduceMotion) {
      if (open) {
        y.set(0);
        opacity.set(0);
        const fade = animate(opacity, 1, REDUCED_FADE);
        return () => fade.stop();
      }
      // Fade first, then park it -- the other order fades an empty viewport.
      const fade = animate(opacity, 0, { ...REDUCED_FADE, onComplete: () => y.set(target) });
      return () => fade.stop();
    }
    opacity.set(1);
    // Already past the closed line (first mount before measuring, a
    // re-measure while shut): nothing to travel, so nothing to animate.
    if (!open && y.get() >= target) {
      y.set(target);
      return;
    }
    const controls = animate(y, target, SPRING_MOVE);
    return () => controls.stop();
  }, [open, height, reduceMotion, y, opacity]);

  const onDragEnd = useCallback(
    (_e: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
      const v = info.velocity.y;
      const flick = Math.abs(v) > FLICK;
      // A flick's SIGN decides; only a slow release falls back to the
      // projected resting position against the 40% line.
      const dismiss = flick ? v > 0 : y.get() + project(v) > 0.4 * heightRef.current;
      // The spring starts at the finger's velocity -- the hand-off. Bounce
      // only after a flick, and never under Reduce Motion.
      const transition: Transition = {
        ...(flick && !reduceMotion ? SPRING_FLICK : SPRING_MOVE),
        velocity: v,
      };
      // The spring starts NOW, on the release frame, from the presentation
      // value -- not a render later. Dismissing an open sheet, or catching a
      // closing one and throwing it back up, also flips `open`; the effect
      // above is told to leave the running spring alone.
      animate(y, dismiss ? heightRef.current : 0, transition);
      if (dismiss === open) {
        releasedByDrag.current = true;
        setOpen(!dismiss);
      }
    },
    [open, reduceMotion, y],
  );

  return (
    <>
      {/*
        Mobile top bar. The hamburger is GONE from it: the bottom tab bar now
        owns navigation, and two controls opening the same drawer from opposite
        corners is a second way to do one thing. What is left is a title bar —
        it still says where you are, and `pt-12` in the layout already reserves
        its space.

        pt-[env(safe-area-inset-top)] for the notch: without it the title sits
        under the status bar in a home-screen/standalone context.
      */}
      <div className="fixed top-0 left-0 right-0 z-30 flex h-12 items-center gap-2.5 border-b border-[var(--border)] bg-[var(--sidebar)] px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        {/*
          THE MARK, not just the words. Below `lg` the sidebar is a drawer and
          the desktop lockup never renders, so before this the signed-in app
          had NO logo anywhere on a phone: the animated 96px mark lives on the
          LOGIN page only, which meant the brand appeared once, at the moment
          you leave it behind.

          STATIC, per BrandMark's frequency tier. This bar is on screen on
          every page all day; an assemble animation here would replay on every
          navigation. 22px because the bar is 48px tall and the mark has to sit
          on the cap-height of the wordmark beside it, not tower over it.
        */}
        <BrandMark size={22} className="flex-none" />
        <span className="t-headline tracking-[0.02em] text-[var(--text-primary)]">
          HSE HUB
        </span>
      </div>

      {/*
        Backdrop: the M5 scrim, a dim and nothing else (APPLE_REF §4.2). The
        glass is the SHEET's -- `.surface-translucent` blurs what is behind the
        sheet, bounded to the sheet -- so the page behind it is out of focus
        exactly where the sheet is and sharp where it is not, which is what a
        pane in front of a page looks like. A blur on the backdrop as well
        would be glass on glass (§4.2 rule 1) and, measured, a full-viewport
        filter re-rendered on every frame the sheet moves. `.scrim` is
        --scrim at 0.5 on dark and the page ink at 0.35 on light, with the
        reduced-transparency and increased-contrast fallbacks in one place.

        Its opacity is the sheet's position, not a transition of its own: dragging
        the sheet halfway dims the page halfway, and there is no moment where the
        two disagree.
      */}
      <motion.div
        className={`scrim fixed inset-0 z-40 lg:hidden ${
          open ? "" : "pointer-events-none"
        }`}
        style={{ opacity: backdropOpacity }}
        onClick={() => setOpen(false)}
        aria-hidden
      />

      {/*
        AN EDGE-ANCHORED BOTTOM SHEET. Not a floating card, and not a
        full-height side slab.

        WHY IT IS NO LONGER DETACHED. The previous version was `mx-2`, rounded
        on all four corners at 28px, hovering 84px off the bottom edge: a
        ~374x520 rounded rectangle sitting in the middle of a 390x844 screen
        with page visible above, below and either side of it. That is a
        free-floating widget, which is exactly the shape the floating PILL was
        reworked away from -- and at this size it is far more of one, because a
        58px pill reads as a control while a 520px card reads as a second
        window.

        The pill can float because it is small, permanent, and has nothing to
        anchor to. A sheet is the opposite: it is large, temporary, and rises
        from the edge you tapped. Every phone OS anchors them (iOS action
        sheets, Android Material bottom sheets) for a reason -- an edge contact
        is what tells the eye "this came from there and goes back there",
        which is the whole grammar of a sheet. Floating it clear of the edge
        removes the one cue that makes the gesture legible.

        So: `inset-x-0 bottom-0`, no side margin, only the TOP two corners
        rounded. It meets three edges of the screen and has exactly one visible
        boundary, the top -- where the grab handle is.

        IT COVERS THE TAB BAR, deliberately, and that is the standard
        behaviour rather than a compromise. The bar is z-30, the sheet z-50.
        The backdrop, the close button and the drag are the ways out.

        border-t only. A hairline on the left, right and bottom edges of a
        panel that is flush to those edges renders as a stray line against the
        screen border, and on the bottom edge it sits under the home
        indicator.

        THE GLASS IS STILL THE TAB BAR'S, by reuse: surface-translucent carries
        the gradient, the 28px blur at 180% saturation, the @supports guard and
        the prefers-reduced-transparency fallback. Matching by REUSE rather
        than by eye means a future change to the glass reaches both surfaces,
        and the alpha stays the measured 4.5-contrast floor rather than a
        second, unmeasured value.

        max-h-[72svh] and svh, not vh. On mobile Safari 100vh is the LARGEST
        viewport -- it excludes the browser chrome that is on screen when you
        open a sheet -- so a vh-sized panel is taller than the space it has and
        its last row hides behind the URL bar. svh is the small viewport, the
        honest one. 72% leaves the page visibly alive above the sheet, which is
        what tells you this is a layer and not a new page.

        `y` is the ONE position value: the spring animates it, the drag moves
        it, the backdrop reads it, `offstage` is derived from it. Closed = its
        own height, so its top edge sits on the bottom of the viewport and
        nothing is left hit-testable over the pill.
      */}
      <motion.div
        ref={sheetRef}
        data-testid="mobile-sheet"
        className={`surface-translucent card-elev-raised fixed inset-x-0 bottom-0 z-50 flex max-h-[72svh] flex-col overflow-hidden rounded-t-[28px] border-t border-[var(--glass-edge)] lg:hidden ${
          offstage ? "pointer-events-none" : ""
        }`}
        style={{ y, opacity }}
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        /*
          Above its resting pose it rubber-bands at 0.55 (APPLE_REF §6.1 #5,
          §6.2): framer's elastic factor is linear where Apple's curve
          saturates, and the two agree to within 10% for the first 100 px of
          over-drag, which is all a thumb does. Downward it follows the thumb
          all the way, because that is the dismissal.
        */
        dragConstraints={{ top: 0 }}
        dragElastic={{ top: 0.55, bottom: 1 }}
        dragMomentum={false}
        onDragEnd={onDragEnd}
        /*
          aria-hidden + inert + pointer-events-none once OFF-SCREEN -- not
          once `open` is false. Being off-screen is not the same as being out
          of the accessibility tree: a keyboard or screen-reader user could
          still tab into a panel that is not visible, land on nine nav links,
          and have no idea where focus went. inert removes it from the tab
          order AND the a11y tree. But a sheet that is still on screen, on its
          way out, is a thing a thumb can catch -- so none of the three apply
          until its top edge has reached the bottom of the viewport.
        */
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        aria-hidden={offstage}
        inert={offstage}
      >
        {/*
          The grab handle, and the strip around it is the drag surface: a full-
          width, 36px-tall target the thumb can find without looking. It is not
          decoration any more -- it is the affordance that says "this panel came
          from the bottom edge and goes back there", and now it does exactly
          that. aria-hidden because it says nothing a screen reader needs -- the
          close button below is the real, named control.
        */}
        <div
          aria-hidden
          className="flex cursor-grab touch-none select-none justify-center pt-2.5 pb-3 active:cursor-grabbing"
          onPointerDown={(e) => {
            // preventDefault stops the browser starting a text selection or a
            // native drag under the moving pointer -- either of which fires
            // pointercancel and kills the second drag (measured: the first
            // drag worked, every later one died on pointercancel).
            e.preventDefault();
            // Touching the handle of a MOVING sheet catches it: the pan
            // session stops the running spring and tracks from the
            // presentation value. 10 px of travel before it commits, so a
            // tap on the handle is still a tap.
            dragControls.start(e, { distanceThreshold: DRAG_THRESHOLD });
          }}
        >
          <div className="h-1 w-9 rounded-full bg-[var(--text-faint)] opacity-40" />
        </div>
        {/*
          44x44, up from 28x28. The old close button was a 7x7 Tailwind box: 28px,
          well under the 44px minimum this codebase already holds its tab targets
          to, and placed in the corner a thumb reaches last. Same glyph, honest
          target, and it keeps its accessible name.
        */}
        <button
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
          className="absolute top-1.5 right-2 flex h-11 w-11 items-center justify-center rounded-full text-[var(--text-faint)] transition-[color,transform] duration-150 hover:text-[var(--text-primary)] active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        {/*
          h-full became min-h-0 + flex-1. Inside a flex column with a max height,
          h-full resolves against the PARENT's full height rather than the space
          left after the handle, so the list overflowed past the sheet's rounded
          bottom instead of scrolling within it.

          pb-[env(safe-area-inset-bottom)] is REQUIRED now and was not before.
          While the sheet floated 84px up, the inset was already cleared by the
          offset; flush to the bottom edge, the last nav row would sit under the
          home indicator on every notched iPhone. Plus 8px so the final row is
          not touching the screen edge.
        */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(8px+env(safe-area-inset-bottom))]"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      </motion.div>

      {/*
        The bottom tab bar. Rendered here rather than in the layout because the
        drawer's open state lives in this component and the "More" tab both
        opens it and reflects it — lifting that state into the server layout is
        not possible, and duplicating it would let the bar say "closed" while
        the drawer is open.
      */}
      <MobileTabBar roleKey={roleKey} moreOpen={open} onOpenMore={() => setOpen(true)} />
    </>
  );
}
