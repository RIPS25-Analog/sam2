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
import {cloneFrame} from '@/common/codecs/WebCodecUtils';
import {FileStream} from '@/common/utils/FileUtils';
import {createDecoderDebugger} from '@/common/utils/VideoDecoderDebugger';
import {
  createFile,
  DataStream,
  MP4ArrayBuffer,
  MP4File,
  MP4Sample,
  MP4VideoTrack,
} from 'mp4box';
import {isAndroid, isChrome, isEdge, isWindows} from 'react-device-detect';

export type ImageFrame = {
  bitmap: VideoFrame;
  timestamp: number;
  duration: number;
};

export type DecodedVideo = {
  width: number;
  height: number;
  frames: ImageFrame[];
  numFrames: number;
  fps: number;
};

function decodeInternal(
  identifier: string,
  onReady: (mp4File: MP4File) => Promise<void>,
  onProgress: (decodedVideo: DecodedVideo) => void,
): Promise<DecodedVideo> {
  return new Promise((resolve, reject) => {
    const imageFrames: ImageFrame[] = [];
    const globalSamples: MP4Sample[] = [];
    
    // Create debugger to track frame dropping
    const frameDebugger = createDecoderDebugger();

    let decoder: VideoDecoder;

    let track: MP4VideoTrack | null = null;
    const mp4File = createFile();

    mp4File.onError = reject;
    mp4File.onReady = async info => {
      if (info.videoTracks.length > 0) {
        track = info.videoTracks[0];
      } else {
        // The video does not have a video track, so looking if there is an
        // "otherTracks" available. Note, I couldn't find any documentation
        // about "otherTracks" in WebCodecs [1], but it was available in the
        // info for MP4V-ES, which isn't supported by Chrome [2].
        // However, we'll still try to get the track and then throw an error
        // further down in the VideoDecoder.isConfigSupported if the codec is
        // not supported by the browser.
        //
        // [1] https://www.w3.org/TR/webcodecs/
        // [2] https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#mp4v-es
        track = info.otherTracks[0];
      }

      if (track == null) {
        reject(new Error(`${identifier} does not contain a video track`));
        return;
      }

      const timescale = track.timescale;
      const edits = track.edits;
      
      // Log edit list information for debugging
      frameDebugger.logEditInfo(edits, timescale);
      console.log(`🎥 Video track metadata:`);
      console.log(`  📊 nb_samples (expected frames): ${track.nb_samples}`);
      console.log(`  ⏱️ duration: ${track.duration}`);
      console.log(`  🔢 timescale: ${timescale}`);
      console.log(`  📐 dimensions: ${track.track_width}x${track.track_height}`);
      console.log(`  🎬 codec: ${track.codec}`);
      console.log(`  📝 edit lists: ${edits?.length || 0} entries`);
      
      if (edits && edits.length > 0) {
        console.log(`  📝 Edit list details:`);
        edits.forEach((edit, i) => {
          console.log(`    [${i}] media_time: ${edit.media_time}, segment_duration: ${edit.segment_duration}`);
        });
      }

      let frame_n = 0;
      decoder = new VideoDecoder({
        // Be careful with any await in this function. The VideoDecoder will
        // not await output and continue calling it with decoded frames.
        async output(inputFrame) {
          frameDebugger.stats.totalDecodedFrames++;
          console.log(`🎬 Frame ${frame_n} decoded: timestamp=${inputFrame.timestamp}, totalDecoded=${frameDebugger.stats.totalDecodedFrames}`);
          
          if (track == null) {
            reject(new Error(`${identifier} does not contain a video track`));
            return;
          }

          const saveTrack = track;

          // If the track has edits, we'll need to check that only frames are
          // returned that are within the edit list. This can happen for
          // trimmed videos that have not been transcoded and therefore the
          // video track contains more frames than those visually rendered when
          // playing back the video.
          if (edits != null && edits.length > 0) {
            const cts = Math.round(
              (inputFrame.timestamp * timescale) / 1_000_000,
            );
            console.log(`📝 Edit list check - Frame ${frame_n}: cts=${cts}, media_time=${edits[0].media_time}, timescale=${timescale}`);
            if (cts < edits[0].media_time) {
              console.log(`❌ Frame ${frame_n} DROPPED by edit list filter (cts ${cts} < media_time ${edits[0].media_time})`);
              frameDebugger.logFrameDrop('edit_list_filter', frame_n, inputFrame.timestamp);
              inputFrame.close();
              return;
            } else {
              console.log(`✅ Frame ${frame_n} passed edit list filter`);
            }
          } else {
            console.log(`📝 Frame ${frame_n}: No edit list to check`);
          }

          // Workaround for Chrome where the decoding stops at ~17 frames unless
          // the VideoFrame is closed. So, the workaround here is to create a
          // new VideoFrame and close the decoded VideoFrame.
          // The frame has to be cloned, or otherwise some frames at the end of the
          // video will be black. Note, the default VideoFrame.clone doesn't work
          // and it is using a frame cloning found here:
          // https://webcodecs-blogpost-demo.glitch.me/
          if (
            (isAndroid && isChrome) ||
            (isWindows && isChrome) ||
            (isWindows && isEdge)
          ) {
            const clonedFrame = await cloneFrame(inputFrame);
            inputFrame.close();
            inputFrame = clonedFrame;
          }

          const sample = globalSamples[frame_n];
          console.log(`🧪 Frame ${frame_n}: Checking sample - exists=${sample != null}, globalSamples.length=${globalSamples.length}, expected_nb_samples=${saveTrack.nb_samples}`);
          
          if (sample != null) {
            const duration = (sample.duration * 1_000_000) / sample.timescale;
            imageFrames.push({
              bitmap: inputFrame,
              timestamp: inputFrame.timestamp,
              duration,
            });
            frameDebugger.stats.finalFrameCount++;
            console.log(`✅ Frame ${frame_n} ADDED to imageFrames (total frames now: ${imageFrames.length})`);
            // Sort frames in order of timestamp. This is needed because Safari
            // can return decoded frames out of order.
            imageFrames.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
            // Update progress on first frame and then every 40th frame
            if (onProgress != null && frame_n % 100 === 0) {
              onProgress({
                width: saveTrack.track_width,
                height: saveTrack.track_height,
                frames: imageFrames,
                numFrames: saveTrack.nb_samples,
                fps:
                  (saveTrack.nb_samples / saveTrack.duration) *
                  saveTrack.timescale,
              });
            }
          } else {
            console.log(`❌ Frame ${frame_n} DROPPED - no corresponding sample in globalSamples`);
            frameDebugger.logFrameDrop('missing_sample', frame_n, inputFrame.timestamp);
            // Frame decoded but no corresponding sample - this shouldn't happen in normal cases
            inputFrame.close();
          }
          frame_n++;
          console.log(`📊 Frame ${frame_n - 1} processing complete. Next frame: ${frame_n}, Expected total: ${saveTrack.nb_samples}`);

          if (saveTrack.nb_samples === frame_n) {
            console.log(`🏁 All frames processed! Expected: ${saveTrack.nb_samples}, Processed: ${frame_n}`);
            // Sort frames in order of timestamp. This is needed because Safari
            // can return decoded frames out of order.
            imageFrames.sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
            
            // Log final debugging information
            console.log('🎯 FINAL FRAME PROCESSING SUMMARY:', {
              expectedFrames: saveTrack.nb_samples,
              totalDecoded: frameDebugger.stats.totalDecodedFrames,
              droppedByEdits: frameDebugger.stats.framesDroppedByEdits,
              droppedByMissingSample: frameDebugger.stats.framesDroppedByMissingSample,
              finalFrameCount: frameDebugger.stats.finalFrameCount,
              actualImageFrames: imageFrames.length,
              missingFrames: saveTrack.nb_samples - imageFrames.length
            });
            
            console.log('🔍 Frame drop breakdown:');
            console.log(`  📥 Total frames decoded by browser: ${frameDebugger.stats.totalDecodedFrames}`);
            console.log(`  ❌ Dropped by edit list: ${frameDebugger.stats.framesDroppedByEdits}`);
            console.log(`  ❌ Dropped by missing sample: ${frameDebugger.stats.framesDroppedByMissingSample}`);
            console.log(`  ✅ Successfully processed: ${frameDebugger.stats.finalFrameCount}`);
            console.log(`  📊 Final imageFrames array length: ${imageFrames.length}`);
            console.log(`  🚨 Missing frames: ${saveTrack.nb_samples - imageFrames.length}`);
            
            resolve({
              width: saveTrack.track_width,
              height: saveTrack.track_height,
              frames: imageFrames,
              numFrames: saveTrack.nb_samples,
              fps:
                (saveTrack.nb_samples / saveTrack.duration) *
                saveTrack.timescale,
            });
          }
        },
        error(error) {
          reject(error);
        },
      });

      let description;
      const trak = mp4File.getTrackById(track.id);
      const entries = trak?.mdia?.minf?.stbl?.stsd?.entries;
      if (entries == null) {
        return;
      }
      for (const entry of entries) {
        if (entry.avcC || entry.hvcC) {
          const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
          if (entry.avcC) {
            entry.avcC.write(stream);
          } else if (entry.hvcC) {
            entry.hvcC.write(stream);
          }
          description = new Uint8Array(stream.buffer, 8); // Remove the box header.
          break;
        }
      }

      const configuration: VideoDecoderConfig = {
        codec: track.codec,
        codedWidth: track.track_width,
        codedHeight: track.track_height,
        description,
      };
      const supportedConfig =
        await VideoDecoder.isConfigSupported(configuration);
      if (supportedConfig.supported == true) {
        decoder.configure(configuration);

        mp4File.setExtractionOptions(track.id, null, {
          nbSamples: Infinity,
        });
        mp4File.start();
      } else {
        reject(
          new Error(
            `Decoder config faile: config ${JSON.stringify(
              supportedConfig.config,
            )} is not supported`,
          ),
        );
        return;
      }
    };

    mp4File.onSamples = async (
      _id: number,
      _user: unknown,
      samples: MP4Sample[],
    ) => {
      console.log(`📦 Received ${samples.length} samples from MP4 file. Total samples now: ${globalSamples.length + samples.length}`);
      
      for (const sample of samples) {
        globalSamples.push(sample);
        decoder.decode(
          new EncodedVideoChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: (sample.cts * 1_000_000) / sample.timescale,
            duration: (sample.duration * 1_000_000) / sample.timescale,
            data: sample.data,
          }),
        );
      }
      
      console.log(`🔧 All samples processed. Total globalSamples: ${globalSamples.length}, Expected from track: ${track?.nb_samples}`);
      await decoder.flush();
      decoder.close();
    };

    onReady(mp4File);
  });
}

export function decode(
  file: File,
  onProgress: (decodedVideo: DecodedVideo) => void,
): Promise<DecodedVideo> {
  return decodeInternal(
    file.name,
    async (mp4File: MP4File) => {
      const reader = new FileReader();
      reader.onload = function () {
        const result = this.result as MP4ArrayBuffer;
        if (result != null) {
          result.fileStart = 0;
          mp4File.appendBuffer(result);
        }
        mp4File.flush();
      };
      reader.readAsArrayBuffer(file);
    },
    onProgress,
  );
}

export function decodeStream(
  fileStream: FileStream,
  onProgress: (decodedVideo: DecodedVideo) => void,
): Promise<DecodedVideo> {
  return decodeInternal(
    'stream',
    async (mp4File: MP4File) => {
      let part = await fileStream.next();
      while (part.done === false) {
        const result = part.value.data.buffer as MP4ArrayBuffer;
        if (result != null) {
          result.fileStart = part.value.range.start;
          mp4File.appendBuffer(result);
        }
        mp4File.flush();
        part = await fileStream.next();
      }
    },
    onProgress,
  );
}
