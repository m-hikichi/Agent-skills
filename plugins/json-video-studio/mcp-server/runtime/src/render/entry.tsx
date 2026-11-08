import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {StoryboardComposition, ThumbnailComposition, VideoComposition, calculateMainMetadata, emptyRenderInput} from './composition.js';

const Root = () => {
  const defaults = emptyRenderInput();
  return (
    <>
      <Composition id="JsonVideo" component={VideoComposition} width={1920} height={1080} fps={30} durationInFrames={1} defaultProps={defaults} calculateMetadata={calculateMainMetadata} />
      <Composition id="JsonVideoThumbnail" component={ThumbnailComposition} width={1280} height={720} fps={30} durationInFrames={1} defaultProps={defaults} />
      <Composition id="JsonVideoStoryboard" component={StoryboardComposition} width={1920} height={1080} fps={30} durationInFrames={1} defaultProps={defaults} />
    </>
  );
};

registerRoot(Root);
