/**
 * Example usage of FrameExporter
 * 
 * This shows how to export all processed frames as individual PNG images
 * instead of creating a video file.
 */

import {FrameExporter} from '@/common/utils/FrameExporter';
import {DecodedVideo} from '@/common/codecs/VideoDecoder';
import {Tracklet} from '@/common/tracker/Tracker';
import AllEffects from '@/common/components/video/effects/Effects';

// Example function to export frames
export async function exportProcessedFrames(
  decodedVideo: DecodedVideo,
  tracklets: Tracklet[]
) {
  // Create exporter with video dimensions
  const exporter = new FrameExporter(decodedVideo.width, decodedVideo.height);
  
  // Set up effects (same as in VideoWorkerContext)
  const effects = [
    AllEffects.Original, // Image as background
    AllEffects.Overlay,  // Masks on top
  ];
  
  // Export all frames with progress tracking
  console.log('Exporting frames...');
  const frameBlobs = await exporter.exportFrames(
    decodedVideo,
    tracklets,
    effects,
    (progress) => {
      console.log(`Progress: ${Math.round(progress * 100)}%`);
    }
  );
  
  // Download each frame
  frameBlobs.forEach((blob, index) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `processed_frame_${index.toString().padStart(4, '0')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });
  
  console.log(`Exported ${frameBlobs.length} frames`);
}

// Alternative: Get frame URLs instead of downloading
export async function getProcessedFrameUrls(
  decodedVideo: DecodedVideo,
  tracklets: Tracklet[]
): Promise<string[]> {
  const exporter = new FrameExporter(decodedVideo.width, decodedVideo.height);
  
  const effects = [
    AllEffects.Original,
    AllEffects.Overlay,
  ];
  
  return await exporter.exportFramesAsUrls(
    decodedVideo,
    tracklets,
    effects,
    (progress) => {
      console.log(`Processing: ${Math.round(progress * 100)}%`);
    }
  );
}
