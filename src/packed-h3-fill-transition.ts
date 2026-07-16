import {
  LayerExtension,
  type Layer,
  type UpdateParameters
} from '@deck.gl/core';

const TRANSITION_STATE = Symbol('packedH3FillTransition');
const identity = (value: number): number => value;
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const transitionUniforms = {
  name: 'packedH3FillTransition',
  vs: `
    layout(std140) uniform packedH3FillTransitionUniforms {
      float progress;
      float opacity;
    } packedH3FillTransition;
  `,
  uniformTypes: {
    progress: 'f32',
    opacity: 'f32'
  }
} as const;

type ColorArray = Uint8Array | Uint8ClampedArray;
type ColorAttribute = {
  value: ColorArray;
  size: 4;
  type: 'unorm8';
  normalized: true;
};
type BinaryColorAttribute = {
  value?: unknown;
  normalized?: boolean;
  [key: string]: unknown;
};
type BinaryData = {
  attributes: {
    fillColors?: BinaryColorAttribute;
    fillColorsFrom?: ColorAttribute;
    [name: string]: unknown;
  };
};
type FillTransition = {
  from: ColorArray;
  to: ColorArray;
  geometry: unknown;
  startedAt: number;
  duration: number;
  scratch: Uint8Array | null;
  fromAttribute: ColorAttribute;
};
type TransitionState = {
  binaryData?: BinaryData;
  geometry?: unknown;
  [TRANSITION_STATE]?: FillTransition;
};
type TransitionProps = {
  _packedH3FillStartedAt: number;
  _packedH3FillDuration: number;
};
/** Controls packed fill-color interpolation. */
export type PackedH3FillTransitionOptions = {
  /** Transition duration in milliseconds. Defaults to 1000. */
  duration?: number;
  /** Maps linear progress from 0 to 1 to eased progress. Defaults to linear. */
  easing?: (progress: number) => number;
};
type ResolvedOptions = Required<PackedH3FillTransitionOptions>;

function transitionProgress(
  startedAt: number,
  duration: number,
  now: number,
  easing: (progress: number) => number
): {raw: number; eased: number} {
  const raw = duration > 0 ? clamp((now - startedAt) / duration) : 1;
  return {raw, eased: clamp(easing(raw))};
}

function colorAttribute(value: ColorArray): ColorAttribute {
  return {value, size: 4, type: 'unorm8', normalized: true};
}

function createTransition(
  from: ColorArray,
  to: ColorArray,
  geometry: unknown,
  startedAt: number,
  duration: number,
  scratch: Uint8Array | null = null
): FillTransition {
  return {
    from,
    to,
    geometry,
    startedAt,
    duration,
    scratch,
    fromAttribute: colorAttribute(from)
  };
}

/** Animates color-only updates made by PackedH3HexagonLayer. */
export class PackedH3FillTransition extends LayerExtension<ResolvedOptions> {
  static override extensionName = 'PackedH3FillTransition';
  static override defaultProps = {
    _packedH3FillStartedAt: 0,
    _packedH3FillDuration: 0
  };

  constructor({duration = 1000, easing = identity}: PackedH3FillTransitionOptions = {}) {
    super({
      duration: Math.max(0, Number(duration) || 0),
      easing: typeof easing === 'function' ? easing : identity
    });
  }

  override getShaders(this: Layer): {
    modules: object[];
    inject: Record<string, string>;
  } {
    return {
      modules: [transitionUniforms],
      inject: {
        'vs:#decl': `
          in vec4 fillColorsFrom;
        `,
        'vs:DECKGL_FILTER_COLOR': `
          color = mix(
            vec4(fillColorsFrom.rgb, fillColorsFrom.a * packedH3FillTransition.opacity),
            color,
            packedH3FillTransition.progress
          );
        `
      }
    };
  }

  override initializeState(this: Layer): void {
    if (this.isComposite) return;
    this.getAttributeManager()?.add({
      fillColorsFrom: {
        size: 4,
        type: 'unorm8',
        stepMode: 'dynamic',
        noAlloc: true
      }
    });
  }

  override updateState(
    this: Layer,
    params: UpdateParameters<Layer>,
    extension: PackedH3FillTransition
  ): void {
    if (!this.isComposite) return;

    // PackedH3HexagonLayer builds the target bytes before extension updates run.
    const state = this.state as TransitionState;
    const binaryData = state.binaryData;
    const targetAttribute = binaryData?.attributes?.fillColors;
    const to = targetAttribute?.value;
    const geometry = state.geometry;
    if (!binaryData || !targetAttribute ||
      !(to instanceof Uint8Array || to instanceof Uint8ClampedArray)) return;

    let transition = state[TRANSITION_STATE];
    if (!transition || (
      params.changeFlags.extensionsChanged &&
      !params.oldProps.extensions.some(previous =>
        previous instanceof PackedH3FillTransition && extension.equals(previous)
      )
    )) {
      transition = createTransition(to, to, geometry, 0, 0);
    } else if (to !== transition.to) {
      const now = this.context.timeline.getTime();
      const canInterpolate = extension.opts.duration > 0 &&
        geometry === transition.geometry &&
        to.length === transition.to.length;
      let from: ColorArray = to;
      let duration = 0;
      let scratch: Uint8Array | null = null;

      if (canInterpolate) {
        const {eased} = transitionProgress(
          transition.startedAt,
          transition.duration,
          now,
          extension.opts.easing
        );
        from = transition.to;
        if (eased < 1 && transition.from !== transition.to) {
          // Preserve continuity without mutating either package-owned endpoint.
          scratch = transition.scratch;
          if (!scratch || scratch.length !== to.length) scratch = new Uint8Array(to.length);
          for (let i = 0; i < scratch.length; i++) {
            scratch[i] = Math.round(
              transition.from[i] + (transition.to[i] - transition.from[i]) * eased
            );
          }
          from = scratch;
        }
        duration = extension.opts.duration;
      }
      transition = createTransition(from, to, geometry, duration ? now : 0, duration, scratch);
    } else if (geometry !== transition.geometry) {
      transition = createTransition(to, to, geometry, 0, 0);
    }

    state[TRANSITION_STATE] = transition;
    const fillColors = targetAttribute.normalized === true
      ? targetAttribute
      : {...targetAttribute, normalized: true};
    if (fillColors !== targetAttribute || binaryData.attributes.fillColorsFrom !== transition.fromAttribute) {
      binaryData.attributes = {
        ...binaryData.attributes,
        fillColors,
        fillColorsFrom: transition.fromAttribute
      };
    }
  }

  override getSubLayerProps(this: Layer): TransitionProps {
    const transition = (this.state as TransitionState)[TRANSITION_STATE];
    return {
      _packedH3FillStartedAt: transition?.startedAt ?? 0,
      _packedH3FillDuration: transition?.duration ?? 0
    };
  }

  override draw(
    this: Layer,
    _params: unknown,
    extension: PackedH3FillTransition
  ): void {
    const props = this.props as typeof this.props & TransitionProps;
    const {raw, eased} = transitionProgress(
      props._packedH3FillStartedAt,
      props._packedH3FillDuration,
      this.context.timeline.getTime(),
      extension.opts.easing
    );
    this.setShaderModuleProps({
      packedH3FillTransition: {
        progress: eased,
        opacity: Math.pow(this.props.opacity, 1 / 2.2)
      }
    });
    // Sublayer redraw flags are not polled, so keep the composite root drawing.
    if (raw < 1) this.root.setNeedsRedraw();
  }
}
