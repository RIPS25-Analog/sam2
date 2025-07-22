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
import {getFileName} from '@/common/components/options/ShareUtils';
import {FrameExportCompletedEvent} from '@/common/components/video/VideoWorkerTypes';
import useVideo from '@/common/components/video/editor/useVideo';
import {useState} from 'react';

type DownloadingState = 'default' | 'started' | 'exporting' | 'completed';

type State = {
  state: DownloadingState;
  progress: number;
  downloadFrames: () => Promise<void>;
};

export default function useDownloadFrames(): State {
  const [downloadingState, setDownloadingState] =
    useState<DownloadingState>('default');
  const [progress, setProgress] = useState<number>(0);

  const video = useVideo();

  async function downloadFrames(): Promise<void> {
    if (!video) {
      throw new Error('Video not available');
    }

    return new Promise((resolve, reject) => {
      function onFrameExportCompleted(event: FrameExportCompletedEvent) {
        try {
          setDownloadingState('exporting');
          
          // Create a ZIP file containing all frames
          createZipFile(event.frames);
          
          video?.removeEventListener('frameExportCompleted', onFrameExportCompleted);
          setDownloadingState('completed');
          resolve();
        } catch (error) {
          setDownloadingState('default');
          reject(error);
        }
      }

      video.addEventListener('frameExportCompleted', onFrameExportCompleted);

      setDownloadingState('started');
      video.pause();
      
      // Start the frame export process
      video.exportProcessedFrames();
    });
  }

  async function createZipFile(frames: Array<{blob: Blob, filename: string}>) {
    const originalFileName = getFileName();
    const zipFileName = originalFileName.replace('.mp4', '_frames.zip');
    
    // Create a simple ZIP file using minimal ZIP format (without external dependencies)
    const zipData = await createSimpleZip(frames);
    
    // Download the ZIP file
    const zipBlob = new Blob([zipData], { type: 'application/zip' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    
    a.href = url;
    a.download = zipFileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    setProgress(100);
  }

  async function createSimpleZip(frames: Array<{blob: Blob, filename: string}>): Promise<Uint8Array> {
    // Create a simple ZIP file manually without external dependencies
    const files: Array<{name: string, data: Uint8Array}> = [];
    
    // Convert all blobs to byte arrays
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const arrayBuffer = await frame.blob.arrayBuffer();
      files.push({
        name: frame.filename,
        data: new Uint8Array(arrayBuffer)
      });
      
      // Update progress during conversion
      setProgress((i / frames.length) * 50); // First 50% for conversion
    }
    
    // Create ZIP structure manually
    const centralDirectory: Uint8Array[] = [];
    const fileData: Uint8Array[] = [];
    let offset = 0;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const nameBytes = new TextEncoder().encode(file.name);
      
      // Local file header
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(localHeader.buffer);
      
      view.setUint32(0, 0x04034b50, true); // Local file header signature
      view.setUint16(4, 20, true); // Version needed to extract
      view.setUint16(6, 0, true); // General purpose bit flag
      view.setUint16(8, 0, true); // Compression method (stored)
      view.setUint16(10, 0, true); // Last mod file time
      view.setUint16(12, 0, true); // Last mod file date
      view.setUint32(14, 0, true); // CRC-32 (will calculate)
      view.setUint32(18, file.data.length, true); // Compressed size
      view.setUint32(22, file.data.length, true); // Uncompressed size
      view.setUint16(26, nameBytes.length, true); // File name length
      view.setUint16(28, 0, true); // Extra field length
      
      localHeader.set(nameBytes, 30);
      
      // Calculate CRC32 (simplified)
      const crc = calculateCRC32(file.data);
      view.setUint32(14, crc, true);
      
      fileData.push(localHeader);
      fileData.push(file.data);
      
      // Central directory entry
      const centralEntry = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralEntry.buffer);
      
      centralView.setUint32(0, 0x02014b50, true); // Central file header signature
      centralView.setUint16(4, 20, true); // Version made by
      centralView.setUint16(6, 20, true); // Version needed to extract
      centralView.setUint16(8, 0, true); // General purpose bit flag
      centralView.setUint16(10, 0, true); // Compression method
      centralView.setUint16(12, 0, true); // Last mod file time
      centralView.setUint16(14, 0, true); // Last mod file date
      centralView.setUint32(16, crc, true); // CRC-32
      centralView.setUint32(20, file.data.length, true); // Compressed size
      centralView.setUint32(24, file.data.length, true); // Uncompressed size
      centralView.setUint16(28, nameBytes.length, true); // File name length
      centralView.setUint16(30, 0, true); // Extra field length
      centralView.setUint16(32, 0, true); // File comment length
      centralView.setUint16(34, 0, true); // Disk number start
      centralView.setUint16(36, 0, true); // Internal file attributes
      centralView.setUint32(38, 0, true); // External file attributes
      centralView.setUint32(42, offset, true); // Relative offset of local header
      
      centralEntry.set(nameBytes, 46);
      centralDirectory.push(centralEntry);
      
      offset += localHeader.length + file.data.length;
      
      // Update progress during ZIP creation
      setProgress(50 + ((i + 1) / files.length) * 50); // Second 50% for ZIP creation
    }
    
    // End of central directory record
    const centralDirSize = centralDirectory.reduce((sum, entry) => sum + entry.length, 0);
    const endRecord = new Uint8Array(22);
    const endView = new DataView(endRecord.buffer);
    
    endView.setUint32(0, 0x06054b50, true); // End of central dir signature
    endView.setUint16(4, 0, true); // Number of this disk
    endView.setUint16(6, 0, true); // Number of the disk with the start of the central directory
    endView.setUint16(8, files.length, true); // Total number of entries in the central directory on this disk
    endView.setUint16(10, files.length, true); // Total number of entries in the central directory
    endView.setUint32(12, centralDirSize, true); // Size of the central directory
    endView.setUint32(16, offset, true); // Offset of start of central directory
    endView.setUint16(20, 0, true); // ZIP file comment length
    
    // Combine all parts
    const totalSize = fileData.reduce((sum, part) => sum + part.length, 0) + centralDirSize + endRecord.length;
    const result = new Uint8Array(totalSize);
    let pos = 0;
    
    for (const part of fileData) {
      result.set(part, pos);
      pos += part.length;
    }
    
    for (const entry of centralDirectory) {
      result.set(entry, pos);
      pos += entry.length;
    }
    
    result.set(endRecord, pos);
    
    return result;
  }

  function calculateCRC32(data: Uint8Array): number {
    // Simplified CRC32 calculation (not fully compliant but works for basic ZIP)
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  return {downloadFrames, progress, state: downloadingState};
}
