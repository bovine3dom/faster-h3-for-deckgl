import type {AccessorContext, AccessorFunction, LayerData} from '@deck.gl/core';
import earcut from 'earcut';
import {cellToBoundary} from 'h3-js';
import type {H3IndexInput} from 'h3-js';
import type {PackedH3Geometry, PackH3GeometryOptions} from './types.js';

export const defaultGetHexagon = (object: any): H3IndexInput => object.hexagon;

type ResolvedData<DataT> = LayerData<DataT>;

function hasLength<DataT>(data: ResolvedData<DataT>): data is ResolvedData<DataT> & {length: number} {
  return typeof (data as {length?: unknown}).length === 'number';
}

export function normalizeData<DataT>(data: ResolvedData<DataT> | null): ResolvedData<DataT> {
  if (!data) return [];
  if (typeof data === 'string') throw new TypeError('Packed H3 data must be resolved before packing');
  if (hasLength(data)) return data;
  if (Symbol.iterator in Object(data)) return Array.from(data as Iterable<DataT>);
  throw new TypeError('Packed H3 data must be iterable or have a numeric length');
}

export function dataLength<DataT>(data: ResolvedData<DataT>): number {
  if (hasLength(data)) return data.length;
  throw new TypeError('Packed H3 data must be normalized before use');
}

export function forEachData<DataT>(
  data: ResolvedData<DataT>,
  contextData: ResolvedData<DataT>,
  visit: (object: DataT, objectInfo: AccessorContext<DataT>) => void
): void {
  const objectInfo: AccessorContext<DataT> = {index: -1, data: contextData, target: []};
  if (Symbol.iterator in Object(data)) {
    for (const object of data as Iterable<DataT>) {
      objectInfo.index++;
      visit(object, objectInfo);
    }
    return;
  }

  if (!hasLength(data)) throw new TypeError('Packed H3 data must be normalized before use');
  for (let i = 0; i < data.length; i++) {
    objectInfo.index = i;
    visit(null as DataT, objectInfo);
  }
}

function growTypedArray<T extends Float64Array | Uint32Array>(array: T, requiredLength: number): T {
  if (requiredLength <= array.length) return array;
  const Constructor = array.constructor as new (length: number) => T;
  const grown = new Constructor(Math.max(requiredLength, Math.ceil(array.length * 1.5), 16));
  grown.set(array);
  return grown;
}

function packNormalizedH3Geometry<DataT>(
  data: ResolvedData<DataT>,
  contextData: ResolvedData<DataT>,
  getHexagon: AccessorFunction<DataT, H3IndexInput>
): PackedH3Geometry {
  const rows = dataLength(data);
  const startIndices = new Uint32Array(rows + 1);
  let positions = new Float64Array(Math.max(16, rows * 7 * 2));
  let indices = new Uint32Array(Math.max(16, rows * 13));
  let projected = new Float64Array(20);
  let vertexCount = 0;
  let indexCount = 0;

  forEachData(data, contextData, (object, objectInfo) => {
    const row = objectInfo.index;
    const boundary = cellToBoundary(getHexagon(object, objectInfo), true);
    const last = boundary.length - 1;
    const isClosed = last > 0 && boundary[0][0] === boundary[last][0] && boundary[0][1] === boundary[last][1];
    const boundaryLength = boundary.length - (isClosed ? 1 : 0);
    const referenceLng = boundary[0][0];
    startIndices[row] = vertexCount;
    positions = growTypedArray(positions, (vertexCount + boundaryLength) * 2);
    projected = growTypedArray(projected, boundaryLength * 2);

    for (let j = 0; j < boundaryLength; j++) {
      let [lng, lat] = boundary[j];
      const deltaLng = lng - referenceLng;
      if (deltaLng > 180) lng -= 360;
      else if (deltaLng < -180) lng += 360;
      const offset = (vertexCount + j) * 2;
      positions[offset] = lng;
      positions[offset + 1] = lat;
      projected[j * 2] = lng;
      projected[j * 2 + 1] = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    }

    const localIndices = earcut(projected.subarray(0, boundaryLength * 2), null, 2);
    indices = growTypedArray(indices, indexCount + localIndices.length);
    for (let j = 0; j < localIndices.length; j++) {
      indices[indexCount + j] = vertexCount + localIndices[j];
    }
    indexCount += localIndices.length;
    vertexCount += boundaryLength;
  });
  startIndices[rows] = vertexCount;

  return {
    length: rows,
    startIndices,
    positions: positions.subarray(0, vertexCount * 2),
    indices: indices.subarray(0, indexCount),
    vertexCount,
    triangleCount: indexCount / 3
  };
}

export function packH3Geometry<DataT>(
  sourceData: ResolvedData<DataT>,
  options: PackH3GeometryOptions<DataT> = {}
): PackedH3Geometry {
  const data = normalizeData(sourceData);
  return packNormalizedH3Geometry(
    data,
    sourceData,
    options.getHexagon || defaultGetHexagon
  );
}

export function packLayerH3Geometry<DataT>(
  data: ResolvedData<DataT>,
  contextData: ResolvedData<DataT>,
  getHexagon: AccessorFunction<DataT, H3IndexInput>
): PackedH3Geometry {
  return packNormalizedH3Geometry(data, contextData, getHexagon);
}
