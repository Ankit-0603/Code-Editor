import type { TemplateFile, TemplateFolder } from "./path-to-json";

/** "index.js", or just "Dockerfile" for files without an extension. */
export function getFileName(file: Pick<TemplateFile, "filename" | "fileExtension">): string {
  const ext = file.fileExtension?.trim();
  return ext ? `${file.filename}.${ext}` : file.filename;
}

function searchPath(
  folder: TemplateFolder,
  matches: (item: TemplateFile) => boolean,
  pathSoFar: string[]
): string | null {
  for (const item of folder.items) {
    if ("folderName" in item) {
      const res = searchPath(item, matches, [...pathSoFar, item.folderName]);
      if (res) return res;
    } else if (matches(item)) {
      return [...pathSoFar, getFileName(item)].join("/");
    }
  }
  return null;
}

/**
 * Full path of a file inside the template, e.g. "pages/index.html".
 *
 * Looks for the exact same object first, so two files with the same name in
 * different folders (e.g. "index.js" and "src/index.js") are told apart.
 * Falls back to matching by name for copies of the file object.
 */
export function findFilePath(file: TemplateFile, folder: TemplateFolder): string | null {
  return (
    searchPath(folder, (item) => item === file, []) ??
    searchPath(
      folder,
      (item) =>
        item.filename === file.filename && item.fileExtension === file.fileExtension,
      []
    )
  );
}

/**
 * Unique ID of a file: its full path, e.g. "pages/index.html".
 * (The old version appended the name twice: "pages/index.html/index.html".)
 */
export const generateFileId = (file: TemplateFile, rootFolder: TemplateFolder): string => {
  return findFilePath(file, rootFolder)?.replace(/^\/+/, "") || getFileName(file);
};

/** Returns a copy of the tree with the file at `filePath` given new content. */
export function updateFileContentAtPath(
  root: TemplateFolder,
  filePath: string,
  content: string
): TemplateFolder {
  const update = (folder: TemplateFolder, prefix: string): TemplateFolder => ({
    ...folder,
    items: folder.items.map((item) => {
      if ("folderName" in item) {
        return update(item, prefix ? `${prefix}/${item.folderName}` : item.folderName);
      }
      const itemPath = prefix ? `${prefix}/${getFileName(item)}` : getFileName(item);
      return itemPath === filePath ? { ...item, content } : item;
    }),
  });
  return update(root, "");
}