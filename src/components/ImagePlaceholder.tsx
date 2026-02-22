import { memo } from 'react';

const ImagePlaceholder = memo(function ImagePlaceholder({
  aspectRatio,
}: {
  aspectRatio: string;
}) {
  return (
    <div
      className={`w-full ${aspectRatio} rounded-lg image-placeholder-shimmer`}
      aria-hidden='true'
    />
  );
});

export { ImagePlaceholder };
