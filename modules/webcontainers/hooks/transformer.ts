import type { FileSystemTree, FileNode, DirectoryNode } from "@webcontainer/api";
import type { TemplateFolder, TemplateItem } from "@/modules/playground/lib/path-to-json";

/**
 * Name of an item on disk.
 * Files without an extension (Dockerfile, LICENSE, Makefile...) keep their plain name.
 */
function getItemName(item: TemplateItem): string {
  if ("folderName" in item) return item.folderName;
  return item.fileExtension ? `${item.filename}.${item.fileExtension}` : item.filename;
}

function processItem(item: TemplateItem): FileNode | DirectoryNode {
  if ("folderName" in item) {
    return { directory: toTree(item.items) };
  }
  return { file: { contents: item.content ?? "" } };
}

function toTree(items: TemplateItem[]): FileSystemTree {
  const tree: FileSystemTree = {};
  for (const item of items) {
    tree[getItemName(item)] = processItem(item);
  }
  return tree;
}

/** Converts the template JSON into the tree format `webcontainer.mount()` expects. */
export function transformToWebContainerFormat(template: TemplateFolder): FileSystemTree {
  return toTree(template.items);
}