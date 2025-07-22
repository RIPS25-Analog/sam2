/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {DecodedVideo} from '@/common/codecs/VideoDecoder';
import {Effect, EffectFrameContext} from '@/common/components/video/effects/Effect';
import {Tracklet} from '@/common/tracker/Tracker';
import {RLEObject} from '@/jscocotools/mask';
import {CanvasForm} from 'pts';

/**
 * Simple utility to export all processed frames as PNG images
 */
export class FrameExporter {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private form: CanvasForm;

  constructor(width: number, height: number) {
    this.canvas = new OffscreenCanvas(width, height);
    const ctx = this.canvas.getContext('2d', {willReadFrequently: true});
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }
    this.ctx = ctx;
    this.form = new CanvasForm(this.ctx);
  }

  /**
   * Export all frames from a decoded video with applied effects/masks
   */
  async exportFrames(
    decodedVideo: DecodedVideo,
    tracklets: Tracklet[],
    effects: Effect[],
    onProgress?: (progress: number) => void
  ): Promise<Blob[]> {
    const frames: Blob[] = [];
    
    for (let frameIndex = 0; frameIndex < decodedVideo.frames.length; frameIndex++) {
      const frame = decodedVideo.frames[frameIndex];
      
      // Clear canvas
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      // Create ImageBitmap from VideoFrame
      const frameBitmap = await createImageBitmap(frame.bitmap);

      // Collect masks for this frame
      const masks: {bounds: any, bitmap: RLEObject}[] = [];
      const colors: string[] = [];
      const frameTracklets: Tracklet[] = [];
      
      tracklets.forEach(tracklet => {
        const mask = tracklet.masks[frameIndex];
        if (mask != null) {
          masks.push({
            bounds: mask.bounds,
            bitmap: mask.data as RLEObject,
          });
          frameTracklets.push(tracklet);
          colors.push(tracklet.color);
        }
      });

      // Apply effects
      const effectParams: EffectFrameContext = {
        frame: frameBitmap,
        masks,
        maskColors: colors,
        frameIndex,
        totalFrames: decodedVideo.frames.length,
        fps: decodedVideo.fps,
        width: frameBitmap.width,
        height: frameBitmap.height,
        actionPoint: null,
      };

      // Process effects
      for (const effect of effects) {
        effect.apply(this.form, effectParams, frameTracklets);
      }

      // Convert to PNG blob
      const blob = await this.canvas.convertToBlob({
        type: 'image/png',
        quality: 1.0
      });
      
      frames.push(blob);
      frameBitmap.close();
      
      // Report progress
      if (onProgress) {
        onProgress((frameIndex + 1) / decodedVideo.frames.length);
      }
    }

    return frames;
  }

  /**
   * Export frames as downloadable URLs
   */
  async exportFramesAsUrls(
    decodedVideo: DecodedVideo,
    tracklets: Tracklet[],
    effects: Effect[],
    onProgress?: (progress: number) => void
  ): Promise<string[]> {
    const blobs = await this.exportFrames(decodedVideo, tracklets, effects, onProgress);
    return blobs.map(blob => URL.createObjectURL(blob));
  }

  /**
   * Download all frames as individual PNG files
   */
  async downloadFramesAsZip(
    decodedVideo: DecodedVideo,
    tracklets: Tracklet[],
    effects: Effect[],
    onProgress?: (progress: number) => void
  ): Promise<void> {
    // This would require adding JSZip as a dependency
    // For now, just export individual frames
    const urls = await this.exportFramesAsUrls(decodedVideo, tracklets, effects, onProgress);
    
    // Download each frame individually
    urls.forEach((url, index) => {
      const link = document.createElement('a');
      link.href = url;
      link.download = `frame_${index.toString().padStart(4, '0')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  }
}
