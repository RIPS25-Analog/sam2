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
import {ImageFrame} from '@/common/codecs/VideoDecoder';
import {MP4ArrayBuffer, createFile} from 'mp4box';

// The selection of timescale value is
// explained in the following docs: https://github.com/vjeux/mp4-h264-re-encode
const TIMESCALE = 90000;

export function encode(
  width: number,
  height: number,
  numFrames: number,
  framesGenerator: AsyncGenerator<ImageFrame, unknown>,
  progressCallback?: (progress: number) => void,
  fps?: number,
): Promise<MP4ArrayBuffer> {
  return new Promise((resolve, reject) => {
    let encodedFrameIndex = 0;
    let trackID: number | null = null;
    const durations: number[] = [];

    const outputFile = createFile();

    const encoder = new VideoEncoder({
      output(chunk, metaData) {
        const uint8 = new Uint8Array(chunk.byteLength);
        chunk.copyTo(uint8);

        const description = metaData?.decoderConfig?.description;
        if (trackID === null) {
          trackID = outputFile.addTrack({
            width: width,
            height: height,
            timescale: TIMESCALE,
            avcDecoderConfigRecord: description,
          });
        }
        const shiftedDuration = durations.shift();
        if (shiftedDuration != null) {
          outputFile.addSample(trackID, uint8, {
            duration: getScaledDuration(shiftedDuration),
            is_sync: chunk.type === 'key',
          });
          encodedFrameIndex++;
          progressCallback?.(encodedFrameIndex / numFrames);
        }

        if (encodedFrameIndex === numFrames) {
          resolve(outputFile.getBuffer());
        }
      },
      error(error) {
        reject(error);
        return;
      },
    });

    const setConfigurationAndEncodeFrames = async () => {
      // The codec value was taken from the following implementation and seems
      // reasonable for our use case for now:
      // https://github.com/vjeux/mp4-h264-re-encode/blob/main/mp4box.html#L103

      // Additional details about codecs can be found here:
      //  - https://developer.mozilla.org/en-US/docs/Web/Media/Formats/codecs_parameter
      //  - https://www.w3.org/TR/webcodecs-codec-registry/#video-codec-registry
      //
      // The following setting is a good compromise between output video file
      // size and quality. The latencyMode "realtime" is needed for Safari,
      // which otherwise will produce 20x larger files when in quality
      // latencyMode. Chrome does a really good job with file size even when
      // latencyMode is set to quality.
      const configuration: VideoEncoderConfig = {
        codec: 'avc1.4d0034',
        width: roundToNearestEven(width),
        height: roundToNearestEven(height),
        bitrate: 50_000_000, // Increased to 50Mbps for maximum quality
        alpha: 'discard',
        bitrateMode: 'constant', // Changed to constant for consistent quality
        latencyMode: 'quality', // Changed from 'realtime' to 'quality' for better output
      };
      const supportedConfig =
        await VideoEncoder.isConfigSupported(configuration);
      if (supportedConfig.supported === true) {
        encoder.configure(configuration);
      } else {
        throw new Error(
          `Unsupported video encoder config ${JSON.stringify(supportedConfig)}`,
        );
      }

      for await (const frame of framesGenerator) {
        const {bitmap} = frame;
        let frameDuration;
        
        if (fps) {
          // Use consistent frame duration for target FPS
          // Frame duration in microseconds: 1 second = 1,000,000 microseconds
          frameDuration = Math.round(1_000_000 / fps);
        } else {
          // Use original frame duration
          frameDuration = frame.duration;
        }
        
        durations.push(frameDuration);
        // Make every frame a keyframe for maximum quality
        encoder.encode(bitmap, {keyFrame: true});
        bitmap.close();
      }

      await encoder.flush();
      encoder.close();
    };

    setConfigurationAndEncodeFrames();
  });
}

function getScaledDuration(rawDuration: number) {
  return rawDuration / (1_000_000 / TIMESCALE);
}

function roundToNearestEven(dim: number) {
  const rounded = Math.round(dim);

  if (rounded % 2 === 0) {
    return rounded;
  } else {
    return rounded + (rounded > dim ? -1 : 1);
  }
}
