/**
 * Debugging patch for VideoDecoder.ts
 * 
 * This adds console logging to help identify where frames are being dropped.
 * Apply these changes temporarily to debug the frame count issue.
 */

// To add to the beginning of the output function in VideoDecoder.ts:
const debugFrameOutput = `
        async output(inputFrame) {
          frameDebugger.stats.totalDecodedFrames++;
          console.log(\`Frame \${frame_n} decoded: timestamp=\${inputFrame.timestamp}\`);
          
          if (track == null) {
            reject(new Error(\`\${identifier} does not contain a video track\`));
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
            console.log(\`Checking edit list: cts=\${cts}, media_time=\${edits[0].media_time}\`);
            if (cts < edits[0].media_time) {
              console.log(\`Frame \${frame_n} DROPPED by edit list filter\`);
              frameDebugger.logFrameDrop('edit_list_filter', frame_n, inputFrame.timestamp);
              inputFrame.close();
              return;
            }
          }`;

// To add before the sample check:
const debugSampleCheck = `
          const sample = globalSamples[frame_n];
          console.log(\`Frame \${frame_n}: sample exists=\${sample != null}, globalSamples.length=\${globalSamples.length}\`);
          
          if (sample != null) {
            const duration = (sample.duration * 1_000_000) / sample.timescale;
            imageFrames.push({
              bitmap: inputFrame,
              timestamp: inputFrame.timestamp,
              duration,
            });
            frameDebugger.stats.finalFrameCount++;
            console.log(\`Frame \${frame_n} ADDED to imageFrames (total: \${imageFrames.length})\`);
          } else {
            console.log(\`Frame \${frame_n} DROPPED - no corresponding sample\`);
            frameDebugger.logFrameDrop('missing_sample', frame_n, inputFrame.timestamp);
            inputFrame.close();
          }`;

// Instructions for manual application:
console.log('To debug frame dropping:');
console.log('1. Open VideoDecoder.ts');
console.log('2. Find the output function around line 94');
console.log('3. Add the debugFrameOutput code at the beginning');
console.log('4. Add the debugSampleCheck code around the sample check');
console.log('5. Reload and check console logs when loading your video');
console.log('');
console.log('This will show you exactly which frames are being dropped and why.');

export { debugFrameOutput, debugSampleCheck };
