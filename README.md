# faster-h3-for-deckgl

Hey! You! Want your H3 layers to load faster in deck? Don't use this package! Try the vanilla deck layer with `highPrecision: false` and pass getHexagon split integers [lower32bits, upper32bits] instead of strings.

You're back? Annoyed by the visual glitches? Fine. This is about ~75% faster than the vanilla layer with `highPrecision: true` but doesn't support extrusion or strokes. It otherwise is mostly a drop-in replacement for the `H3HexagonLayer`

It naughtily depends on some deck internals so it might be fragile and break between patch versions.

## Install

```sh
npm install @faster-h3-for-deckgl @deck.gl/core @deck.gl/layers
```

The initial release was tested with deck.gl 9.0.x.

## Use

```js
import {PackedH3HexagonLayer} from 'faster-h3-for-deckgl'

const layer = new PackedH3HexagonLayer({
  id: 'hexagons',
  data,
  getHexagon: row => row.h3,
  getFillColor: row => row.color,
  pickable: true,
  updateTriggers: {
    getFillColor: [colorMode]
  }
})
```

`getHexagon` and `getFillColor` receive the standard deck.gl accessor context. So columns work too:

```js
const data = {length: h3Indexes.length, h3Indexes, colors}

const layer = new PackedH3HexagonLayer({
  id: 'hexagons',
  data,
  getHexagon: (_, {data, index}) => data.h3Indexes[index],
  getFillColor: (_, {data, index}) => data.colors[index]
})
```

`data` must be a resolved iterable or an object with a numeric `length`. Promise, URL, and async-iterable data sources are not supported.

## Extra credit: compute geometry for later reuse

You can pack geometry before constructing the layer and reuse it as long as the data has the same cells in the same order:

```js
import {PackedH3HexagonLayer, packH3Geometry} from 'faster-h3-for-deckgl'

const geometry = packH3Geometry(data, {getHexagon: row => row.h3})

const layer = new PackedH3HexagonLayer({
  id: 'hexagons',
  data,
  geometry,
  getHexagon: row => row.h3,
  getFillColor: row => row.color
})
```

Replacing `getFillColor` or changing its update triggers only rebuilds the color buffer. Replacing `data` or `getHexagon` rebuilds geometry unless a `geometry` prop is supplied. As with other deck.gl layers, use an update trigger when values captured by an accessor change without replacing the accessor itself.
