import {Deck, MapView} from '@deck.gl/core'
import {latLngToCell} from 'h3-js'
import {
  PackedH3FillTransition,
  PackedH3HexagonLayer
} from '../../dist/index.js'

window.__deckCompatibility = {status: 'running'}

function timeout(ms, label) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms))
}

async function run() {
  const rows = [{hexagon: latLngToCell(0, 0, 5), color: [255, 0, 0, 255]}]
  const canvas = document.getElementById('deck-canvas')
  const getHexagon = row => row.hexagon
  const fillTransition = new PackedH3FillTransition()
  const initialLayer = new PackedH3HexagonLayer({
    id: 'packed-h3',
    data: rows,
    getHexagon,
    getFillColor: row => row.color,
    extensions: [fillTransition],
    pickable: true
  })

  let resolveFirstRender
  let rejectFirstRender
  const firstRender = new Promise((resolve, reject) => {
    resolveFirstRender = resolve
    rejectFirstRender = reject
  })
  const deck = new Deck({
    canvas,
    width: 320,
    height: 320,
    useDevicePixels: false,
    views: new MapView(),
    initialViewState: {longitude: 0, latitude: 0, zoom: 8},
    controller: false,
    layers: [initialLayer],
    onAfterRender: resolveFirstRender,
    onError: rejectFirstRender
  })

  try {
    await Promise.race([firstRender, timeout(20000, 'Initial render')])
    const picked = deck.pickObject({x: 160, y: 160, radius: 20})
    if (!picked) throw new Error('Initial polygon could not be picked')
    const currentLayer = picked.layer
    const geometry = currentLayer.state.geometry
    const binaryData = currentLayer.state.binaryData
    const sublayer = picked.sourceLayer || currentLayer.getSubLayers()[0]

    const updatedLayer = new PackedH3HexagonLayer({
      id: 'packed-h3',
      data: rows,
      getHexagon,
      getFillColor: [0, 0, 255, 255],
      extensions: [fillTransition],
      updateTriggers: {getFillColor: [1]},
      pickable: true
    })
    let resolveColorUpdate
    let rejectColorUpdate
    const colorUpdated = new Promise((resolve, reject) => {
      resolveColorUpdate = resolve
      rejectColorUpdate = reject
    })
    let observedTransitionColor = false
    deck.setProps({
      layers: [updatedLayer],
      onAfterRender: ({gl}) => {
        const pixel = new Uint8Array(4)
        gl.readPixels(160, 160, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        observedTransitionColor ||= pixel[0] > 20 && pixel[2] > 20
        if (pixel[2] > 200 && pixel[0] < 50) resolveColorUpdate(Array.from(pixel))
      },
      onError: rejectColorUpdate
    })
    const renderedColor = await Promise.race([colorUpdated, timeout(20000, 'Color update')])

    const pickedUpdated = deck.pickObject({x: 160, y: 160, radius: 20})
    if (!pickedUpdated) throw new Error('Updated polygon could not be picked')
    const currentUpdatedLayer = pickedUpdated.layer
    const start = geometry.startIndices[0] * 4
    window.__deckCompatibility = {
      status: 'passed',
      hasTopModel: Boolean(sublayer.state.topModel),
      externalIndexCount: geometry.indices.length,
      tessellatedIndexCount: sublayer.state.polygonTesselator.vertexCount,
      pickedSourceObject: picked?.object === rows[0],
      renderedColor,
      observedTransitionColor,
      geometryReused: currentUpdatedLayer.state.geometry === geometry,
      binaryDataReused: currentUpdatedLayer.state.binaryData === binaryData,
      updatedColor: Array.from(
        currentUpdatedLayer.state.binaryData.attributes.fillColors.value.slice(start, start + 4)
      )
    }
  } finally {
    deck.finalize()
  }
}

run().catch(error => {
  window.__deckCompatibility = {
    status: 'failed',
    error: error?.stack || String(error)
  }
})
