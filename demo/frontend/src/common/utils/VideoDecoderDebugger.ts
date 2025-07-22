/**
 * Debug utility to understand frame dropping in video decoder
 */

export interface FrameDroppingStats {
  totalDecodedFrames: number;
  framesDroppedByEdits: number;
  framesDroppedByMissingSample: number;
  finalFrameCount: number;
  editListInfo: {
    hasEdits: boolean;
    editCount: number;
    mediaTime?: number;
  };
}

export function createDecoderDebugger(): {
  stats: FrameDroppingStats;
  logFrameDrop: (reason: string, frameIndex: number, timestamp?: number) => void;
  logEditInfo: (edits: any[] | null, timescale: number) => void;
  reset: () => void;
} {
  const stats: FrameDroppingStats = {
    totalDecodedFrames: 0,
    framesDroppedByEdits: 0,
    framesDroppedByMissingSample: 0,
    finalFrameCount: 0,
    editListInfo: {
      hasEdits: false,
      editCount: 0,
    }
  };

  return {
    stats,
    
    logFrameDrop(reason: string, frameIndex: number, timestamp?: number) {
      console.log(`Frame ${frameIndex} dropped: ${reason}`, { timestamp });
      
      if (reason === 'edit_list_filter') {
        stats.framesDroppedByEdits++;
      } else if (reason === 'missing_sample') {
        stats.framesDroppedByMissingSample++;
      }
    },
    
    logEditInfo(edits: any[] | null, timescale: number) {
      if (edits && edits.length > 0) {
        stats.editListInfo.hasEdits = true;
        stats.editListInfo.editCount = edits.length;
        stats.editListInfo.mediaTime = edits[0].media_time;
        
        console.log('Video has edit list:', {
          editCount: edits.length,
          mediaTime: edits[0].media_time,
          timescale,
          mediaTimeSeconds: edits[0].media_time / timescale
        });
      } else {
        console.log('Video has no edit list');
      }
    },
    
    reset() {
      Object.assign(stats, {
        totalDecodedFrames: 0,
        framesDroppedByEdits: 0,
        framesDroppedByMissingSample: 0,
        finalFrameCount: 0,
        editListInfo: {
          hasEdits: false,
          editCount: 0,
        }
      });
    }
  };
}
