const zlib = require('zlib');

// PlantUML custom base64 alphabet
const encode6bit = (b) => {
  if (b < 10) return String.fromCharCode(48 + b);
  b -= 10;
  if (b < 26) return String.fromCharCode(65 + b);
  b -= 26;
  if (b < 26) return String.fromCharCode(97 + b);
  b -= 26;
  if (b === 0) return '-';
  if (b === 1) return '_';
  return '?';
};

const append3bytes = (b1, b2, b3) => {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xF) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3F;
  return encode6bit(c1) + encode6bit(c2) + encode6bit(c3) + encode6bit(c4);
};

function plantumlEncode(text) {
  const deflated = zlib.deflateRawSync(Buffer.from(text, 'utf8'));
  let res = '';
  for (let i = 0; i < deflated.length; i += 3) {
    if (i + 2 === deflated.length) {
      res += append3bytes(deflated[i], deflated[i + 1], 0);
    } else if (i + 1 === deflated.length) {
      res += append3bytes(deflated[i], 0, 0);
    } else {
      res += append3bytes(deflated[i], deflated[i + 1], deflated[i + 2]);
    }
  }
  return res;
}

module.exports = {
  plantumlEncode,
  plantumlPngUrl(umlText) {
    const encoded = plantumlEncode(umlText);
    return `https://www.plantuml.com/plantuml/png/${encoded}`;
  }
};
