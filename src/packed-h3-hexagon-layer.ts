import {
  CompositeLayer,
  type Accessor,
  type AccessorContext,
  type Color,
  type GetPickingInfoParams,
  type LayerData,
  type PickingInfo,
  type UpdateParameters
} from '@deck.gl/core';
import {SolidPolygonLayer} from '@deck.gl/layers';
import type {H3IndexInput} from 'h3-js';
import {
  dataLength,
  defaultGetHexagon,
  forEachData,
  normalizeData,
  packLayerH3Geometry
} from './pack-h3-geometry.js';
import type {PackedH3Geometry, PackedH3HexagonLayerProps} from './types.js';

const DEFAULT_COLOR: Color = [0, 0, 0, 255];

const defaultProps = {
  geometry: {type: 'object', value: null, optional: true},
  getHexagon: {type: 'accessor', value: defaultGetHexagon},
  getFillColor: {type: 'accessor', value: DEFAULT_COLOR}
};

type BinaryData = {
  length: number;
  startIndices: Uint32Array;
  attributes: {
    getPolygon: {value: Float64Array; size: 2};
    indices: {value: Uint32Array; size: 1};
    fillColors: {value: Uint8Array; size: 4; type: 'unorm8'};
  };
};

type PackedState<DataT> = {
  geometry: PackedH3Geometry | null;
  data: LayerData<DataT>;
  binaryData: BinaryData | null;
};

function callAccessor<DataT, Result>(
  accessor: Accessor<DataT, Result>,
  object: DataT,
  objectInfo: AccessorContext<DataT>
): Result {
  return typeof accessor === 'function'
    ? (accessor as (object: DataT, objectInfo: AccessorContext<DataT>) => Result)(object, objectInfo)
    : accessor;
}

export function buildPackedH3FillColors<DataT>(
  data: LayerData<DataT>,
  contextData: LayerData<DataT>,
  geometry: PackedH3Geometry,
  getFillColor: Accessor<DataT, Color>
): Uint8Array {
  if (dataLength(data) !== geometry.length) {
    throw new Error(`Packed H3 geometry has ${geometry.length} cells but data has ${dataLength(data)} rows`);
  }

  const colors = new Uint8Array(geometry.vertexCount * 4);
  const colors32 = new Uint32Array(colors.buffer);
  forEachData(data, contextData, (object: DataT, objectInfo: AccessorContext<DataT>) => {
    const row = objectInfo.index;
    const start = geometry.startIndices[row];
    const end = geometry.startIndices[row + 1];
    if (start === end) return;
    const color = callAccessor(getFillColor, object, objectInfo) || DEFAULT_COLOR;
    const offset = start * 4;
    colors[offset] = color[0] ?? 0;
    colors[offset + 1] = color[1] ?? 0;
    colors[offset + 2] = color[2] ?? 0;
    colors[offset + 3] = color[3] ?? 255;
    colors32.fill(colors32[start], start + 1, end);
  });
  return colors;
}

function createBinaryData(geometry: PackedH3Geometry, fillColors: Uint8Array): BinaryData {
  return {
    length: geometry.length,
    startIndices: geometry.startIndices,
    attributes: {
      getPolygon: {value: geometry.positions, size: 2},
      indices: {value: geometry.indices, size: 1},
      fillColors: {value: fillColors, size: 4, type: 'unorm8'}
    }
  };
}

function objectAt<DataT>(data: LayerData<DataT>, index: number): DataT | undefined {
  if (index < 0) return undefined;
  if (Symbol.iterator in Object(data)) {
    let current = 0;
    for (const object of data as Iterable<DataT>) {
      if (current++ === index) return object;
    }
  }
  return undefined;
}

export default class PackedH3HexagonLayer<
  DataT = any,
  ExtraPropsT extends {} = {}
> extends CompositeLayer<ExtraPropsT & Required<PackedH3HexagonLayerProps<DataT>>> {
  static override defaultProps = defaultProps;
  static override layerName = 'PackedH3HexagonLayer';

  declare state: PackedState<DataT>;

  override initializeState(): void {
    this.state = {geometry: null, data: [], binaryData: null};
  }

  override shouldUpdateState(params: UpdateParameters<this>): boolean {
    return super.shouldUpdateState(params) ||
      params.props.getHexagon !== params.oldProps.getHexagon ||
      params.props.getFillColor !== params.oldProps.getFillColor;
  }

  override updateState({props, oldProps, changeFlags}: UpdateParameters<this>): void {
    const triggers = changeFlags.updateTriggersChanged;
    const hexagonsChanged = Boolean(triggers && (triggers.all || triggers.getHexagon));
    const colorsChanged = Boolean(triggers && (triggers.all || triggers.getFillColor));
    const dataChanged = Boolean(changeFlags.dataChanged);
    const geometryPropChanged = props.geometry !== oldProps.geometry;
    const getHexagonChanged = props.getHexagon !== oldProps.getHexagon;
    const sourceData = (dataChanged || !this.state.data)
      ? normalizeData(props.data as LayerData<DataT>)
      : this.state.data;

    let geometry = this.state.geometry;
    let geometryChanged = geometryPropChanged;
    if (props.geometry) {
      geometry = props.geometry;
    } else if (!geometry || geometryPropChanged || dataChanged || hexagonsChanged || getHexagonChanged) {
      geometry = packLayerH3Geometry(
        sourceData,
        props.data as LayerData<DataT>,
        props.getHexagon as (object: DataT, objectInfo: AccessorContext<DataT>) => H3IndexInput
      );
      geometryChanged = true;
    }

    if (dataLength(sourceData) !== geometry.length) {
      throw new Error(`Packed H3 geometry has ${geometry.length} cells but data has ${dataLength(sourceData)} rows`);
    }

    const fillColorChanged =
      geometryChanged || dataChanged || colorsChanged || props.getFillColor !== oldProps.getFillColor;
    let binaryData = this.state.binaryData;
    if (fillColorChanged || !binaryData) {
      const fillColors = buildPackedH3FillColors(
        sourceData,
        props.data as LayerData<DataT>,
        geometry,
        props.getFillColor as Accessor<DataT, Color>
      );
      if (geometryChanged || !binaryData) {
        binaryData = createBinaryData(geometry, fillColors);
      } else {
        binaryData.attributes = {
          ...binaryData.attributes,
          fillColors: {value: fillColors, size: 4, type: 'unorm8'}
        };
      }
    }

    this.setState({geometry, data: sourceData, binaryData});
  }

  override renderLayers(): SolidPolygonLayer | null {
    const {binaryData} = this.state;
    if (!binaryData) return null;
    const SubLayer = this.getSubLayerClass('hexagon-cell-packed', SolidPolygonLayer);
    return new SubLayer(
      this.getSubLayerProps({
        id: 'hexagon-cell-packed',
        updateTriggers: {getFillColor: [binaryData.attributes.fillColors.value]}
      }),
      {
        data: binaryData,
        _normalize: false,
        _windingOrder: 'CCW',
        positionFormat: 'XY',
        filled: true,
        extruded: false
      }
    );
  }

  override getPickingInfo(params: GetPickingInfoParams): PickingInfo<DataT> {
    const info = super.getPickingInfo(params) as PickingInfo<DataT>;
    info.object = objectAt(this.state.data, info.index);
    return info;
  }
}
