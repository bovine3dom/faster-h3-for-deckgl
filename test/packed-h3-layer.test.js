import assert from 'node:assert/strict'
import test from 'node:test'
import {getPentagons, h3IndexToSplitLong, latLngToCell} from 'h3-js'
import {PackedH3HexagonLayer, packH3Geometry} from '../dist/index.js'

function changeFlags(overrides = {}) {
  return {
    dataChanged: false,
    propsChanged: false,
    updateTriggersChanged: false,
    extensionsChanged: false,
    viewportChanged: false,
    stateChanged: false,
    propsOrDataChanged: true,
    somethingChanged: true,
    ...overrides
  }
}

function updateWithoutDeck(layer, props, oldProps, flags) {
  layer.setState = update => Object.assign(layer.state, update)
  layer.updateState({props, oldProps, changeFlags: flags, context: {}})
}

test('packs exact H3 polygons, including pentagons and the antimeridian', () => {
  const rows = [
    {hexagon: latLngToCell(51.5, 0, 5)},
    {hexagon: getPentagons(5)[0]},
    {hexagon: latLngToCell(0, 179.9, 5)}
  ]
  const geometry = packH3Geometry(rows)

  assert.equal(geometry.length, rows.length)
  assert.equal(geometry.startIndices.length, rows.length + 1)
  assert.equal(geometry.startIndices.at(-1), geometry.vertexCount)
  assert.equal(geometry.positions.length, geometry.vertexCount * 2)
  assert.equal(geometry.indices.length, geometry.triangleCount * 3)
  assert.ok(geometry.indices.every(index => index < geometry.vertexCount))

  for (let row = 0; row < rows.length; row++) {
    const longitudes = []
    for (let vertex = geometry.startIndices[row]; vertex < geometry.startIndices[row + 1]; vertex++) {
      longitudes.push(geometry.positions[vertex * 2])
    }
    assert.ok(Math.max(...longitudes) - Math.min(...longitudes) < 180)
  }
})

test('accepts index-based columnar data and split H3 indexes', () => {
  const cells = [latLngToCell(40.7, -74, 7), latLngToCell(-33.9, 151.2, 8)]
  const split = cells.map(h3IndexToSplitLong)
  const data = {
    length: cells.length,
    lower: Uint32Array.from(split, value => value[0]),
    upper: Uint32Array.from(split, value => value[1])
  }
  const geometry = packH3Geometry(data, {
    getHexagon: (_, {data, index, target}) => {
      target[0] = data.lower[index]
      target[1] = data.upper[index]
      return target
    }
  })

  assert.equal(geometry.length, cells.length)
  assert.ok(geometry.vertexCount >= 12)
  assert.ok(geometry.triangleCount >= 8)
})

test('updates colors without rebuilding geometry or binary data', () => {
  const rows = [
    {hexagon: latLngToCell(51.5, 0, 6), color: [1, 2, 3, 4]},
    {hexagon: latLngToCell(51.6, 0.1, 6), color: [5, 6, 7, 8]}
  ]
  const layer = new PackedH3HexagonLayer({
    id: 'packed',
    data: rows,
    getHexagon: row => row.hexagon,
    getFillColor: row => row.color,
    pickable: true
  })
  layer.initializeState()
  updateWithoutDeck(
    layer,
    layer.props,
    {...layer.props, data: null},
    changeFlags({dataChanged: 'data changed'})
  )

  const geometry = layer.state.geometry
  const binaryData = layer.state.binaryData
  const firstStart = geometry.startIndices[0] * 4
  assert.deepEqual(
    Array.from(binaryData.attributes.fillColors.value.slice(firstStart, firstStart + 4)),
    rows[0].color
  )

  const newProps = {...layer.props, geometry: null, getFillColor: [9, 10, 11, 12]}
  assert.equal(layer.shouldUpdateState({
    props: newProps,
    oldProps: layer.props,
    changeFlags: changeFlags({propsOrDataChanged: false}),
    context: {}
  }), true)
  updateWithoutDeck(
    layer,
    newProps,
    layer.props,
    changeFlags({propsOrDataChanged: false, somethingChanged: false})
  )

  assert.equal(layer.state.geometry, geometry)
  assert.equal(layer.state.binaryData, binaryData)
  assert.deepEqual(
    Array.from(binaryData.attributes.fillColors.value.slice(firstStart, firstStart + 4)),
    [9, 10, 11, 12]
  )

  const movedCell = latLngToCell(0, 0, 6)
  const movedProps = {...newProps, getHexagon: () => movedCell}
  assert.equal(layer.shouldUpdateState({
    props: movedProps,
    oldProps: newProps,
    changeFlags: changeFlags({propsOrDataChanged: false}),
    context: {}
  }), true)
  updateWithoutDeck(
    layer,
    movedProps,
    newProps,
    changeFlags({propsOrDataChanged: false, somethingChanged: false})
  )
  assert.notEqual(layer.state.geometry, geometry)

  const sublayer = layer.renderLayers()
  assert.equal(sublayer.props.data, layer.state.binaryData)
  assert.equal(sublayer.props._normalize, false)
  const info = layer.getPickingInfo({
    info: {index: 1, picked: true, object: undefined},
    mode: 'hover',
    sourceLayer: sublayer
  })
  assert.equal(info.object, rows[1])
})
