import type {
  Accessor,
  AccessorFunction,
  Color,
  CompositeLayerProps,
  LayerData
} from '@deck.gl/core';
import type {H3IndexInput} from 'h3-js';

export type PackedH3Geometry = {
  readonly length: number;
  readonly startIndices: Uint32Array;
  readonly positions: Float64Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
};

export type PackH3GeometryOptions<DataT> = {
  getHexagon?: AccessorFunction<DataT, H3IndexInput>;
};

type PackedH3HexagonProps<DataT> = {
  data: LayerData<DataT>;
  /** Precomputed geometry in the same row order as data. */
  geometry?: PackedH3Geometry | null;
  getHexagon?: AccessorFunction<DataT, H3IndexInput>;
  getFillColor?: Accessor<DataT, Color>;
};

export type PackedH3HexagonLayerProps<DataT = unknown> = PackedH3HexagonProps<DataT> &
  Omit<CompositeLayerProps, 'data'>;
