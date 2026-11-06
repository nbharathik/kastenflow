import { type ComponentType, type JSX, Suspense, lazy } from "react";

/**
 * A part of the editor that is rare or big, loaded the first time it is shown (or sooner, when the page is idle). Once it is loaded it
 * is drawn like any other component, with no pause; before that a quiet gap is shown for the moment the file takes.
 */
export interface LazyPart<P extends object> {
  Part(props: P): JSX.Element;
  /** Starts loading; resolves when the part can be drawn at once. */
  preload(): Promise<void>;
}

export function lazyPart<P extends object>(load: () => Promise<ComponentType<P>>): LazyPart<P> {
  let ready: ComponentType<P> | null = null;
  let started: Promise<void> | null = null;
  const preload = (): Promise<void> =>
    (started ??= load().then((component) => {
      ready = component;
    }));
  const Waiting: ComponentType<P> = lazy(() => preload().then(() => ({ default: ready as ComponentType<P> })));
  const Part = (props: P): JSX.Element => {
    const Ready = ready;
    const given = props as P & JSX.IntrinsicAttributes;
    if (Ready) return <Ready {...given} />;
    return (
      <Suspense fallback={null}>
        <Waiting {...given} />
      </Suspense>
    );
  };
  return { Part, preload };
}
