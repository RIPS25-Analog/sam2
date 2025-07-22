/**
 * Simple debugging tool to investigate frame dropping
 * 
 * You can use this in the browser console to check frame counts
 * and track down where frames are being dropped during video processing.
 */

// Add this to your browser console after loading a video
function debugVideoFrameCount() {
  // Check if we can access the video worker context
  const videoElements = document.querySelectorAll('video');
  console.log('Found video elements:', videoElements.length);
  
  // Look for the video metadata in the app
  if (window.videoDebugInfo) {
    console.log('Video debug info:', window.videoDebugInfo);
  }
  
  // Check localStorage for any video metadata
  const keys = Object.keys(localStorage);
  const videoKeys = keys.filter(key => key.includes('video') || key.includes('frame'));
  if (videoKeys.length > 0) {
    console.log('Video-related localStorage keys:');
    videoKeys.forEach(key => {
      console.log(`${key}:`, localStorage.getItem(key));
    });
  }
  
  return {
    message: 'Debug info logged to console',
    videoElements: videoElements.length,
    videoKeys: videoKeys.length
  };
}

// Add this to check frame counts during video processing
function logFrameProcessing() {
  const originalConsoleLog = console.log;
  
  console.log = function(...args) {
    // Look for frame-related logs
    const message = args.join(' ');
    if (message.includes('frame') || message.includes('Frame') || 
        message.includes('sample') || message.includes('decode')) {
      originalConsoleLog.apply(console, ['[FRAME DEBUG]', ...args]);
    } else {
      originalConsoleLog.apply(console, args);
    }
  };
  
  return 'Frame processing logging enabled. Check console for [FRAME DEBUG] messages.';
}

// Export for global access
window.debugVideoFrameCount = debugVideoFrameCount;
window.logFrameProcessing = logFrameProcessing;

console.log('Video debugging tools loaded. Use:');
console.log('- debugVideoFrameCount() to check current video info');
console.log('- logFrameProcessing() to enable frame logging');
