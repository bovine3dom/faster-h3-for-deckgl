import assert from 'node:assert/strict'
import test from 'node:test'
import {PackedH3FillTransition} from '../dist/index.js'

test('transitions packed fill colors and preserves interrupted progress', () => {
  let now = 0
  const geometry = {}
  const first = Uint8Array.from([255, 0, 0, 255])
  const binaryData = {
    attributes: {fillColors: {value: first, size: 4, type: 'unorm8'}}
  }
  const layer = {
    isComposite: true,
    state: {geometry, binaryData},
    context: {timeline: {getTime: () => now}}
  }
  const extension = new PackedH3FillTransition({duration: 1000, easing: t => t * t})
  const update = (current = extension, previous = current, extensionsChanged = false) => {
    current.updateState.call(layer, {
      changeFlags: {extensionsChanged},
      oldProps: {extensions: previous ? [previous] : []}
    }, current)
  }

  update(extension, null, true)
  assert.equal(binaryData.attributes.fillColors.normalized, true)
  assert.equal(binaryData.attributes.fillColorsFrom.value, first)
  assert.deepEqual(extension.getSubLayerProps.call(layer, extension), {
    _packedH3FillStartedAt: 0,
    _packedH3FillDuration: 0
  })

  const second = Uint8Array.from([0, 0, 255, 255])
  now = 100
  binaryData.attributes.fillColors = {value: second, size: 4, type: 'unorm8'}
  update()
  assert.equal(binaryData.attributes.fillColorsFrom.value, first)
  const transitionProps = extension.getSubLayerProps.call(layer, extension)
  assert.deepEqual(transitionProps, {
    _packedH3FillStartedAt: 100,
    _packedH3FillDuration: 1000
  })

  let redraws = 0
  let shaderProps
  now = 600
  extension.draw.call({
    props: {...transitionProps, opacity: 0.5},
    context: layer.context,
    setShaderModuleProps: value => { shaderProps = value },
    root: {setNeedsRedraw: () => redraws++}
  }, {}, extension)
  assert.equal(shaderProps.packedH3FillTransition.progress, 0.25)
  assert.equal(shaderProps.packedH3FillTransition.opacity, Math.pow(0.5, 1 / 2.2))
  assert.equal(redraws, 1)

  const third = Uint8Array.from([0, 255, 0, 255])
  binaryData.attributes.fillColors = {value: third, size: 4, type: 'unorm8'}
  update()
  assert.deepEqual(Array.from(binaryData.attributes.fillColorsFrom.value), [191, 0, 64, 255])
  assert.deepEqual(Array.from(first), [255, 0, 0, 255])
  assert.deepEqual(Array.from(second), [0, 0, 255, 255])

  const disabled = new PackedH3FillTransition({duration: 0})
  update(disabled, extension, true)
  assert.equal(binaryData.attributes.fillColorsFrom.value, third)
  assert.equal(disabled.getSubLayerProps.call(layer, disabled)._packedH3FillDuration, 0)

  layer.state.geometry = {}
  const fourth = Uint8Array.from([255, 255, 0, 255])
  binaryData.attributes.fillColors = {value: fourth, size: 4, type: 'unorm8'}
  update(disabled)
  assert.equal(binaryData.attributes.fillColorsFrom.value, fourth)
  assert.equal(disabled.getSubLayerProps.call(layer, disabled)._packedH3FillDuration, 0)
})

test('registers the external source color attribute', () => {
  let attributes
  const extension = new PackedH3FillTransition()
  assert.equal(extension.opts.duration, 1000)
  extension.initializeState.call({
    isComposite: false,
    getAttributeManager: () => ({add: value => { attributes = value }})
  })

  assert.deepEqual(attributes, {
    fillColorsFrom: {
      size: 4,
      type: 'unorm8',
      stepMode: 'dynamic',
      noAlloc: true
    }
  })
})
