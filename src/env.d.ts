declare module 'masonry-layout' {
  type MasonryOptions = {
    gutter?: number | string | Element;
    horizontalOrder?: boolean;
    itemSelector?: string;
    percentPosition?: boolean;
    transitionDuration?: number | string;
  };

  export default class Masonry {
    constructor(element: Element | string, options?: MasonryOptions);
    destroy(): void;
    layout(): void;
  }
}
