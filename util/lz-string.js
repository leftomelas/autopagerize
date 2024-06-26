'use strict';

// private property
var
  {fromCharCode} = String,
  streamData,
  streamDataVal,
  streamDataPosition,
  streamBitsPerChar;

function streamBits(value, numBitsMask) {
  for (var i = 0; numBitsMask >>= 1; i++) {
    // shifting has precedence over bitmasking
    streamDataVal = value >> i & 1 | streamDataVal << 1;
    if (++streamDataPosition === streamBitsPerChar) {
      streamDataPosition = 0;
      streamData.push(streamDataVal + 32);
      streamDataVal = 0;
    }
  }
}

export function compressToUTF16(uncompressed) {
  if (uncompressed == null)
    return '';
  var res = [];
  // data - empty stream
  streamData = [];
  // davaVal
  streamDataVal = 0;
  // dataPosition
  streamDataPosition = 0;
  streamBitsPerChar = 15;
  var j = 0, k = 0, value = 0,
    node = [3], // first node will always be initialised like this.
    // we should never output the root anyway,
    // so we initiate with terminating token
    // Also, dictionary[1] will be overwritten
    // by the first charCode
    dictionary = [2, 2, node],
    freshNode = true,
    c = 0,
    dictSize = 3,
    numBitsMask = 0b100;

  if (uncompressed.length) {
    // If there is a string, the first charCode is guaranteed to
    // be new, so we write it to output stream, and add it to the
    // dictionary. For the same reason we can initialize freshNode
    // as true, and new_node, node and dictSize as if
    // it was already added to the dictionary (see above).

    c = uncompressed.charCodeAt(0);

    // == Write first charCode token to output ==

    // 8 or 16 bit?
    value = c < 256 ? 0 : 1;

    // insert "new 8/16 bit charCode" token
    // into bitstream (value 1)
    streamBits(value, numBitsMask);
    streamBits(c, value ? 0b10000000000000000 : 0b100000000);

    // Add charCode to the dictionary.
    dictionary[1] = c;

    nextchar:
      for (j = 1; j < uncompressed.length; j++) {
        if (streamData.length > 8000) {
          res.push(fromCharCode(...streamData));
          streamData.length = 0;
        }
        c = uncompressed.charCodeAt(j);
        // does the new charCode match an existing prefix?
        for (k = 1; k < node.length; k += 2) {
          if (node[k] === c) {
            node = node[k + 1];
            continue nextchar;
          }
        }
        // we only end up here if there is no matching char

        // Prefix+charCode does not exist in trie yet.
        // We write the prefix to the bitstream, and add
        // the new charCode to the dictionary if it's new
        // Then we set `node` to the root node matching
        // the charCode.

        if (freshNode) {
          // Prefix is a freshly added character token,
          // which was already written to the bitstream
          freshNode = false;
        } else {
          // write out the current prefix token
          streamBits(node[0], numBitsMask);
        }

        // Is the new charCode a new character
        // that needs to be stored at the root?
        k = 1;
        while (dictionary[k] !== c && k < dictionary.length) {
          k += 2;
        }
        if (k === dictionary.length) {
          // increase token bitlength if necessary
          if (++dictSize >= numBitsMask) {
            numBitsMask <<= 1;
          }

          // insert "new 8/16 bit charCode" token,
          // see comments above for explanation
          value = c < 256 ? 0 : 1;
          streamBits(value, numBitsMask);
          streamBits(c, value ? 0b10000000000000000 : 0b100000000);

          dictionary.push(c);
          dictionary.push([dictSize]);
          // Note of that we already wrote
          // the charCode token to the bitstream
          freshNode = true;
        }
        // add node representing prefix + new charCode to trie
        node.push(c);
        node.push([++dictSize]);
        // increase token bitlength if necessary
        if (dictSize >= numBitsMask) {
          numBitsMask <<= 1;
        }
        // set node to first charCode of new prefix
        // k is guaranteed to be at the current charCode,
        // since we either broke out of the while loop
        // when it matched, or just added the new charCode
        node = dictionary[k + 1];

      }

    // === Write last prefix to output ===
    if (freshNode) {
      // character token already written to output
      freshNode = false;
    } else {
      // write out the prefix token
      streamBits(node[0], numBitsMask);

    }

    // Is c a new character?
    k = 1;
    while (dictionary[k] !== c && k < dictionary.length) {
      k += 2;
    }
    if (k === dictionary.length) {
      // increase token bitlength if necessary
      if (++dictSize >= numBitsMask) {
        numBitsMask <<= 1;
      }
      // insert "new 8/16 bit charCode" token,
      // see comments above for explanation
      value = c < 256 ? 0 : 1;
      streamBits(value, numBitsMask);
      streamBits(c, value ? 0b10000000000000000 : 0b100000000);
    }
    // increase token bitlength if necessary
    if (++dictSize >= numBitsMask) {
      numBitsMask <<= 1;
    }
  }

  // Mark the end of the stream
  streamBits(2, numBitsMask);


  // Flush the last char
  streamDataVal <<= streamBitsPerChar - streamDataPosition;
  streamData.push(streamDataVal + 32);
  res.push(fromCharCode(...streamData), ' ');
  streamData.length = 0;
  return res.join('');
}

export function decompressFromUTF16(compressed) {
  if (compressed == null) return '';
  if (compressed === '') return null;
  var {length} = compressed,
    resetBits = 15,
    dictionary = [0, 1, 2],
    enlargeIn = 4,
    dictSize = 4,
    numBits = 3,
    entry = "",
    result = [],
    w = "",
    bits = 0,
    maxpower = 2,
    power = 0,
    c = "",
    data_val = compressed.charCodeAt(0) - 32,
    data_position = resetBits,
    data_index = 1;

  // Get first token, guaranteed to be either
  // a new character token (8 or 16 bits)
  // or end of stream token.
  while (power !== maxpower) {
    // shifting has precedence over bitmasking
    bits += (data_val >> --data_position & 1) << power++;
    if (data_position === 0) {
      data_position = resetBits;
      data_val = compressed.charCodeAt(data_index++) - 32;
    }
  }

  // if end of stream token, return empty string
  if (bits === 2) {
    return "";
  }

  // else, get character
  maxpower = bits * 8 + 8;
  bits = power = 0;
  while (power !== maxpower) {
    // shifting has precedence over bitmasking
    bits += (data_val >> --data_position & 1) << power++;
    if (data_position === 0) {
      data_position = resetBits;
      data_val = compressed.charCodeAt(data_index++) - 32;
    }
  }
  c = fromCharCode(bits);
  dictionary[3] = c;
  w = c;
  result.push(c);

  // read rest of string
  while (data_index <= length) {
    // read out next token
    maxpower = numBits;
    bits = power = 0;
    while (power !== maxpower) {
      // shifting has precedence over bitmasking
      bits += (data_val >> --data_position & 1) << power++;
      if (data_position === 0) {
        data_position = resetBits;
        data_val = compressed.charCodeAt(data_index++) - 32;
      }
    }

    // 0 or 1 implies new character token
    if (bits < 2) {
      maxpower = (8 + 8 * bits);
      bits = power = 0;
      while (power !== maxpower) {
        // shifting has precedence over bitmasking
        bits += (data_val >> --data_position & 1) << power++;
        if (data_position === 0) {
          data_position = resetBits;
          data_val = compressed.charCodeAt(data_index++) - 32;
        }
      }
      dictionary[dictSize] = fromCharCode(bits);
      bits = dictSize++;
      if (--enlargeIn === 0) {
        enlargeIn = 1 << numBits++;
      }
    } else if (bits === 2) {
      // end of stream token
      return result.join('');
    }

    if (bits > dictionary.length) {
      return null;
    }
    entry = bits < dictionary.length ? dictionary[bits] : w + w.charAt(0);
    result.push(entry);
    // Add w+entry[0] to the dictionary.
    dictionary[dictSize++] = w + entry.charAt(0);

    w = entry;

    if (--enlargeIn === 0) {
      enlargeIn = 1 << numBits++;
    }

  }
  return "";
}
