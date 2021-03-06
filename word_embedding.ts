/**
 * @license
 * Copyright 2018 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */
/**
 * This is where we have all functions for word embeddings, rest of the GUI is
 * unaware of tfjs vectors
 */
import * as tf from '@tensorflow/tfjs';

export class WordEmbedding {
  private cachedDirections: {[name: string]: tf.Tensor1D} = {};

  constructor(private embeddingTensor: tf.Tensor2D, private words: string[]) {}

  getEmbedding(word: string): tf.Tensor1D {
    return tf.tidy(() => tf.gather(this.embeddingTensor, [
                             this.words.indexOf(word)
                           ]).squeeze());
  }

  hasWord(word: string): boolean {
    return this.words.indexOf(word) != -1;
  }

  computeDirection(word1: string, word2: string): tf.Tensor1D {
    return tf.tidy(() => {
      const leftAxisWordTensor = this.getEmbedding(word1);
      const rightAxisWordTensor = this.getEmbedding(word2);
      const direction = rightAxisWordTensor.sub(leftAxisWordTensor);
      const directionLength = direction.norm();
      return direction.div(directionLength);
    });
  }

  async nearest(word: string, numNeighbors: number): Promise<string[]> {
    const nearestIndices = tf.tidy(() => {
      const wordEmbedding = this.getEmbedding(word);
      const wordCosines = this.embeddingTensor.dot(wordEmbedding);
      return tf.topk(wordCosines, numNeighbors, true).indices;
    });
    const nearestIndsData = await nearestIndices.data();
    nearestIndices.dispose();

    const nearestWords = [];
    for (let i = 0; i < nearestIndsData.length; i++) {
      nearestWords.push(this.words[nearestIndsData[i]]);
    }
    return nearestWords;
  }

  async project(word: string, axisLeft: string, axisRight: string):
      Promise<number> {
    const dotProduct = tf.tidy(() => {
      const wordEmbedding = this.getEmbedding(word);
      let biasDirection: tf.Tensor1D;
      const mergedKey = axisLeft + axisRight;
      if (mergedKey in this.cachedDirections) {
        biasDirection = this.cachedDirections[mergedKey];
      } else {
        biasDirection = this.computeDirection(axisLeft, axisRight);
        this.cachedDirections[mergedKey] = tf.keep(biasDirection);
      }
      return wordEmbedding.dot(biasDirection);
    });
    const dotProductData = await dotProduct.data();
    return dotProductData[0];
  }

  async projectNearest(
      word: string, axisLeft: string, axisRight: string,
      numNeighbors: number): Promise<[string, number][]> {
    const nearestWords = await this.nearest(word, numNeighbors);
    let dirSimilarities: [string, number][] = [];
    for (let i = 0; i < nearestWords.length; i++) {
      const word = nearestWords[i];
      const sim = await this.project(word, axisLeft, axisRight);
      dirSimilarities.push([word, sim]);
    }
    // Sort words w.r.t.their direction similarity
    dirSimilarities.sort((left, right) => {return left[1] < right[1] ? -1 : 1});
    return dirSimilarities;
  }
  /**
   * Computes the average of the values of every word in the dictionary along
   * the axis. This is for adding a bias term when actually projecting later.
   * @param axes
   */
  computeAverageWordSimilarity(axes: string[][]): tf.Tensor {
    return tf.tidy(() => {
      // Collect the directions for each axis.
      const directions = [];
      for (let i = 0; i < axes.length; i++) {
        const axis = axes[i];
        const word1 = axis[0];
        const word2 = axis[1];
        directions.push(this.computeDirection(word1, word2));
      }

      // Get their averages.
      const directionsTensor = tf.stack(directions);
      const transposeA = false;
      const transposeB = true;
      const biases = tf.matMul(
          directionsTensor, this.embeddingTensor, transposeA, transposeB);
      return biases.mean(1);
    });
  }

  /**
   * Project all words along the axes to precompute the biases.
   * @param axes axes along which to project all words.
   */
  computeProjections(axes: string[][]): tf.Tensor {
    return tf.tidy(() => {
      // Collect the directions for each axis.
      const directions = [];
      for (let i = 0; i < axes.length; i++) {
        const axis = axes[i];
        const word1 = axis[0];
        const word2 = axis[1];
        directions.push(this.computeDirection(word1, word2));
      }

      // Get their averages.
      const directionsTensor = tf.stack(directions);
      const transposeA = false;
      const transposeB = true;
      const biases = tf.matMul(
          directionsTensor, this.embeddingTensor, transposeA, transposeB);
      return biases;
    });
  }
}
