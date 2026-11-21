/**
 * Static paths of every photo page. Each gallery kind publishes its photos under its own URL, so the
 * page knows its gallery without JavaScript (back link, Previous/Next, position); every copy declares
 * the standalone page `/photography/<slug>/` canonical (PhotoPage). Route files only call
 * `photoPagePaths(<kind>)` and render PhotoPage; the param holding the photo slug is always `photo`.
 */
import {
  getAllPhotosContext,
  getCategoryContext,
  getPhotoLibrary,
  getPhotoSlug,
  getProjectContext,
  getSelectedContext,
  getTagContext,
  getTagFilterContextData,
  type PhotoContext,
  type PhotoEntry
} from './photography';
import type { TagContextData } from './photographyTagFilter';

export type PhotoPageKind = 'standalone' | 'selected' | 'category' | 'project' | 'tag';

export type PhotoPageProps = {
  photo: PhotoEntry;
  /** The gallery this copy of the photo page belongs to. */
  context: PhotoContext;
  /** Standalone pages only: data for following `?from=tags&<filters>` on the client. */
  tagContext?: TagContextData;
};

type PhotoPagePath = { params: Record<string, string>; props: PhotoPageProps };

const pagesOf = (
  context: PhotoContext,
  params: Record<string, string> = {},
  tagContext?: TagContextData
): PhotoPagePath[] =>
  context.photos.map((photo) => ({
    params: { ...params, photo: getPhotoSlug(photo) },
    props: { photo, context, tagContext }
  }));

export const photoPagePaths = async (kind: PhotoPageKind): Promise<PhotoPagePath[]> => {
  const library = await getPhotoLibrary();

  switch (kind) {
    case 'standalone':
      // The tag-context data is built once and shared by every standalone page.
      return pagesOf(getAllPhotosContext(library), {}, getTagFilterContextData(library));
    case 'selected':
      return pagesOf(getSelectedContext(library));
    case 'category':
      return library.categories.flatMap((gallery) =>
        pagesOf(getCategoryContext(library, gallery), { category: gallery.category.slug })
      );
    case 'project':
      return library.projects.flatMap((gallery) =>
        pagesOf(getProjectContext(library, gallery), { project: gallery.project.slug })
      );
    case 'tag':
      return library.tagGalleries.flatMap((gallery) =>
        pagesOf(getTagContext(library, gallery), { group: gallery.group.slug, tag: gallery.tag.slug })
      );
  }
};
