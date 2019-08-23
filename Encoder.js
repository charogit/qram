/*!
 * Copyright (c) 2019 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

import {Packet} from './Packet.js';
import {RandomDegree} from './RandomDegree.js';
import {ReadableStream} from './util.js';
import {Timer} from './Timer.js';
import {sha256} from './hash.js';

export class Encoder {
  constructor({data, blockSize, failureProbability} = {}) {
    if(!(data instanceof Uint8Array || data instanceof Uint8ClampedArray)) {
      throw new TypeError('"data" must be a Uint8Array or Uint8ClampedArray.');
    }
    this.data = data;
    this.digest = null;
    this.blockSize = blockSize;
    this.stream = null;
    this.blockCount = Math.ceil(this.data.length / blockSize);
    this.blocks = new Array(this.blockCount);
    this.random = new RandomDegree({N: this.blockCount, failureProbability});
  }

  createTimer({fps} = {}) {
    return new Timer({fps});
  }

  async createReadableStream() {
    const encoder = this;
    // hash data if not already done so
    if(!this.digest) {
      this.digest = await sha256(this.data);
    }
    return new ReadableStream({
      async pull(controller) {
        // produce a packet and queue it for reading
        controller.enqueue(await encoder._nextPacket());
      }
    });
  }

  async _nextPacket() {
    const {blockCount, blockSize, data, digest} = this;
    const degree = this.random.next();
    const indexes = [];
    for(let i = 0; i < degree; ++i) {
      let x;
      do {
        x = Math.floor(Math.random() * blockCount);
      } while(indexes.includes(x));
      indexes.push(x);
    }
    indexes.sort((a, b) => a - b);

    const blocks = await Promise.all(
      indexes.map(async i => this._createBlock(i)));
    return Packet.create({
      totalSize: data.length, blocks, indexes, blockSize, digest
    });
  }

  async _createBlock(index) {
    const {blocks, blockSize, data} = this;

    let block = blocks[index];
    if(block) {
      return block;
    }

    // determine unpadded size of block
    const start = index * blockSize;
    if((data.length - start) < blockSize) {
      // special case... copy last block that needs padding
      block = new Uint8Array(blockSize);
      const last = new Uint8Array(
        data.buffer, data.byteOffset + start, data.length - start);
      block.set(last);
    } else {
      // no copy necessary, just a view into the block
      block = new Uint8Array(data.buffer, data.byteOffset + start, blockSize);
    }

    return blocks[index] = block;
  }
}
