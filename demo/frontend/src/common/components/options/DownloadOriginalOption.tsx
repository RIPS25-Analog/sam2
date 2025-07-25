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
import {Download} from '@carbon/icons-react';
import OptionButton from './OptionButton';
import useDownloadOriginalVideo from './useDownloadOriginalVideo';

export default function DownloadOriginalOption() {
  const {download, state} = useDownloadOriginalVideo();

  return (
    <OptionButton
      title="Download Original"
      Icon={Download}
      loadingProps={{
        loading: state === 'started' || state === 'encoding',
        label: 'Downloading Original...',
      }}
      onClick={download}
    />
  );
}
